import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal vitest config: map the "@/..." alias (from tsconfig paths) and use the
// automatic JSX runtime so component render tests work. Test environment is left
// to per-file `// @vitest-environment` annotations - logic tests stay on node,
// render tests opt into jsdom.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
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
