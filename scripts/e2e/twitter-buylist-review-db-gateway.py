#!/usr/bin/env python3
"""Loopback-only PostgREST-shaped gateway for the reviewed Twitter CUJ.

The browser talks to this process through the normal Supabase client.
Every authority-bearing response comes from the disposable PostgreSQL schema.
The gateway only adapts HTTP because the hermetic database harness does not run
PostgREST or GoTrue.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import threading
import uuid
from datetime import date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import sqlalchemy
from sqlalchemy import text

from gen.queries import Querier


SOURCE_SHA256 = "b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323"
TWEET_ID = "2112078363095715923"
ACTOR_SUBJECT = "curator-1880-browser"
PROCESS_TWEET_REPORT_SHA256 = (
    "18adad2127b11c15c4f3c1a2c905799d827374876228d7a6d4a7972b11defe5c"
)
TOHOKU_UID = "4edf0d33-d1fa-459b-9645-30a332144fda"
PRETEND_BOSS_UID = "e798eed8-c2dd-4c36-96e3-0fbb5a7db31c"


def json_default(value: Any) -> str:
    if isinstance(value, (date, datetime, uuid.UUID)):
        return value.isoformat() if not isinstance(value, uuid.UUID) else str(value)
    raise TypeError(f"cannot encode {type(value).__name__}")


class GatewayState:
    def __init__(self, engine: sqlalchemy.Engine, source_path: Path, token: str):
        self.engine = engine
        self.source_path = source_path
        self.token = token
        self.approval_requests: list[dict[str, Any]] = []
        self.lock = threading.Lock()

    def authenticated_scalar(
        self,
        statement: str,
        params: dict[str, Any],
    ) -> Any:
        claims = json.dumps({"role": "authenticated", "sub": ACTOR_SUBJECT})
        with self.engine.begin() as connection:
            connection.execute(text("SET LOCAL ROLE authenticated"))
            connection.execute(
                text("SELECT set_config('request.jwt.claims', :claims, true)"),
                {"claims": claims},
            )
            return connection.execute(text(statement), params).scalar_one()

    def review_document(self, candidate_id: int) -> dict[str, Any]:
        return self.authenticated_scalar(
            "SELECT get_twitter_buylist_review_document('singles', :candidate_id)",
            {"candidate_id": candidate_id},
        )

    def candidates(self, status: str | None = None) -> list[dict[str, Any]]:
        condition = ""
        params: dict[str, Any] = {}
        if status:
            condition = "AND candidate.status::text = :status"
            params["status"] = status
        with self.engine.connect() as connection:
            result = connection.execute(text(f"""
                SELECT to_jsonb(candidate)
                  FROM pokemon_image_buylist_candidates candidate
                 WHERE candidate.source_tweet_id=:tweet_id
                   {condition}
                 ORDER BY candidate.candidate_id DESC
            """), {"tweet_id": TWEET_ID, **params})
            return [row[0] for row in result]

    def catalog(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            result = connection.execute(text("""
                SELECT to_jsonb(definition)
                  FROM pokemon_card_definitions definition
                 WHERE definition.card_uid IN (
                    CAST(:tohoku_uid AS uuid), CAST(:pretend_uid AS uuid)
                 )
                 ORDER BY definition.card_id
            """), {
                "tohoku_uid": TOHOKU_UID,
                "pretend_uid": PRETEND_BOSS_UID,
            })
            return [row[0] for row in result]

    def queue_stats(self, status: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = connection.execute(text("""
                SELECT COALESCE(max(candidate_id), 0)::bigint,
                       count(*)::bigint,
                       count(*) FILTER (WHERE candidate_card_id IS NOT NULL)::bigint
                  FROM pokemon_image_buylist_candidates
                 WHERE source_tweet_id=:tweet_id
                   AND status::text=:status
            """), {"tweet_id": TWEET_ID, "status": status}).one()
        return {
            "high_water": row[0],
            "total": row[1],
            "matched": row[2],
            "band_counts": {
                "high": {"total": 0, "matched": 0},
                "medium": {"total": row[1], "matched": row[2]},
            },
        }

    def mutate_stale(self, candidate_id: int) -> dict[str, Any]:
        before = self.review_document(candidate_id)
        with self.engine.begin() as connection:
            row = connection.execute(text("""
                UPDATE pokemon_image_buylist_candidates
                   SET ocr_price_jpy=ocr_price_jpy + 1000
                 WHERE candidate_id=:candidate_id
                   AND status IN ('pending', 'needs_review')
                RETURNING ocr_price_jpy, original_price_jpy
            """), {"candidate_id": candidate_id}).one()
        after = self.review_document(candidate_id)
        if before["document_sha256"] == after["document_sha256"]:
            raise RuntimeError("stale mutation did not change the review digest")
        return {
            "candidate_id": candidate_id,
            "before_sha256": before["document_sha256"],
            "after_sha256": after["document_sha256"],
            "detector_price_jpy": row[1],
            "effective_price_jpy": row[0],
        }

    def approve(self, body: dict[str, Any]) -> dict[str, Any]:
        request_record = {"request": body, "outcome": None}
        with self.lock:
            self.approval_requests.append(request_record)
        try:
            result = self.authenticated_scalar("""
                SELECT approve_twitter_buylist_review(
                    :kind, :candidate_id, :expected_sha256, :request_id,
                    :target_id, :grade_or_condition, :price_jpy, :curator_notes
                )
            """, {
                "kind": body.get("p_candidate_kind"),
                "candidate_id": body.get("p_candidate_id"),
                "expected_sha256": body.get("p_expected_review_sha256"),
                "request_id": body.get("p_request_id"),
                "target_id": body.get("p_target_id"),
                "grade_or_condition": body.get("p_grade_or_condition"),
                "price_jpy": body.get("p_price_jpy"),
                "curator_notes": body.get("p_curator_notes"),
            })
            request_record["outcome"] = {"ok": True, "result": result}
            return result
        except Exception as error:
            sqlstate = getattr(getattr(error, "orig", None), "sqlstate", None)
            request_record["outcome"] = {
                "ok": False,
                "sqlstate": sqlstate,
                "message": str(error),
            }
            raise

    def initial_state(self) -> dict[str, Any]:
        candidates = self.candidates()
        rows = []
        for candidate in candidates:
            definition_uid = None
            with self.engine.connect() as connection:
                definition_uid = connection.execute(text("""
                    SELECT card_uid::text
                      FROM pokemon_card_definitions
                     WHERE card_id=:card_id
                """), {"card_id": candidate["candidate_card_id"]}).scalar_one()
            review = None
            if candidate["status"] in {"pending", "needs_review"}:
                review = self.review_document(candidate["candidate_id"])
            rows.append({
                "candidate_id": candidate["candidate_id"],
                "candidate_uid": candidate["candidate_uid"],
                "entity_uid": definition_uid,
                "status": candidate["status"],
                "detector_price_jpy": candidate["original_price_jpy"],
                "effective_price_jpy": candidate["ocr_price_jpy"],
                "review_sha256": review["document_sha256"] if review else None,
            })
        with self.lock:
            approvals = json.loads(json.dumps(
                self.approval_requests,
                default=json_default,
            ))
        return {
            "tweet_id": TWEET_ID,
            "source_sha256": SOURCE_SHA256,
            "process_tweet_report_sha256": PROCESS_TWEET_REPORT_SHA256,
            "candidates": rows,
            "approval_requests": approvals,
        }

    def reconcile_and_claim(self, candidate_id: int) -> dict[str, Any]:
        with self.engine.connect() as connection:
            subject = connection.execute(text("""
                SELECT candidate_uid::text, original_price_jpy,
                       ocr_price_jpy, status::text
                  FROM pokemon_image_buylist_candidates
                 WHERE candidate_id=:candidate_id
            """), {"candidate_id": candidate_id}).mappings().one()
        if subject["status"] != "approved":
            raise RuntimeError(f"candidate {candidate_id} is not approved")

        with self.engine.begin() as connection:
            queries = Querier(connection)
            enqueued = list(queries.enqueue_twitter_media_alerts_for_tweet(
                tweet_id=TWEET_ID,
            ))

        with self.engine.connect() as connection:
            alert_id = connection.execute(text("""
                SELECT alert_outbox_id
                  FROM buylist_alert_outbox
                 WHERE payload->>'candidate_uid'=:candidate_uid
                 ORDER BY alert_outbox_id DESC
                 LIMIT 1
            """), {"candidate_uid": subject["candidate_uid"]}).scalar_one()

        with self.engine.begin() as connection:
            queries = Querier(connection)
            due = list(queries.list_due_buylist_alerts(limit_count=100))
            claim_token = uuid.uuid4()
            claimed = queries.claim_buylist_alert(
                claim_token=claim_token,
                alert_outbox_id=alert_id,
            )
        if claimed is None:
            raise RuntimeError(f"alert {alert_id} was due but not claimable")

        with self.engine.connect() as connection:
            authority = connection.execute(text("""
                SELECT
                  count(DISTINCT decision.decision_uid)::integer AS decisions,
                  count(DISTINCT effect.effect_uid)::integer AS effects,
                  min(decision.actor_subject) AS actor_subject,
                  min(decision.action) AS action,
                  min(decision.submitted_fields->'server_review_authority'
                      ->'resolved'->>'entity_uid') AS entity_uid,
                  min(decision.submitted_fields->'server_review_authority'
                      ->'resolved'->>'grade_or_condition') AS grade_or_condition,
                  min((decision.submitted_fields->'server_review_authority'
                      ->'resolved'->>'effective_price_jpy')::bigint) AS effective_price_jpy,
                  min(route.actionability) AS route_actionability,
                  min(route.uncertainty_flags::text) AS route_uncertainty_flags,
                  min(alert.status::text) AS alert_status
                FROM pokemon_image_buylist_candidates candidate
                JOIN image_curation_decision_events decision
                  ON decision.candidate_uid=candidate.candidate_uid
                 AND decision.superseded_by IS NULL
                 AND decision.compensated_by IS NULL
                JOIN image_curation_listing_effects effect
                  ON effect.decision_uid=decision.decision_uid
                JOIN buylist_media_routing_outcomes route
                  ON route.tweet_id=candidate.source_tweet_id
                 AND route.buyer_handle=candidate.source_author_handle
                 AND route.source_image_index=candidate.source_image_index
                JOIN buylist_alert_outbox alert
                  ON alert.alert_outbox_id=:alert_id
               WHERE candidate.candidate_id=:candidate_id
               GROUP BY candidate.candidate_id
            """), {
                "candidate_id": candidate_id,
                "alert_id": alert_id,
            }).mappings().one()

        claim = dataclasses.asdict(claimed)
        return {
            "candidate_id": candidate_id,
            "candidate_uid": subject["candidate_uid"],
            "detector_price_jpy": subject["original_price_jpy"],
            "effective_price_jpy": subject["ocr_price_jpy"],
            "enqueued_ids": enqueued,
            "due_ids": due,
            "claim": claim,
            "authority": dict(authority),
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "TwitterBuylistReviewFixture/1"

    @property
    def state(self) -> GatewayState:
        return self.server.state  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"gateway {self.address_string()} {fmt % args}", flush=True)

    def send_cors_headers(self) -> None:
        requested_headers = self.headers.get("Access-Control-Request-Headers")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
        self.send_header(
            "Access-Control-Allow-Headers",
            requested_headers
            or "apikey, authorization, content-type, prefer, range, x-client-info",
        )
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST")
        self.send_header(
            "Vary",
            "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
        )
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(
        self,
        body: Any,
        status: HTTPStatus = HTTPStatus.OK,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        payload = json.dumps(body, default=json_default).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_cors_headers()
        self.send_header("Access-Control-Expose-Headers", "content-range")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        if length <= 0:
            return {}
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("request body must be an object")
        return value

    def authorized(self) -> bool:
        return (
            self.headers.get("apikey") == self.state.token
            and self.headers.get("authorization") == f"Bearer {self.state.token}"
        )

    def require_authorized(self) -> bool:
        if self.authorized():
            return True
        self.send_json({
            "code": "42501",
            "message": "loopback fixture requires its exact curator token",
        }, HTTPStatus.UNAUTHORIZED)
        return False

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/__fixture__/health":
            self.send_json({"status": "ok"})
            return
        if parsed.path == f"/source/{SOURCE_SHA256}.jpg":
            payload = self.state.source_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
            return
        if not self.require_authorized():
            return
        try:
            if parsed.path == "/__fixture__/state":
                self.send_json(self.state.initial_state())
                return
            if parsed.path == "/rest/v1/pokemon_image_buylist_candidates":
                status_value = parse_qs(parsed.query).get("status", [None])[0]
                status = status_value.removeprefix("eq.") if status_value else None
                rows = self.state.candidates(status)
                end = max(0, len(rows) - 1)
                self.send_json(rows, extra_headers={
                    "Content-Range": f"0-{end}/{len(rows)}",
                })
                return
            if parsed.path == "/rest/v1/pokemon_card_definitions":
                rows = self.state.catalog()
                end = max(0, len(rows) - 1)
                self.send_json(rows, extra_headers={
                    "Content-Range": f"0-{end}/{len(rows)}",
                })
                return
            if parsed.path == "/rest/v1/pokemon_sealed_image_buylist_candidates":
                self.send_json([], extra_headers={"Content-Range": "0-0/0"})
                return
            if parsed.path == "/rest/v1/pokemon_sealed_products":
                self.send_json([], extra_headers={"Content-Range": "0-0/0"})
                return
            self.send_json({
                "code": "fixture_unhandled_request",
                "message": f"GET {parsed.path}",
            }, HTTPStatus.NOT_FOUND)
        except Exception as error:
            self.send_json({
                "code": "fixture_failure",
                "message": str(error),
            }, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not self.require_authorized():
            return
        try:
            body = self.read_json()
            if parsed.path == "/rest/v1/rpc/image_curation_queue_stats":
                kind = body.get("p_kind")
                if kind == "sealed":
                    self.send_json({
                        "high_water": 0,
                        "total": 0,
                        "matched": 0,
                        "band_counts": {},
                    })
                    return
                self.send_json(self.state.queue_stats(body.get("p_status", "pending")))
                return
            if parsed.path == "/rest/v1/rpc/get_twitter_buylist_review_document":
                if body.get("p_candidate_kind") != "singles":
                    raise ValueError("fixture carries actual singles producer rows only")
                self.send_json(self.state.review_document(int(body["p_candidate_id"])))
                return
            if parsed.path == "/rest/v1/rpc/approve_twitter_buylist_review":
                try:
                    self.send_json(self.state.approve(body))
                except Exception as error:
                    sqlstate = getattr(getattr(error, "orig", None), "sqlstate", None)
                    message = str(error)
                    status = (
                        HTTPStatus.CONFLICT
                        if sqlstate == "40001" or "stale_review_document" in message
                        else HTTPStatus.BAD_REQUEST
                    )
                    self.send_json({
                        "code": sqlstate or "fixture_database_error",
                        "message": (
                            "stale_review_document"
                            if "stale_review_document" in message
                            else message
                        ),
                        "details": None,
                        "hint": None,
                    }, status)
                return
            if parsed.path == "/__fixture__/mutate-stale":
                self.send_json(self.state.mutate_stale(int(body["candidate_id"])))
                return
            if parsed.path == "/__fixture__/reconcile-claim":
                self.send_json(self.state.reconcile_and_claim(int(body["candidate_id"])))
                return
            self.send_json({
                "code": "fixture_unhandled_request",
                "message": f"POST {parsed.path}",
            }, HTTPStatus.NOT_FOUND)
        except Exception as error:
            self.send_json({
                "code": "fixture_failure",
                "message": str(error),
            }, HTTPStatus.INTERNAL_SERVER_ERROR)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--source-path", required=True, type=Path)
    parser.add_argument("--token", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = args.source_path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != SOURCE_SHA256:
        raise SystemExit("retained source bytes do not match the pinned SHA-256")
    engine = sqlalchemy.create_engine(
        args.db_url.replace("postgresql://", "postgresql+psycopg://", 1),
        pool_size=4,
        max_overflow=0,
        pool_pre_ping=True,
    )
    state = GatewayState(engine, args.source_path, args.token)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.state = state  # type: ignore[attr-defined]
    try:
        print(f"gateway listening on http://{args.host}:{args.port}", flush=True)
        server.serve_forever()
    finally:
        server.server_close()
        engine.dispose()


if __name__ == "__main__":
    main()
