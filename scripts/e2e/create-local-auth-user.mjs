const [apiUrl, anonKey, email, password, displayName] =
  process.argv.slice(2);
if (!apiUrl || !anonKey || !email || !password || !displayName) {
  console.error(
    "usage: create-local-auth-user.mjs <api-url> <anon-key> <email> <password> <display-name>",
  );
  process.exit(2);
}

const url = new URL(apiUrl);
if (
  url.protocol !== "http:"
  || !["127.0.0.1", "[::1]"].includes(url.hostname)
  || url.username !== ""
  || url.password !== ""
  || url.pathname !== "/"
  || url.search !== ""
  || url.hash !== ""
) {
  throw new Error(
    `refusing to create an E2E user outside literal local GoTrue: ${apiUrl}`,
  );
}

const response = await fetch(`${apiUrl.replace(/\/$/, "")}/auth/v1/signup`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password,
    data: { full_name: displayName },
  }),
});

if (!response.ok) {
  throw new Error(
    `local GoTrue signup failed (${response.status}): ${await response.text()}`,
  );
}
const payload = await response.json();
if (!payload.user?.id || !payload.access_token) {
  throw new Error(
    "local GoTrue signup did not return an authenticated user session",
  );
}
console.log("Created isolated local browser-test user.");
