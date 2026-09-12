// Seed only a uniquely named, disposable GitHub-hosted Supabase project.
// GoTrue creates the users and issues their sessions; SQL seeds synthetic plans.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const runId = process.env.TCG_DISPOSABLE_FIXTURE_RUN_ID;
assert.match(runId ?? "", /^issue939-[0-9]+-[0-9]+$/);
const statusPath = process.env.BUYER_AUTH_SUPABASE_STATUS;
const outputPath = process.env.BUYER_AUTH_FIXTURE_INPUT;
assert(statusPath && outputPath);
assert.equal(statSync(statusPath).mode & 0o077, 0);
const status = JSON.parse(readFileSync(statusPath, "utf8"));
const apiURL = new URL(status.API_URL);
assert.equal(apiURL.protocol, "http:");
assert(["127.0.0.1", "[::1]"].includes(apiURL.hostname));
assert.equal(apiURL.username + apiURL.password + apiURL.search + apiURL.hash, "");
assert.equal(apiURL.pathname, "/");
assert.equal(typeof status.ANON_KEY, "string");
assert(status.ANON_KEY.length > 20);

const containerName = `supabase_db_${runId}`;
const docker = (...args) => execFileSync("docker", ["-H", "unix:///var/run/docker.sock", ...args], {
  encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
});
const [container] = JSON.parse(docker("container", "inspect", containerName));
assert.equal(container.Name, `/${containerName}`);
assert.equal(container.Config.Labels["com.supabase.cli.project"], runId);
assert.equal(container.State.Running, true);
const [gateway] = JSON.parse(docker("container", "inspect", `supabase_kong_${runId}`));
assert.equal(gateway.Config.Labels["com.supabase.cli.project"], runId);
assert.equal(gateway.State.Running, true);
assert(gateway.NetworkSettings.Ports["8000/tcp"].some((binding) => binding.HostPort === apiURL.port),
  "the local API port must belong to this disposable project");
// Use the inspected immutable ID for every SQL call, not a replaceable name.
function sql(query) {
  return execFileSync("docker", ["-H", "unix:///var/run/docker.sock", "exec", "-i", container.Id,
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: query, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  }).trim();
}
assert.equal(sql("SELECT (SELECT count(*) FROM auth.users) + (SELECT count(*) FROM public.purchase_plans);"), "0",
  "fixture must be a freshly created empty project");
assert.equal(sql("SELECT to_regprocedure('public.buyer_plan_receipt_path_allowed(text,boolean)') IS NOT NULL;"), "t",
  "receipt privacy migration is required in the disposable fixture");

const require = process.env.TCG_FRONTEND_DEPENDENCY_ROOT
  ? createRequire(`${process.env.TCG_FRONTEND_DEPENDENCY_ROOT}/package.json`)
  : createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const fixture = { runId, projectId: runId, apiUrl: apiURL.origin, anonKey: status.ANON_KEY, users: {}, plans: {}, browserPlans: [] };
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
for (const [name, principal] of [["operator", "administrator"], ["buyerA", "buyer"], ["buyerB", "buyer"], ["unmapped", "unmapped"]]) {
  fixture.users[name] = { email: `${runId}-${name.toLowerCase()}@example.test`, password: randomBytes(24).toString("base64url"), principal };
}
// Remove only the fresh project's migration-seeded identity map, so the test
// UI cannot offer real operator/buyer addresses as synthetic fixture choices.
sql(`BEGIN;
DELETE FROM public.auth_principal_map;
INSERT INTO public.auth_principal_map (email, principal, expected_provider, note) VALUES
${Object.values(fixture.users).filter((u) => u.principal !== "unmapped")
  .map((u) => `(${literal(u.email)}, ${literal(u.principal)}, 'email', ${literal(runId)})`).join(",\n")};
COMMIT;`);
// Write once before signup so a failed bootstrap still has its private recovery
// inputs. This file must never be uploaded as an evidence artifact.
writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
for (const [name, account] of Object.entries(fixture.users)) {
  const api = createClient(apiURL.origin, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options = {}) => {
      assert.equal(new URL(url).origin, apiURL.origin);
      return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
    } },
  });
  const { data, error } = await api.auth.signUp({ email: account.email, password: account.password });
  assert.equal(error, null, `${name} local GoTrue signup failed`);
  assert(data.user?.id && data.session?.access_token, `${name} did not receive a real session`);
  const claims = JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString());
  assert.equal(claims.role, account.principal, `${name} custom access-token hook was not applied`);
  assert.equal(claims.sub, data.user.id);
  if (name === "operator") {
    // Private fixture input only. The browser later sends this genuinely
    // expired GoTrue token to the real PostgREST endpoint exactly once per case.
    assert(claims.exp - claims.iat <= 120, "disposable short token lifetime is required");
    account.expiredAccessToken = data.session.access_token;
    account.accessTokenExpiresAt = claims.exp;
  }
  const verified = await api.auth.getUser();
  assert.equal(verified.error, null);
  assert.equal(verified.data.user?.id, data.user.id);
}

function seedPlan(name, assignedEmail, sent) {
  const result = JSON.parse(sql(`
BEGIN;
CREATE TEMP TABLE fixture_plan_id ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO public.purchase_plans (name, status, assigned_buyer_email)
  VALUES (${literal(`${runId}:${name}`)}, 'draft', ${assignedEmail ? literal(assignedEmail) : "NULL"})
  RETURNING plan_id
) SELECT plan_id FROM inserted;
CREATE TEMP TABLE fixture_card_ids ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO public.pokemon_card_definitions (regional_name, set_code, card_number, language, variant_group_id)
  VALUES ('テストカードA', 'TST', left(gen_random_uuid()::text, 8) || '/001', 'jp', gen_random_uuid()),
         ('テストカードB', 'TST', left(gen_random_uuid()::text, 8) || '/002', 'jp', gen_random_uuid())
  RETURNING card_id
) SELECT card_id, row_number() OVER (ORDER BY card_id) AS position FROM inserted;
INSERT INTO public.purchase_plan_lines
  (plan_id, game, card_id, psa_grade, planned_quantity, source, source_listing_url, unit_price_orig, currency, condition_id)
SELECT p.plan_id, 'pokemon', c.card_id, 0, 2,
       CASE c.position WHEN 1 THEN 'cardrush' ELSE 'hareruya2' END,
       'https://example.test/listing', 1000, 'JPY',
       CASE WHEN c.position=1 THEN (SELECT condition_id FROM public.conditions WHERE standard='cardrush_other' AND code='A') END
FROM fixture_plan_id p CROSS JOIN fixture_card_ids c;
UPDATE public.purchase_plans SET status='ready' WHERE plan_id=(SELECT plan_id FROM fixture_plan_id);
${sent ? "DO $fixture$ BEGIN PERFORM public.send_purchase_plan((SELECT plan_id FROM fixture_plan_id)); END $fixture$;" : ""}
SELECT json_build_object('planId', p.plan_id, 'name', ${literal(`${runId}:${name}`)},
  'lines', (SELECT json_agg(json_build_object('lineId', l.plan_line_id, 'cardId', l.card_id, 'source', l.source)
    ORDER BY l.plan_line_id) FROM public.purchase_plan_lines l WHERE l.plan_id=p.plan_id))
FROM fixture_plan_id p;
COMMIT;`));
  assert(Number.isSafeInteger(result.planId) && result.planId > 0);
  assert.equal(result.lines.length, 2);
  return result;
}
for (const name of ["buyerA", "buyerB"]) {
  fixture.plans[name] = seedPlan(`api-${name}`, fixture.users[name].email, true).planId;
}
for (const language of ["en", "ja"]) {
  for (const viewport of ["desktop", "phone"]) {
    fixture.browserPlans.push({ language, viewport, ...seedPlan(`${language}-${viewport}`, null, false) });
  }
}
writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
console.log("Created four server-verified synthetic users and six isolated buyer plans.");
