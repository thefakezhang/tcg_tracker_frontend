import http from "node:http";

const port = Number(process.env.ROUTER_PORT);
const authOrigin = new URL(process.env.AUTH_ORIGIN ?? "");
const restOrigin = new URL(process.env.REST_ORIGIN ?? "");
const loopbackHosts = new Set(["127.0.0.1", "[::1]", "::1"]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("ROUTER_PORT must be a valid TCP port");
}
for (const [label, origin] of [["AUTH_ORIGIN", authOrigin], ["REST_ORIGIN", restOrigin]]) {
  if (origin.protocol !== "http:" || !loopbackHosts.has(origin.hostname)) {
    throw new Error(`${label} must be a literal loopback HTTP origin`);
  }
}

const server = http.createServer((request, response) => {
  const requestURL = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (requestURL.pathname === "/__health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }

  let targetOrigin;
  let targetPath;
  if (requestURL.pathname === "/auth/v1" || requestURL.pathname.startsWith("/auth/v1/")) {
    targetOrigin = authOrigin;
    targetPath = requestURL.pathname.slice("/auth/v1".length) || "/";
  } else if (requestURL.pathname === "/rest/v1" || requestURL.pathname.startsWith("/rest/v1/")) {
    targetOrigin = restOrigin;
    targetPath = requestURL.pathname.slice("/rest/v1".length) || "/";
  } else {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"fixture route not found"}');
    return;
  }

  const headers = { ...request.headers };
  headers.host = targetOrigin.host;
  headers["x-forwarded-host"] = `127.0.0.1:${port}`;
  headers["x-forwarded-proto"] = "http";
  const proxy = http.request({
    protocol: targetOrigin.protocol,
    hostname: targetOrigin.hostname,
    port: targetOrigin.port,
    method: request.method,
    path: `${targetPath}${requestURL.search}`,
    headers,
  }, (upstream) => {
    response.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { "content-type": "application/json" });
    response.end('{"error":"isolated fixture upstream unavailable"}');
  });
  request.on("aborted", () => proxy.destroy());
  request.pipe(proxy);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`isolated Supabase router ready on 127.0.0.1:${port}\n`);
});

function stop() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
