\set ON_ERROR_STOP on

INSERT INTO public.auth_principal_map (
    email,
    principal,
    expected_provider,
    bound_user_id,
    bound_at,
    note
)
SELECT lower(:'administrator_email'),
       'administrator',
       'email',
       auth_user.id,
       now(),
       'isolated Twitter arrivals browser fixture'
  FROM auth.users auth_user
 WHERE lower(auth_user.email) = lower(:'administrator_email')
ON CONFLICT (email) DO UPDATE
SET principal = EXCLUDED.principal,
    expected_provider = EXCLUDED.expected_provider,
    bound_user_id = EXCLUDED.bound_user_id,
    bound_at = EXCLUDED.bound_at,
    note = EXCLUDED.note,
    updated_at = now();

WITH fixture_post AS (
    SELECT fixture_number,
           CASE
               WHEN fixture_number = 106 THEN 'cardrush-online'
               ELSE 'alice'
           END AS buyer_handle,
           CASE
               WHEN fixture_number = 106 THEN 'cardrush_online'
               ELSE 'TCGshop_alice'
           END AS twitter_handle,
           (2113000000000000000::bigint + fixture_number)::text AS tweet_id,
           timestamptz '2026-10-20 01:15:00+00' AS tweet_created_at,
           timestamptz '2026-10-20 01:20:00+00' AS recovered_at
      FROM generate_series(1, 106) fixture_number
)
INSERT INTO public.buylist_tweet_acquisitions (
    tweet_id,
    buyer_handle,
    twitter_handle,
    tweet_url,
    tweet_created_at,
    first_acquired_at
)
SELECT tweet_id,
       buyer_handle,
       twitter_handle,
       'https://x.com/' || twitter_handle || '/status/' || tweet_id,
       tweet_created_at,
       recovered_at
  FROM fixture_post;

WITH fixture_post AS (
    SELECT fixture_number,
           CASE
               WHEN fixture_number = 106 THEN 'cardrush-online'
               ELSE 'alice'
           END AS buyer_handle,
           CASE
               WHEN fixture_number = 106 THEN 'cardrush_online'
               ELSE 'TCGshop_alice'
           END AS twitter_handle,
           (2113000000000000000::bigint + fixture_number)::text AS tweet_id,
           timestamptz '2026-10-20 01:20:00+00' AS recovered_at,
           lpad(to_hex(fixture_number), 64, '0') AS content_sha256,
           CASE
               WHEN fixture_number % 2 = 0 THEN 'landscape'
               ELSE 'portrait'
           END AS orientation
      FROM generate_series(1, 106) fixture_number
)
INSERT INTO public.buylist_media_acquisition_outcomes (
    buyer_handle,
    twitter_handle,
    tweet_id,
    tweet_url,
    source_image_index,
    source_image_url,
    outcome_status,
    reason_code,
    http_status,
    content_type,
    content_sha256,
    content_bytes,
    stored_image_path,
    first_attempted_at,
    last_attempted_at,
    recovered_at,
    evidence
)
SELECT buyer_handle,
       twitter_handle,
       tweet_id,
       'https://x.com/' || twitter_handle || '/status/' || tweet_id,
       0,
       'https://arrival-fixture.invalid/media/' || tweet_id || '-' || orientation || '.jpg',
       'acquired',
       'validated_image',
       200,
       'image/jpeg',
       content_sha256,
       10,
       'raw/sha256/' || left(content_sha256, 2) || '/' || content_sha256 || '.body',
       recovered_at,
       recovered_at,
       recovered_at,
       jsonb_build_object(
           'schema_version', 1,
           'availability_context', jsonb_build_object('eligible', true),
           'media_cas', jsonb_build_object(
               'receipt_version', 1,
               'storage_provider', 's3',
               'bucket', 'twitter-arrival-fixture',
               'object_key', 'raw/sha256/' || left(content_sha256, 2) || '/' || content_sha256 || '.body',
               'sha256', content_sha256,
               'size_bytes', 10,
               'content_type', 'image/jpeg',
               'verified_readback', true
           )
       )
  FROM fixture_post;

DO $fixture$
DECLARE
    v_admin_count integer;
    v_post_count integer;
    v_media_count integer;
BEGIN
    SELECT count(*) INTO v_admin_count
      FROM public.auth_principal_map
     WHERE note = 'isolated Twitter arrivals browser fixture'
       AND principal = 'administrator'
       AND expected_provider = 'email'
       AND bound_user_id IS NOT NULL;
    SELECT count(*) INTO v_post_count
      FROM public.buylist_tweet_acquisitions
     WHERE tweet_id LIKE '2113000000000000%';
    SELECT count(*) INTO v_media_count
      FROM public.buylist_media_acquisition_outcomes
     WHERE tweet_id LIKE '2113000000000000%'
       AND outcome_status = 'acquired';
    IF v_admin_count <> 1 OR v_post_count <> 106 OR v_media_count <> 106 THEN
        RAISE EXCEPTION
            'arrival browser fixture mismatch admin=% posts=% media=%',
            v_admin_count,
            v_post_count,
            v_media_count;
    END IF;
END
$fixture$;
