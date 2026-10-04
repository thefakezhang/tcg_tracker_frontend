\set ON_ERROR_STOP on

-- Disposable local-browser fixture only.
-- This file is never a migration and must run only after the harness has
-- reset the isolated local Supabase test database while holding the browser
-- lock.

INSERT INTO public.auth_principal_map
  (email, principal, expected_provider, note)
VALUES
  (lower(:'operator_email'), 'administrator', 'email', 'financial-integrity browser fixture'),
  ('financial-buyer@example.test', 'buyer', 'email', 'financial-integrity browser fixture')
ON CONFLICT (email) DO UPDATE
SET principal = EXCLUDED.principal,
    expected_provider = EXCLUDED.expected_provider,
    note = EXCLUDED.note,
    bound_user_id = NULL,
    bound_at = NULL;

INSERT INTO public.inventory_listing_platforms
  (platform, market_region, can_push, is_active, notes)
VALUES
  ('tcgplayer', 'NA', false, true, 'financial-integrity browser fixture')
ON CONFLICT (platform) DO UPDATE
SET market_region = EXCLUDED.market_region,
    can_push = EXCLUDED.can_push,
    is_active = EXCLUDED.is_active,
    notes = EXCLUDED.notes;

INSERT INTO public.pokemon_sealed_products
  (product_id, product_uid, name, set_code, product_type, language)
VALUES
  (9000001, 'f1625000-0000-4000-8000-000000000001',
   'Financial Integrity Booster Box', 'FI25', 'booster_box', 'jp')
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO public.acquisition_lots
  (lot_id, acquired_at, orig_currency, total_cost_orig, fx_rate_used,
   total_cost_usd, leg, shop_label)
VALUES
  (9000002, DATE '2026-10-03', 'USD', 300, 1, 300, 'import',
   'Financial integrity sealed fixture');

INSERT INTO public.pokemon_sealed_lot_lines
  (lot_id, product_id, sealed_condition, variant_edition, quantity,
   qty_remaining, price_override_usd)
VALUES
  (9000002, 9000001, 'standard', 'standard', 3, 3, 100);

SELECT public.finalize_acquisition_lot(9000002, 'sell');

INSERT INTO public.sale_lots
  (sale_group, sold_at, leg, orig_currency, gross_proceeds_orig,
   fx_rate_used, gross_proceeds_usd, requested_allocation_method,
   effective_allocation_method, status, finalized_at, snapshot, notes)
VALUES
  (9000001, DATE '2026-10-03', 'import', 'USD', 250, 1, 250,
   'market_value', 'market_value', 'finalized', now(), '{}'::jsonb,
   'Financial integrity trade fixture');

INSERT INTO public.acquisition_lots
  (lot_id, acquired_at, orig_currency, total_cost_orig, fx_rate_used,
   total_cost_usd, leg, lines_imported, shop_label)
VALUES
  (9000001, DATE '2026-10-03', 'USD', 250, 1, 250, 'import', true,
   'Financial integrity trade fixture');

INSERT INTO public.pokemon_card_definitions
  (card_id, card_uid, regional_name, english_name, set_code, card_number,
   language, misc_info)
VALUES
  (9000001, 'f1625000-0000-4000-8000-000000000002',
   '資金整合性テスト', 'Financial Integrity Card', 'FI25', '001/001',
   'jp', 'UNKNOWN')
ON CONFLICT (card_id) DO NOTHING;

INSERT INTO public.trips
  (trip_id, name, started_at, status, notes)
VALUES
  (9000001, 'Financial integrity acquisition', DATE '2026-10-01',
   'active', 'financial-integrity browser fixture');

INSERT INTO public.purchase_plans
  (plan_id, name, trip_id, status, assigned_buyer_email, ordered_at, notes)
VALUES
  (9000001, 'Financial integrity funded purchase', 9000001, 'draft',
   'financial-buyer@example.test', NULL, 'financial-integrity browser fixture'),
  (9000002, 'Financial integrity stale-read cancellation', NULL, 'draft',
   NULL, NULL, 'attached to the buyer only after settlement');

INSERT INTO public.purchase_plan_lines
  (plan_line_id, plan_id, game, card_id, psa_grade, planned_quantity,
   source, source_listing_url, unit_price_orig, currency, notes)
VALUES
  (9000001, 9000001, 'pokemon', 9000001, 0, 1, 'cardrush',
   'https://example.test/financial-integrity-cancelled', 500, 'JPY',
   'fully refunded cancellation before reconciliation'),
  (9000002, 9000001, 'pokemon', 9000001, 0, 1, 'cardrush',
   'https://example.test/financial-integrity-standing', 1400, 'JPY',
   'standing price-changed purchase'),
  (9000003, 9000002, 'pokemon', 9000001, 0, 1, 'cardrush',
   'https://example.test/financial-integrity-stale-refund', 100, 'JPY',
   'attached after settlement for stale-read proof');

INSERT INTO public.purchase_plan_line_results
  (plan_line_id, outcome, purchased_quantity, unit_price_jpy,
   delivery_status, delivery_status_at, note)
VALUES
  (9000001, 'purchased', 1, 500, 'cancelled', now(),
   'fully refunded cancellation before reconciliation'),
  (9000002, 'price_changed_bought', 1, 1500, 'arrived', now(),
   'standing price-changed purchase'),
  (9000003, 'purchased', 1, 100, 'cancelled', now(),
   'attached after settlement for stale-read proof');

INSERT INTO public.purchase_plan_source_costs
  (plan_id, source, kind, amount_jpy, note)
VALUES
  (9000001, 'cardrush', 'shipping', 15,
   'explicit source shipping for browser reconciliation');

UPDATE public.purchase_plans
SET status = 'ordered',
    ordered_at = now()
WHERE plan_id = 9000001;
