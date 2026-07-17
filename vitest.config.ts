import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal vitest config: map the "@/..." alias (from tsconfig paths) and use the
// automatic JSX runtime so component render tests work. Test environment is left
// to per-file `// @vitest-environment` annotations - logic tests stay on node,
// render tests opt into jsdom.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
