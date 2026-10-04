export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function expectedFloatProjection() {
  return {
    remitted_jpy: 14_000,
    spent_jpy: 1_600,
    fees_jpy: 160,
    refunded_jpy: 0,
    settled_jpy: 900,
    balance_jpy: 11_340,
  };
}

export function assertFloatProjection(row) {
  const expected = expectedFloatProjection();
  for (const [column, value] of Object.entries(expected)) {
    assert(
      Number(row?.[column]) === value,
      `${column}=${row?.[column]}, want ${value}`,
    );
  }
}

export function assertSingleReplay(rows, requestId) {
  assert(rows.length === 1, `request ${requestId} wrote ${rows.length} float rows, want 1`);
  assert(rows[0].request_id === requestId, "persisted request UUID changed");
  assert(rows[0].gl_entry_id != null, "remittance has no journal entry");
  return rows[0].gl_entry_id;
}

export async function assertNoPageOverflow(page, stage) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    dimensions.document <= dimensions.viewport + 1
      && dimensions.body <= dimensions.viewport + 1,
    `${stage} overflowed horizontally: ${JSON.stringify(dimensions)}`,
  );
}

export async function assertTapTarget(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no tap-target bounds`);
  assert(
    box.width >= 44 && box.height >= 44,
    `${label} is ${box.width?.toFixed(1)}x${box.height?.toFixed(1)}, below 44px`,
  );
}
