const [apiUrl, anonKey, email, password, displayName, outputPath] =
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

const signupURL = `${apiUrl.replace(/\/$/, "")}/auth/v1/signup`;
const signupBody = JSON.stringify({
  email,
  password,
  data: { full_name: displayName },
});
const authHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
  "Content-Type": "application/json",
};

async function reconcileCommittedSignup() {
  try {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

async function signupWithTransientRetry() {
  const maximumAttempts = 8;
  let lastFailure;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(signupURL, {
        method: "POST",
        headers: authHeaders,
        body: signupBody,
        signal: AbortSignal.timeout(5_000),
      });
    } catch (cause) {
      lastFailure = cause;
    }
    if (response?.ok) return response;
    if (response) {
      const body = await response.text();
      if (response.status < 500 || response.status > 599) {
        const reconciled = await reconcileCommittedSignup();
        if (reconciled) return reconciled;
        throw new Error(`local GoTrue signup failed (${response.status}): ${body}`);
      }
      lastFailure = new Error(`local GoTrue signup failed (${response.status}): ${body}`);
    }
    const reconciled = await reconcileCommittedSignup();
    if (reconciled) return reconciled;
    if (attempt < maximumAttempts) {
      const backoffMs = Math.min(2_000, 250 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error("local GoTrue signup stayed unavailable after bounded retries", {
    cause: lastFailure,
  });
}

const response = await signupWithTransientRetry();
const payload = await response.json();
if (!payload.user?.id || !payload.access_token) {
  throw new Error(
    "local GoTrue signup did not return an authenticated user session",
  );
}
if (outputPath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outputPath, JSON.stringify({
    userID: payload.user.id,
    accessToken: payload.access_token,
  }), { mode: 0o600 });
}
console.log(`Created isolated local browser-test user ${payload.user.id}.`);
