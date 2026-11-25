import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The Deno edge functions under supabase/functions are excluded from
// tsconfig.json, because they import from URLs the Next.js build cannot
// resolve, so nothing type-checked them at all. On 2026-11-25 a refactor of
// aggregate-prices deleted NET_EXIT, exitCostJoin and netFrom while the sealed
// pass still used them. It parsed, it deployed, and the 07:00 UTC run truncated
// the sealed summaries and then threw "ReferenceError: NET_EXIT is not
// defined", leaving the Sealed Browser empty until it was redeployed.
//
// This compiles each function and fails on any name that resolves to nothing
// (TS2304 and the related "did you mean" forms). URL imports are expected not
// to resolve here, so their diagnostics are ignored, and Deno's own global is
// declared. Type errors in general are not asserted: the goal is the one
// failure class a deploy cannot survive.
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "supabase", "functions");
const UNRESOLVED_NAME = new Set([2304, 2552, 2582]);
const DENO_SHIM = "declare const Deno: { env: { get(name: string): string | undefined } };\n";

function unresolvedNames(file: string): string[] {
  const host = ts.createCompilerHost({});
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (path.resolve(name) === file) {
      const text = ts.sys.readFile(file) ?? "";
      return ts.createSourceFile(name, DENO_SHIM + text, languageVersion, true);
    }
    return original(name, languageVersion, onError, shouldCreate);
  };
  const program = ts.createProgram({
    rootNames: [file],
    options: { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], noResolve: true, skipLibCheck: true },
    host,
  });
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(file))
    .filter((d) => UNRESOLVED_NAME.has(d.code))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("edge functions", () => {
  const functions = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(FUNCTIONS_DIR, entry.name, "index.ts"));

  it("finds the functions it guards", () => {
    expect(functions.map((f) => path.basename(path.dirname(f)))).toContain("aggregate-prices");
  });

  for (const file of functions) {
    it(`${path.basename(path.dirname(file))} uses no undefined name`, () => {
      expect(unresolvedNames(file)).toEqual([]);
    });
  }
});
