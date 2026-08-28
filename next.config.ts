import type { NextConfig } from "next";

// The site serves a public, unauthenticated page (/wantlist) alongside the
// signed-in dashboard, so these are no longer optional. Applied to every route.
const securityHeaders = [
  // Clickjacking: nothing may frame us.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak dashboard URLs (which carry card ids) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
