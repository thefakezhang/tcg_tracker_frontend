\set ON_ERROR_STOP on

CREATE TEMP TABLE generated_recognition_fixture (
    value jsonb NOT NULL
);
INSERT INTO generated_recognition_fixture (value)
SELECT pg_read_file('/tmp/ordinary-recognition-output.json')::jsonb;
GRANT SELECT ON generated_recognition_fixture TO service_role;

INSERT INTO public.source_run_operators (user_id, note)
SELECT auth_user.id, 'isolated unresolved price observation browser fixture'
  FROM auth.users auth_user
 WHERE lower(auth_user.email) = lower(:'operator_email');

INSERT INTO public.buylist_tweet_acquisitions (
    tweet_id, buyer_handle, twitter_handle, tweet_url,
    tweet_created_at, first_acquired_at
) VALUES
    (
        '2114000000000000001', 'fixture-sealed', 'fixture_sealed',
        'https://x.com/fixture_sealed/status/2114000000000000001',
        timestamptz '2026-10-20 13:00:00+00',
        timestamptz '2026-10-20 13:01:00+00'
    ),
    (
        '2114000000000000002', 'fixture-singles', 'fixture_singles',
        'https://x.com/fixture_singles/status/2114000000000000002',
        timestamptz '2026-10-20 14:00:00+00',
        timestamptz '2026-10-20 14:01:00+00'
    ),
    (
        '2114000000000000003', 'snkrdunk', 'fixture_generated',
        'https://x.com/fixture_generated/status/2114000000000000003',
        timestamptz '2026-10-20 15:00:00+00',
        timestamptz '2026-10-20 15:01:00+00'
    );

INSERT INTO public.pending_buylist_tweets (
    buyer_handle, twitter_handle, tweet_id, tweet_url, tweet_text,
    tweet_date, image_urls, source_thread_root_id,
    source_thread_position, source_thread_root_text, status
) VALUES
    (
        'fixture-sealed', 'fixture_sealed', '2114000000000000001',
        'https://x.com/fixture_sealed/status/2114000000000000001',
        'Sealed Pokemon buylist', date '2026-10-20',
        '["https://unresolved-fixture.invalid/sealed.jpg"]'::jsonb,
        '2114000000000000001', 0, 'Sealed Pokemon buylist', 'processing'
    ),
    (
        'fixture-singles', 'fixture_singles', '2114000000000000002',
        'https://x.com/fixture_singles/status/2114000000000000002',
        'Pokemon singles buylist', date '2026-10-20',
        '["https://unresolved-fixture.invalid/singles.jpg"]'::jsonb,
        '2114000000000000002', 0, 'Pokemon singles buylist', 'processing'
    ),
    (
        'snkrdunk', 'fixture_generated', '2114000000000000003',
        'https://x.com/fixture_generated/status/2114000000000000003',
        'Pokemon singles buylist', date '2026-10-20',
        '["ordinary-recognition-source.bin"]'::jsonb,
        '2114000000000000003', 0, 'Pokemon singles buylist', 'processing'
    );

SELECT pending_id AS sealed_pending_id
  FROM public.pending_buylist_tweets
 WHERE tweet_id = '2114000000000000001'
\gset

SELECT pending_id AS singles_pending_id
  FROM public.pending_buylist_tweets
 WHERE tweet_id = '2114000000000000002'
\gset

SELECT pending_id AS generated_pending_id
  FROM public.pending_buylist_tweets
 WHERE tweet_id = '2114000000000000003'
\gset

INSERT INTO public.alert_rules (kind, card_id, cohort, sources, active)
VALUES (
    'tweet_inventory', NULL, 'twitter_inventory_v1:snkrdunk',
    ARRAY['snkrdunk'], true
);

SET ROLE service_role;

INSERT INTO public.buylist_media_routing_outcomes (
    pending_id, tweet_id, buyer_handle, source_image_index,
    source_image_url, policy_version, disposition,
    selected_product_kind, reason_code, evidence,
    outcome_schema_version, twitter_handle, tweet_url,
    source_thread_root_id, source_thread_position, source_thread_root_text,
    media_kind, game_classification, actionability, recognition_reason,
    candidate_count, uncertainty_flags, source_content_sha256, routed_at
)
SELECT :'sealed_pending_id'::bigint,
       '2114000000000000001',
       'fixture-sealed',
       0,
       'https://unresolved-fixture.invalid/sealed.jpg',
       'fixture-sealed-v1:outcome-v2',
       'routed',
       'sealed',
       'configured_product_kind',
       jsonb_build_object(
           'recognition', jsonb_build_object(
               'price_side', 'bid',
               'grading', 'raw',
               'unresolved_priced_observations', jsonb_build_array(
                   jsonb_build_object(
                       'schema_version', 1,
                       'source_image_index', 0,
                       'source_cell_index', 0,
                       'source_image_width', 1200,
                       'source_image_height', 800,
                       'product_kind', 'sealed',
                       'identity', jsonb_build_object(
                           'status', 'unresolved',
                           'reason', 'matcher_abstained',
                           'catalog_id', NULL
                       ),
                       'grade', jsonb_build_object(
                           'status', 'not_applicable',
                           'value', NULL
                       ),
                       'variant', 'shrink_wrapped',
                       'price_side', 'bid',
                       'source_geometry', jsonb_build_object(
                           'card', jsonb_build_object(
                               'x0', 10, 'y0', 10, 'x1', 110, 'y1', 140
                           ),
                           'price', jsonb_build_object(
                               'x0', 10, 'y0', 150, 'x1', 110, 'y1', 175
                           )
                       ),
                       'effective_geometry', jsonb_build_object(
                           'card', jsonb_build_object(
                               'x0', 11, 'y0', 10, 'x1', 111, 'y1', 140
                           ),
                           'price', jsonb_build_object(
                               'x0', 11, 'y0', 150, 'x1', 111, 'y1', 175
                           )
                       ),
                       'detector_context', jsonb_build_object(
                           'processor', 'fixture.sealed',
                           'format', 'grid',
                           'layout_version', 'fixture-v1',
                           'calibration', NULL,
                           'routing_policy_version', 'fixture-sealed-v1:outcome-v2'
                       ),
                       'prices', jsonb_build_array(
                           jsonb_build_object(
                               'amount_jpy', 42000,
                               'tier', 'shrink_wrapped',
                               'source_bbox', jsonb_build_object(
                                   'x0', 10, 'y0', 150, 'x1', 110, 'y1', 175
                               ),
                               'effective_bbox', jsonb_build_object(
                                   'x0', 11, 'y0', 150, 'x1', 111, 'y1', 175
                               ),
                               'evidence', jsonb_build_object(
                                   'verified', true,
                                   'method', 'currency_marker',
                                   'ocr_confidence', 0.96,
                                   'banner', NULL
                               )
                           )
                       ),
                       'financial_eligibility', 'ineligible_unresolved_identity'
                   )
               )
           )
       ),
       2,
       'fixture_sealed',
       'https://x.com/fixture_sealed/status/2114000000000000001',
       '2114000000000000001',
       0,
       'Sealed Pokemon buylist',
       'buylist_sheet',
       'pokemon',
       'review_required',
       'no_actionable_candidates',
       0,
       '["no_actionable_candidates","unresolved_item_identity"]'::jsonb,
       repeat('b', 64),
       timestamptz '2026-10-20 13:02:00+00'
;

WITH cells AS (
    SELECT cell,
           10 + (cell % 6) * 190 AS x0,
           10 + (cell / 6) * 190 AS y0
      FROM generate_series(0, 21) cell
), observations AS (
    SELECT cell,
           jsonb_build_object(
               'schema_version', 1,
               'source_image_index', 0,
               'source_cell_index', cell,
               'source_image_width', 1200,
               'source_image_height', 800,
               'product_kind', 'singles',
               'identity', jsonb_build_object(
                   'status', 'unresolved',
                   'reason', 'matcher_abstained',
                   'catalog_id', NULL
               ),
               'grade', CASE
                   WHEN cell = 1 THEN jsonb_build_object(
                       'status', 'observed', 'value', 'psa_10'
                   )
                   ELSE jsonb_build_object(
                       'status', 'not_observed', 'value', NULL
                   )
               END,
               'variant', CASE WHEN cell = 2 THEN 'reverse_holo' ELSE NULL END,
               'price_side', 'bid',
               'source_geometry', jsonb_build_object(
                   'card', jsonb_build_object(
                       'x0', x0, 'y0', y0, 'x1', x0 + 100, 'y1', y0 + 130
                   ),
                   'price', jsonb_build_object(
                       'x0', x0, 'y0', y0 + 140,
                       'x1', x0 + 100, 'y1', y0 + 165
                   )
               ),
               'effective_geometry', jsonb_build_object(
                   'card', jsonb_build_object(
                       'x0', x0 + 1, 'y0', y0,
                       'x1', x0 + 101, 'y1', y0 + 130
                   ),
                   'price', jsonb_build_object(
                       'x0', x0 + 1, 'y0', y0 + 140,
                       'x1', x0 + 101, 'y1', y0 + 165
                   )
               ),
               'detector_context', jsonb_build_object(
                   'processor', 'fixture.singles',
                   'format', 'grid',
                   'layout_version', 'fixture-v1',
                   'calibration', jsonb_build_object('x_offset', 1),
                   'routing_policy_version', 'fixture-singles-v1:outcome-v2'
               ),
               'prices', jsonb_build_array(
                   jsonb_build_object(
                       'amount_jpy', CASE
                           WHEN cell = 1 THEN 88000
                           ELSE 10000 + cell * 1000
                       END,
                       'tier', 'item',
                       'source_bbox', jsonb_build_object(
                           'x0', x0, 'y0', y0 + 140,
                           'x1', x0 + 100, 'y1', y0 + 165
                       ),
                       'effective_bbox', jsonb_build_object(
                           'x0', x0 + 1, 'y0', y0 + 140,
                           'x1', x0 + 101, 'y1', y0 + 165
                       ),
                       'evidence', jsonb_build_object(
                           'verified', true,
                           'method', 'currency_marker',
                           'ocr_confidence', 0.93,
                           'banner', NULL
                       )
                   )
               ),
               'financial_eligibility', 'ineligible_unresolved_identity'
           ) AS observation
      FROM cells
), evidence AS (
    SELECT jsonb_build_object(
               'recognition', jsonb_build_object(
                   'price_side', 'bid',
                   'grading', 'raw',
                   'unresolved_priced_observations', jsonb_agg(
                       observation ORDER BY cell
                   )
               )
           ) AS value
      FROM observations
)
INSERT INTO public.buylist_media_routing_outcomes (
    pending_id, tweet_id, buyer_handle, source_image_index,
    source_image_url, policy_version, disposition,
    selected_product_kind, reason_code, evidence,
    outcome_schema_version, twitter_handle, tweet_url,
    source_thread_root_id, source_thread_position, source_thread_root_text,
    media_kind, game_classification, actionability, recognition_reason,
    candidate_count, uncertainty_flags, source_content_sha256, routed_at
)
SELECT :'singles_pending_id'::bigint,
       '2114000000000000002',
       'fixture-singles',
       0,
       'https://unresolved-fixture.invalid/singles.jpg',
       'fixture-singles-v1:outcome-v2',
       'routed',
       'singles',
       'configured_product_kind',
       evidence.value,
       2,
       'fixture_singles',
       'https://x.com/fixture_singles/status/2114000000000000002',
       '2114000000000000002',
       0,
       'Pokemon singles buylist',
       'buylist_sheet',
       'pokemon',
       'review_required',
       'no_actionable_candidates',
       0,
       '["no_actionable_candidates","unresolved_item_identity"]'::jsonb,
       repeat('a', 64),
       timestamptz '2026-10-20 14:02:00+00'
  FROM evidence;

WITH generated AS (
    SELECT fixture.value -> 'outcome' AS value
      FROM generated_recognition_fixture fixture
)
INSERT INTO public.buylist_media_routing_outcomes (
    pending_id, tweet_id, buyer_handle, source_image_index,
    source_image_url, policy_version, disposition,
    selected_product_kind, reason_code, evidence,
    outcome_schema_version, twitter_handle, tweet_url,
    source_thread_root_id, source_thread_position, source_thread_root_text,
    media_kind, game_classification, actionability, recognition_reason,
    candidate_count, uncertainty_flags, source_content_sha256, routed_at
)
SELECT :'generated_pending_id'::bigint,
       value ->> 'tweet_id',
       value ->> 'buyer_handle',
       (value ->> 'source_image_index')::integer,
       value ->> 'source_image_url',
       value ->> 'policy_version',
       value ->> 'disposition',
       value ->> 'selected_product_kind',
       value ->> 'reason_code',
       value -> 'evidence',
       2,
       value ->> 'twitter_handle',
       value ->> 'tweet_url',
       value ->> 'source_thread_root_id',
       (value ->> 'source_thread_position')::smallint,
       value ->> 'source_thread_root_text',
       value ->> 'media_kind',
       value ->> 'game_classification',
       value ->> 'actionability',
       value ->> 'recognition_reason',
       (value ->> 'candidate_count')::integer,
       value -> 'uncertainty_flags',
       value ->> 'source_content_sha256',
       timestamptz '2026-10-20 15:02:00+00'
  FROM generated;

RESET ROLE;

UPDATE public.pending_buylist_tweets
   SET status = 'processed',
       processed_at = timestamptz '2026-10-20 15:02:01+00'
 WHERE tweet_id = '2114000000000000003';

DO $fixture$
DECLARE
    v_operator_count integer;
    v_observation_count integer;
    v_candidate_count integer;
    v_alert_count integer;
    v_generated_exact_count integer;
    v_active_rule_count integer;
BEGIN
    SELECT count(*) INTO v_operator_count
      FROM public.source_run_operators
     WHERE note = 'isolated unresolved price observation browser fixture';
    SELECT count(*) INTO v_observation_count
      FROM public.buylist_media_routing_outcomes outcome
      CROSS JOIN LATERAL jsonb_array_elements(
          outcome.evidence -> 'recognition' -> 'unresolved_priced_observations'
      ) item
     WHERE outcome.tweet_id LIKE '211400000000000000%';
    SELECT (
        (SELECT count(*) FROM public.pokemon_image_buylist_candidates
          WHERE source_tweet_id LIKE '211400000000000000%')
        +
        (SELECT count(*) FROM public.pokemon_sealed_image_buylist_candidates
          WHERE source_tweet_id LIKE '211400000000000000%')
    ) INTO v_candidate_count;
    SELECT count(*) INTO v_alert_count
      FROM public.buylist_alert_outbox alert
      JOIN public.buylist_media_routing_outcomes outcome
        ON outcome.routing_outcome_id = alert.routing_outcome_id
     WHERE outcome.tweet_id LIKE '211400000000000000%';
    SELECT count(*) INTO v_generated_exact_count
      FROM public.buylist_media_routing_outcomes outcome
     WHERE outcome.tweet_id = '2114000000000000003'
       AND outcome.evidence = (
           SELECT fixture.value -> 'outcome' -> 'evidence'
             FROM generated_recognition_fixture fixture
       )
       AND outcome.source_content_sha256 = (
           SELECT fixture.value -> 'outcome' ->> 'source_content_sha256'
             FROM generated_recognition_fixture fixture
       )
       AND outcome.candidate_count = 0;
    SELECT count(*) INTO v_active_rule_count
      FROM public.alert_rules
     WHERE active
       AND kind = 'tweet_inventory'
       AND card_id IS NULL
       AND 'snkrdunk' = ANY(sources);
    IF v_operator_count <> 1
       OR v_observation_count <> 25
       OR v_candidate_count <> 0
       OR v_alert_count <> 0
       OR v_generated_exact_count <> 1
       OR v_active_rule_count <> 1 THEN
        RAISE EXCEPTION
            'unresolved observation fixture mismatch operators=% observations=% candidates=% alerts=% generated_exact=% active_rules=%',
            v_operator_count, v_observation_count, v_candidate_count, v_alert_count,
            v_generated_exact_count, v_active_rule_count;
    END IF;
END
$fixture$;
