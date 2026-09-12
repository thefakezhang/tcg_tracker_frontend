// Real GoTrue and Storage HTTP acceptance, restricted to a disposable hosted
// fixture. Credentials and object bytes never enter the evidence report.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const inputPath = process.env.BUYER_AUTH_FIXTURE_INPUT;
const evidencePath = process.env.BUYER_AUTH_FIXTURE_EVIDENCE;
assert(inputPath && evidencePath, "fixture input and evidence paths are required");
assert(process.env.GITHUB_ACTIONS === "true", "requires a disposable GitHub-hosted fixture");
assert.equal(statSync(inputPath).mode & 0o077, 0, "fixture credentials must be private");
const fixture = JSON.parse(readFileSync(inputPath, "utf8"));
assert.match(fixture.runId, /^issue939-[0-9]+-[0-9]+$/);
assert.equal(fixture.runId, process.env.TCG_DISPOSABLE_FIXTURE_RUN_ID);
assert.equal(fixture.projectId, fixture.runId);
const origin = new URL(fixture.apiUrl);
assert.equal(origin.protocol, "http:");
assert(["127.0.0.1", "[::1]"].includes(origin.hostname), "only literal loopback is allowed");
assert.equal(origin.username + origin.password + origin.search + origin.hash, "");
assert.equal(origin.pathname, "/");
const require = process.env.TCG_FRONTEND_DEPENDENCY_ROOT
  ? createRequire(`${process.env.TCG_FRONTEND_DEPENDENCY_ROOT}/package.json`)
  : createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const report = { runId: fixture.runId, transport: "real GoTrue and Storage HTTP", cases: [] };
const record = (name, details = {}) => report.cases.push({ name, passed: true, ...details });
const client = () => createClient(origin.origin, fixture.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, options = {}) => {
    assert.equal(new URL(url).origin, origin.origin, "fixture request left its local origin");
    return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } },
});
function requireSuccess(result, label) {
  assert.equal(result.error, null, `${label} failed (${result.status ?? result.error?.status ?? "unknown status"})`);
  return result.data;
}
function requireDenied(result, label) {
  assert(result.error, `${label} unexpectedly succeeded`);
  const status = Number(result.status ?? result.error.status ?? result.error.statusCode);
  assert([400, 401, 403, 404].includes(status), `${label} failed for a non-authorization status`);
  return status;
}
async function signIn(name, expectedRole) {
  const account = fixture.users[name];
  assert(account && account.email.endsWith("@example.test"), "synthetic fixture account required");
  const api = client();
  const data = requireSuccess(await api.auth.signInWithPassword({ email: account.email, password: account.password }), `${name} sign-in`);
  assert(data.session?.access_token && data.user?.id, `${name} has no minted session`);
  const claims = JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString());
  assert.equal(claims.role, expectedRole, `${name} token hook role mismatch`);
  assert.equal(claims.sub, data.user.id);
  const verified = requireSuccess(await api.auth.getUser(), `${name} server token verification`);
  assert.equal(verified.user.id, data.user.id);
  record(`${name} server-verified ${expectedRole} session`);
  return api;
}

try {
  const operator = await signIn("operator", "administrator");
  const a = await signIn("buyerA", "buyer");
  const b = await signIn("buyerB", "buyer");
  const unmapped = await signIn("unmapped", "unmapped");
  const anonymous = client();
  const planA = fixture.plans.buyerA;
  const planB = fixture.plans.buyerB;
  assert(Number.isSafeInteger(planA) && planA > 0 && Number.isSafeInteger(planB) && planB > 0 && planA !== planB);
  const plans = requireSuccess(await operator.from("purchase_plans")
    .select("plan_id,name,assigned_buyer_email,status").in("plan_id", [planA, planB]), "operator fixture ownership proof");
  assert.equal(plans.length, 2);
  for (const [role, planId] of [["buyerA", planA], ["buyerB", planB]]) {
    const plan = plans.find((row) => row.plan_id === planId);
    assert(plan.name.startsWith(`${fixture.runId}:`), "refusing a non-fixture plan");
    assert.equal(plan.assigned_buyer_email, fixture.users[role].email);
    assert(["ready", "ordered"].includes(plan.status));
  }
  record("operator proves both isolated assigned fixture plans before mutation");
  requireSuccess(await operator.from("inventory_holdings_v").select("card_id").limit(1), "operator inventory view control");
  for (const [name, api] of [["buyerA", a], ["buyerB", b]]) {
    for (const [label, response] of [
      ["inventory", await api.from("inventory_holdings_v").select("card_id").limit(1)],
      ["finances", await api.rpc("get_balance_sheet")],
      ["reconciliation", await api.rpc("reconcile_purchase_plan", { p_plan_id: planA, p_trip_id: null, p_fx_rate: 150, p_shipping_jpy: {} })],
    ]) {
      assert.equal(requireDenied(response, `${name} ${label}`), 403);
      assert.equal(response.error.code, "42501");
      record(`${name} ${label} capability denied`);
    }
  }
  for (const [name, api, own, other] of [["buyerA", a, planA, planB], ["buyerB", b, planB, planA]]) {
    const assigned = requireSuccess(await api.rpc("buyer_assigned_plans"), `${name} assigned plans`);
    assert(assigned.some((row) => row.plan_id === own));
    assert(!assigned.some((row) => row.plan_id === other));
    record(`${name} assigned plan isolation`);
  }

  const bucket = "lot-receipts";
  const pathA = `plan-receipts/${planA}/cardrush/${fixture.runId}-a.pdf`;
  const pathB = `plan-receipts/${planB}/cardrush/${fixture.runId}-b.pdf`;
  const bytes = Buffer.from(`%PDF-1.4\nSynthetic receipt fixture ${fixture.runId}\n%%EOF\n`);
  for (const [name, api, path] of [["buyerA", a, pathA], ["buyerB", b, pathB]]) {
    requireSuccess(await api.storage.from(bucket).upload(path, bytes, { contentType: "application/pdf", upsert: false }), `${name} own upload`);
    const download = requireSuccess(await api.storage.from(bucket).download(path), `${name} own read`);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    record(`${name} own upload and exact-byte download`, { bytes: bytes.length });
  }
  for (const [name, api, other, path] of [["buyerA", a, planB, pathB], ["buyerB", b, planA, pathA]]) {
    const existingStatus = requireDenied(await api.storage.from(bucket).download(path), `${name} guessed foreign object`);
    const missingStatus = requireDenied(await api.storage.from(bucket).download(path.replace(/\.pdf$/, "-missing.pdf")), `${name} guessed missing foreign object`);
    assert.equal(existingStatus, missingStatus, "foreign object existence changed the denial status");
    const listed = requireSuccess(await api.storage.from(bucket).list(`plan-receipts/${other}/cardrush`), `${name} foreign list`);
    assert.deepEqual(listed, []);
    requireDenied(await api.storage.from(bucket).upload(`plan-receipts/${other}/cardrush/${fixture.runId}-forged.pdf`, bytes), `${name} cross-plan upload`);
    record(`${name} guessed foreign read/list/upload denied`, { existingStatus, missingStatus });
  }
  for (const [name, api] of [["anonymous", anonymous], ["unmapped", unmapped]]) {
    requireDenied(await api.storage.from(bucket).download(pathA), `${name} receipt read`);
    requireDenied(await api.storage.from(bucket).upload(`plan-receipts/${planA}/cardrush/${fixture.runId}-${name}.pdf`, bytes), `${name} receipt upload`);
    record(`${name} receipt access denied`);
  }
  const operatorDownload = requireSuccess(await operator.storage.from(bucket).download(pathB), "operator receipt read");
  assert.deepEqual(Buffer.from(await operatorDownload.arrayBuffer()), bytes);
  record("administrator receipt access preserved");

  for (const [label, path] of [
    ["wrong source", `plan-receipts/${planA}/unsupported/${fixture.runId}.pdf`],
    ["extra segment", `plan-receipts/${planA}/cardrush/extra/${fixture.runId}.pdf`],
    ["leading zero", `plan-receipts/0${planA}/cardrush/${fixture.runId}.pdf`],
    ["wrong prefix", `receipts/${planA}/cardrush/${fixture.runId}.pdf`],
  ]) {
    requireDenied(await a.storage.from(bucket).upload(path, bytes), `${label} upload`);
    record(`${label} upload denied`);
  }
  const registration = { p_plan_id: planA, p_source: "cardrush", p_storage_path: pathA, p_original_name: "receipt.pdf" };
  requireSuccess(await a.rpc("buyer_record_source_receipt", registration), "own registration");
  requireSuccess(await a.rpc("buyer_record_source_receipt", registration), "same-object registration retry");
  const receipts = requireSuccess(await a.rpc("buyer_source_receipts", { p_plan_id: planA }), "registered receipt metadata");
  assert.equal(receipts.filter((row) => row.storage_path === pathA).length, 1);
  record("same-object registration is idempotent");
  for (const [label, path] of [["foreign", pathB], ["missing", pathA.replace(/\.pdf$/, "-missing.pdf")]]) {
    const response = await a.rpc("buyer_record_source_receipt", { ...registration, p_storage_path: path });
    requireDenied(response, `${label} registration`);
    assert.equal(response.error.code, "42501");
    assert.equal(response.error.message, "receipt is not available for this plan");
    record(`${label} metadata attachment gets uniform permission refusal`);
  }
  requireDenied(await a.storage.from(bucket).update(pathA, Buffer.from("overwrite attempt")), "buyer overwrite");
  const removal = await a.storage.from(bucket).remove([pathA]);
  // Storage may return an empty successful delete for an RLS-hidden target.
  if (removal.error) requireDenied(removal, "buyer delete");
  else assert.deepEqual(removal.data, []);
  const retained = requireSuccess(await a.storage.from(bucket).download(pathA), "evidence survives buyer overwrite/delete");
  assert.deepEqual(Buffer.from(await retained.arrayBuffer()), bytes);
  record("buyer cannot overwrite or delete uploaded evidence");

  requireSuccess(await operator.from("purchase_plans").update({ status: "cancelled" }).eq("plan_id", planA), "close synthetic plan");
  const historical = requireSuccess(await a.storage.from(bucket).download(pathA), "registered historical receipt read");
  assert.deepEqual(Buffer.from(await historical.arrayBuffer()), bytes);
  requireDenied(await a.storage.from(bucket).upload(`plan-receipts/${planA}/cardrush/${fixture.runId}-closed.pdf`, bytes), "closed-plan upload");
  requireDenied(await a.rpc("buyer_record_source_receipt", registration), "closed-plan registration");
  record("closed plan preserves registered reads and denies new writes");
  report.passed = true;
} finally {
  writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
console.log(`Authenticated receipt fixture passed ${report.cases.length} assertions.`);
