import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [".next/**", "out/**", "build/**", "coverage/**", "node_modules/**", "next-env.d.ts", "**/.claude/worktrees/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Underscore bindings intentionally omit fields or stand in for unused
      // callback parameters. Unused ordinary bindings still produce findings.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
];

export default config;
