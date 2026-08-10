import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal vitest config: map the "@/..." alias (from tsconfig paths) and use the
// automatic JSX runtime so component render tests work. Test environment is left
// to per-file `// @vitest-environment` annotations - logic tests stay on node,
// render tests opt into jsdom.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    // A high-core workstation otherwise starts enough jsdom workers to starve
    // individual interaction tests and trip the default five-second timeout.
    // Four workers keep the suite parallel without making timing host-specific.
    maxWorkers: 4,
    testTimeout: 10_000,
    // Next.js substitutes these public values during its build, but Vitest
    // executes source modules directly. Give browser-client code a deterministic
    // local endpoint so render tests never depend on a developer's .env.local.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
    // Several agents work this repo at once, each in a git worktree under
    // .claude/worktrees/. Those are separate checkouts that run their own
    // suite from their own root - collecting them here is wrong twice over:
    // it reports another branch's failures as this branch's, and the "@"
    // alias below resolves to THIS checkout, so a worktree's test renders a
    // worktree component against main's contexts and fails on a mismatch
    // that exists in neither tree.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.claude/worktrees/**",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
