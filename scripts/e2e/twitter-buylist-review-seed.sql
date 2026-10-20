\set ON_ERROR_STOP on

BEGIN;

INSERT INTO locations (name, location_type, market_region)
VALUES ('cardrush_poke', 'Online', 'JP');

INSERT INTO pokemon_card_definitions (
  card_uid, regional_name, english_name, set_code, card_number, language
) VALUES
  (
    'e798eed8-c2dd-4c36-96e3-0fbb5a7db31c'::uuid,
    'ボスごっこピカチュウ スカル団', 'Pretend Boss Pikachu',
    'SM-P', '197/SM-P', 'jp'
  ),
  (
    '4edf0d33-d1fa-459b-9645-30a332144fda'::uuid,
    'トウホクのピカチュウ', 'Tohoku Pikachu',
    'SM-P', '088/SM-P', 'jp'
  );

INSERT INTO buylist_tweet_acquisitions (
  tweet_id, buyer_handle, twitter_handle, tweet_url
) VALUES (
  '2112078363095715923', 'cardrush_poke', 'cardrush_poke',
  'https://x.com/cardrush_poke/status/2112078363095715923'
);

WITH pending AS (
  INSERT INTO pending_buylist_tweets (
    buyer_handle, twitter_handle, tweet_id, tweet_url, tweet_text,
    tweet_date, image_urls, source_thread_root_id,
    source_thread_position, source_thread_root_text, status
  ) VALUES (
    'cardrush_poke', 'cardrush_poke', '2112078363095715923',
    'https://x.com/cardrush_poke/status/2112078363095715923',
    '#ポケモンカード 【PSA買取情報】 PSA10 ポケモンカード',
    CURRENT_DATE, jsonb_build_array(:'source_url'),
    '2112078363095715923', 0,
    '#ポケモンカード 【PSA買取情報】 PSA10 ポケモンカード',
    'processing'
  )
  RETURNING pending_id
), route AS (
  INSERT INTO buylist_media_routing_outcomes (
    pending_id, tweet_id, buyer_handle, source_image_index,
    source_image_url, policy_version, disposition,
    selected_product_kind, reason_code, evidence,
    outcome_schema_version, twitter_handle, tweet_url,
    source_thread_root_id, source_thread_position, source_thread_root_text,
    media_kind, game_classification, actionability, recognition_reason,
    candidate_count, uncertainty_flags, source_content_sha256
  )
  SELECT
    pending_id, '2112078363095715923', 'cardrush_poke', 0,
    :'source_url', 'cardrush-poke-visual-kind-v1:outcome-v2', 'routed',
    'singles', 'visual_kind_corroborated_by_tweet',
    '{
      "visual_hits":{"singles":["PSA 10","PSA10"],"sealed":[]},
      "context_hits":[],
      "tweet_hits":{"singles":["PSA 10","PSA10","PSA買取情報"],"sealed":[]},
      "recognition":{
        "card_game_summary":{
          "cells":13,"contradicting":0,"held":0,"sheet_wrong":false,
          "labels":{"pokemon":13},"policy_version":"card-game-sheet-v1"
        },
        "price_side":"bid","resolved_format":"psa10_header","grading":"psa_10"
      }
    }'::jsonb,
    2, 'cardrush_poke',
    'https://x.com/cardrush_poke/status/2112078363095715923',
    '2112078363095715923', 0,
    '#ポケモンカード 【PSA買取情報】 PSA10 ポケモンカード',
    'buylist_sheet', 'pokemon', 'review_required',
    'pokemon_candidates_require_review', 13,
    '["unverified_item_identity"]'::jsonb,
    'b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323'
  FROM pending
  RETURNING routing_outcome_id
)
SELECT routing_outcome_id FROM route;

INSERT INTO buylist_media_acquisition_outcomes (
  buyer_handle, twitter_handle, tweet_id, tweet_url,
  source_image_index, source_image_url, outcome_status, reason_code,
  http_status, content_type, content_sha256, content_bytes,
  stored_image_path, recovered_at, evidence
) VALUES (
  'cardrush_poke', 'cardrush_poke', '2112078363095715923',
  'https://x.com/cardrush_poke/status/2112078363095715923',
  0, :'source_url', 'acquired', 'downloaded', 200, 'image/jpeg',
  'b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323',
  774134,
  'raw/sha256/b3/b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323.body',
  NOW(),
  '{
    "schema_version":1,
    "media_cas":{
      "receipt_version":1,
      "storage_provider":"s3",
      "bucket":"private-media",
      "object_key":"raw/sha256/b3/b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323.body",
      "sha256":"b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323",
      "size_bytes":774134,
      "content_type":"image/jpeg",
      "verified_readback":true
    }
  }'::jsonb
);

INSERT INTO alert_rules (kind, card_id, cohort, sources, active)
VALUES (
  'tweet_inventory', NULL, 'twitter_inventory_v1:cardrush_poke',
  ARRAY['cardrush_poke']::text[], true
);

-- The ordinary replay emitted Pretend Boss Pikachu first and Tohoku Pikachu
-- twelfth. Insert in that order so the newest candidate, Tohoku, is the first
-- keyboard-selected row. Neither row carries automatic printed-identity or
-- quote-grade proof. Both retain the producer's review-required boundary.
INSERT INTO pokemon_image_buylist_candidates (
  source_tweet_url, source_tweet_id, source_tweet_text, source_tweet_date,
  source_author_handle, source_image_url, source_image_index,
  source_grid_bbox, effective_source_grid_bbox,
  source_image_width, source_image_height, cell_image_url,
  ocr_price_jpy, price_evidence, candidate_card_id, match_method,
  confidence, card_grading, variant_attrs, variant_source,
  transaction_direction, original_card_id, original_grading,
  original_price_jpy, original_variant_attrs, detector_geometry_context,
  card_image_hash, price_image_hash
) VALUES (
  'https://x.com/cardrush_poke/status/2112078363095715923',
  '2112078363095715923',
  '#ポケモンカード 【PSA買取情報】 PSA10 ポケモンカード',
  CURRENT_DATE, 'cardrush_poke', :'source_url', 0,
  '{"x0":85,"y0":184,"x1":319,"y1":655}'::jsonb,
  '{
    "card":{"x0":85,"y0":184,"x1":319,"y1":597},
    "price":{"x0":96,"y0":612,"x1":290,"y1":655}
  }'::jsonb,
  2000, 1414, :'source_url', 380000,
  '{"verified":true,"method":"currency_marker","ocr_confidence":0.945404,"banner":null}'::jsonb,
  (
    SELECT card_id FROM pokemon_card_definitions
    WHERE card_uid='e798eed8-c2dd-4c36-96e3-0fbb5a7db31c'::uuid
  ),
  'hybrid', 0.99, 'psa_10', '{}'::jsonb, 'overlay', 'buy_offer',
  (
    SELECT card_id FROM pokemon_card_definitions
    WHERE card_uid='e798eed8-c2dd-4c36-96e3-0fbb5a7db31c'::uuid
  ),
  'psa_10', 380000, '{}'::jsonb,
  '{
    "processor":"processors.cardrush_poke",
    "format":"psa10_header",
    "layout_version":"image-recognition-v1",
    "calibration":null,
    "routing_policy_version":"cardrush-poke-visual-kind-v1:outcome-v2"
  }'::jsonb,
  '98b4f40851d51f21b09140cec38a4e844dccb216a9ac8b22111e49d53739702f',
  'fd4ab9ea0450f3cac022fe6cb3062baf3a6ab611f7b323e13c47e62a04bb8dd8'
), (
  'https://x.com/cardrush_poke/status/2112078363095715923',
  '2112078363095715923',
  '#ポケモンカード 【PSA買取情報】 PSA10 ポケモンカード',
  CURRENT_DATE, 'cardrush_poke', :'source_url', 0,
  '{"x0":1286,"y0":693,"x1":1518,"y1":1168}'::jsonb,
  '{
    "card":{"x0":1286,"y0":693,"x1":1518,"y1":1113},
    "price":{"x0":1305,"y0":1126,"x1":1498,"y1":1168}
  }'::jsonb,
  2000, 1414, :'source_url', 270000,
  '{"verified":true,"method":"currency_marker","ocr_confidence":0.944256,"banner":null}'::jsonb,
  (
    SELECT card_id FROM pokemon_card_definitions
    WHERE card_uid='4edf0d33-d1fa-459b-9645-30a332144fda'::uuid
  ),
  'hybrid', 0.99, 'psa_10', '{}'::jsonb, 'overlay', 'buy_offer',
  (
    SELECT card_id FROM pokemon_card_definitions
    WHERE card_uid='4edf0d33-d1fa-459b-9645-30a332144fda'::uuid
  ),
  'psa_10', 270000, '{}'::jsonb,
  '{
    "processor":"processors.cardrush_poke",
    "format":"psa10_header",
    "layout_version":"image-recognition-v1",
    "calibration":null,
    "routing_policy_version":"cardrush-poke-visual-kind-v1:outcome-v2"
  }'::jsonb,
  '139555ed4f12ef6b20c2e333149b7a35214b12ec8e6c82ddba7d2923d4eeb90b',
  'ceb00c097339d4ef5f63e075b191a643eb69e2d628936f0040e9e8f98c23744c'
);

COMMIT;

SELECT jsonb_pretty(jsonb_build_object(
  'tweet_id', '2112078363095715923',
  'source_url', :'source_url',
  'candidate_count', (
    SELECT count(*) FROM pokemon_image_buylist_candidates
    WHERE source_tweet_id='2112078363095715923'
  ),
  'automatic_identity_proof_count', (
    SELECT count(*) FROM pokemon_image_buylist_candidates
    WHERE source_tweet_id='2112078363095715923'
      AND detector_geometry_context ? 'identity_evidence'
  )
));
