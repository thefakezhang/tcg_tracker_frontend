import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Worktrees can live below a different repository that also has a lockfile.
  // Pin tracing to this app instead of letting Next.js infer the outer repo.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
