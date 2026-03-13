import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

serve(async () => {
  const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);

  try {
    const conn = await pool.connect();

    try {
      // 1. Get all currency codes from the currencies table
      const currencyResult = await conn.queryObject<{ code: string }>(
        "SELECT code FROM currencies"
      );
      const codes = currencyResult.rows.map((r) => r.code);

      // 2. Fetch latest rates from ExchangeRate-API (registered free plan with API key)
      const apiKey = Deno.env.get("EXCHANGERATE_API_KEY");
      if (!apiKey) {
        throw new Error("EXCHANGERATE_API_KEY is not set");
      }
      const apiUrl = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`;
      const apiRes = await fetch(apiUrl);

      if (!apiRes.ok) {
        const body = await apiRes.text();
        throw new Error(`ExchangeRate-API error ${apiRes.status}: ${body}`);
      }

      const json = await apiRes.json();

      if (json.result !== "success") {
        throw new Error(`ExchangeRate-API returned: ${json.result}`);
      }

      const usdRates: Record<string, number> = json.conversion_rates;

      // 3. Build a rate map for only our currencies
      const rateFromUsd: Record<string, number> = {};
      for (const code of codes) {
        if (usdRates[code] === undefined) {
          throw new Error(`Currency ${code} not found in ExchangeRate-API response`);
        }
        rateFromUsd[code] = usdRates[code];
      }

      // 4. Compute all cross-rates and upsert
      // For every (from, to) pair where from !== to:
      //   rate = rateFromUsd[to] / rateFromUsd[from]
      const values: string[] = [];

      for (const from of codes) {
        for (const to of codes) {
          if (from === to) continue;
          const rate = rateFromUsd[to] / rateFromUsd[from];
          values.push(`('${from}', '${to}', ${rate}, now())`);
        }
      }

      const upsertQuery = `
        INSERT INTO exchange_rates (from_currency, to_currency, rate, last_updated)
        VALUES ${values.join(",\n               ")}
        ON CONFLICT (from_currency, to_currency)
        DO UPDATE SET rate = EXCLUDED.rate, last_updated = EXCLUDED.last_updated;
      `;

      await conn.queryObject(upsertQuery);

      return new Response(
        JSON.stringify({
          success: true,
          pairs: values.length,
          currencies: codes,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("update-exchange-rates error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    await pool.end();
  }
});