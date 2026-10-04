\set ON_ERROR_STOP on

-- The browser fixture first captures a normal authenticated token, then uses
-- this local-only step to mint an administrator session for the same user.
-- The enclosing harness resets the disposable database before releasing its
-- browser/Docker lock.
WITH promoted AS (
  UPDATE auth.users
     SET role = 'administrator'
   WHERE lower(email) = lower(:'operator_email')
  RETURNING id
)
SELECT count(*) FROM promoted;
