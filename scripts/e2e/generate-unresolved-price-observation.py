#!/usr/bin/env python3
"""Generate an unresolved-price fixture through the ordinary orchestrator path."""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


TWEET_ID = "2114000000000000003"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-root", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--data-revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    backend_root = args.backend_root.resolve(strict=True)
    data_root = args.data_root.resolve(strict=True)
    configured_data_root = Path(os.environ["TCG_DATA_ROOT"]).resolve(strict=True)
    if configured_data_root != data_root:
        raise RuntimeError(
            f"TCG_DATA_ROOT resolved to {configured_data_root}, expected {data_root}"
        )
    data_revision = subprocess.run(
        ["git", "-C", str(data_root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if data_revision != args.data_revision:
        raise RuntimeError(
            f"data revision is {data_revision}, expected {args.data_revision}"
        )

    service_root = backend_root / "services" / "image-recognition"
    sys.path.insert(0, str(service_root))
    import orchestrator  # pylint: disable=import-outside-toplevel
    from test_orchestrator_product_kind_routing import (  # pylint: disable=import-outside-toplevel
        _install_detector,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    source_path = args.output.with_name("ordinary-recognition-source.bin")
    source_path.write_bytes(b"unresolved-priced-observation-fixture-v1\n")

    verified = {
        "verified": True,
        "method": "currency_marker",
        "ocr_confidence": 0.97,
        "banner": None,
    }
    detector_results = [
        (
            (0, 0, 80, 120),
            None,
            0,
            110_000,
            (0, 120, 80, 145),
            None,
            [
                {
                    "amount": 110_000,
                    "bbox": (0, 120, 80, 145),
                    "tier": "item",
                    "evidence": verified,
                },
                {
                    "amount": 74_000,
                    "bbox": (0, 150, 80, 175),
                    "tier": "cash",
                    "evidence": {
                        **verified,
                        "method": "grouped_number",
                        "ocr_confidence": 0.91,
                    },
                },
            ],
        ),
        (
            (90, 0, 170, 120),
            None,
            0,
            36_000,
            (90, 120, 170, 145),
            None,
            [
                {
                    "amount": 36_000,
                    "bbox": (90, 120, 170, 145),
                    "tier": "item",
                    "evidence": verified,
                }
            ],
        ),
    ]
    tweet = SimpleNamespace(
        pending_id=4242,
        buyer_handle="snkrdunk",
        twitter_handle="fixture_generated",
        tweet_id=TWEET_ID,
        tweet_url=f"https://x.com/fixture_generated/status/{TWEET_ID}",
        tweet_text="Pokemon singles buylist",
        image_urls=[str(source_path)],
        source_thread_root_id=TWEET_ID,
        source_thread_position=0,
        source_thread_root_text="Pokemon singles buylist",
    )

    with pytest.MonkeyPatch.context() as monkeypatch:
        _install_detector(
            monkeypatch,
            header="ポケモンカード 高価買取",
            body="シングル買取",
            detector_results=detector_results,
            grading="psa_10",
        )
        candidates, error, kinds, outcomes, _verdicts = orchestrator.process_tweet(
            tweet,
            em_singles=object(),
            fm_singles=object(),
            em_sealed=object(),
            fm_sealed=object(),
            eng=object(),
            shadow=False,
            verify_durable_media=False,
        )

    if error is not None or candidates or kinds or len(outcomes) != 1:
        raise AssertionError(
            "ordinary recognition did not produce one candidate-free routing outcome: "
            f"error={error!r} candidates={len(candidates)} kinds={sorted(kinds)} "
            f"outcomes={len(outcomes)}"
        )
    mutation = outcomes[0]
    if mutation.schema_version != 2:
        raise AssertionError(f"unexpected routing schema {mutation.schema_version}")
    outcome = dataclasses.asdict(mutation.params)
    outcome["evidence"] = json.loads(outcome["evidence"])
    outcome["uncertainty_flags"] = json.loads(outcome["uncertainty_flags"])
    observations = outcome["evidence"]["recognition"][
        "unresolved_priced_observations"
    ]
    prices = [
        [price["amount_jpy"] for price in observation["prices"]]
        for observation in observations
    ]
    if prices != [[110_000, 74_000], [36_000]]:
        raise AssertionError(f"ordinary recognition lost a verified price tier: {prices}")
    if any(
        observation["identity"]
        != {
            "status": "unresolved",
            "reason": "matcher_abstained",
            "catalog_id": None,
        }
        for observation in observations
    ):
        raise AssertionError("ordinary recognition fabricated an identity")
    if any(
        observation["grade"] != {"status": "observed", "value": "psa_10"}
        for observation in observations
    ):
        raise AssertionError("configured PSA10 semantics were not preserved")
    if any(
        observation["financial_eligibility"]
        != "ineligible_unresolved_identity"
        for observation in observations
    ):
        raise AssertionError("an unresolved observation became financially eligible")

    payload = {
        "schema_version": 1,
        "generator": "orchestrator.process_tweet",
        "backend_revision": subprocess.run(
            ["git", "-C", str(backend_root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip(),
        "data_revision": args.data_revision,
        "candidate_count": len(candidates),
        "detected_kinds": sorted(kinds),
        "routing_outcome_count": len(outcomes),
        "outcome": outcome,
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
