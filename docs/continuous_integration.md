# Frontend continuous integration

Every pull request that changes more than Markdown runs the `Frontend checks` workflow.
Its single Linux job installs the exact npm lockfile, runs ESLint and all Vitest unit and component tests, checks TypeScript, and builds the production Next.js application.
The result appears on the pull request as `Tests, types and production build`.
Reviewers should require a successful result for the current application revision before merging.

## Architecture and purpose

The job uses a fresh GitHub-hosted Ubuntu runner with Node 22 and an npm download cache keyed by the lockfile.
It caches package downloads rather than `node_modules`, so `npm ci` still checks and installs the committed dependency tree on every run.
Vitest uses two workers to bound memory and avoid contention between interaction tests.
Only one job runs, and a new push cancels the superseded run for that pull request.
There is no push-to-main duplicate run; the workflow can also be dispatched manually.
The job has read-only repository access and does not retain checkout credentials.

Visible, repeatable checks replace reliance on an unrecorded local test claim.
The production build catches Next.js errors that TypeScript and mocked component tests do not expose.
It uses the normal Google-font build path, so the runner needs outbound access for dependencies and fonts.

## Goals and non-goals

The gate covers the existing tests, TypeScript project, and production build without application secrets or an `.env.local` file.
Vitest already supplies its deterministic test-only Supabase configuration.
It does not start a database, contact production Supabase, run browser acceptance, deploy the application, or change branch protection.
Browser CUJ evidence remains a separate requirement for changes that need it.

For local equivalents, install dependencies with `npm ci`, then run `scripts/check.sh`.
See the [setup-node documentation](https://github.com/actions/setup-node) for the action's Node-version and npm-cache inputs.

## Lint

`npm run lint` invokes the declared ESLint CLI with the committed flat configuration; it never enters a first-run setup prompt.
The Next.js configuration is pinned to the installed Next.js version and enables the Core Web Vitals and TypeScript recommended rules.
Lint errors fail CI.
Warnings remain visible, including existing effect-dependency, native-image and unused-code findings; a passing command is not a claim that those warnings are resolved.
The intentional underscore convention for discarded fields and callback parameters is configured explicitly.
The malformed-wire-document test retains one narrowly documented `any` exception so it can exercise parser refusal on invalid nested input.
The Deno aggregator's four connection parameters derive their type from its imported pool rather than `any`; this is a type-only change and does not deploy the function.

## Production dependencies

Builds install development dependencies because Tailwind, PostCSS plugins, animation CSS and the shadcn stylesheet are compiled into the application.
Those build tools and the shadcn generator are development dependencies; they are not required by the running server.
The Next configuration uses JavaScript modules with a JSDoc type, so production startup does not require TypeScript or try to install development dependencies.
After the production build, CI prunes development dependencies and runs `scripts/check-production-runtime.mjs` against a new loopback-only server on an automatically allocated port.
The smoke check verifies public pages, their compiled assets, security headers and native image processing, then stops the server.
It does not authenticate, mutate application data or send test requests to an external service.
For the local equivalent, build with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=production-runtime-check npm run build`, then run `npm prune --omit=dev --ignore-scripts` and `node scripts/check-production-runtime.mjs`.
Run `npm ci` before further development checks.

Next and its ESLint configuration stay on the same supported 15.5 patch version.
The scoped Next PostCSS override uses the declared patched PostCSS 8 version because Next 15 still pins an older transitive copy.
Remove that override when the framework's own dependency no longer needs it, after rerunning the build and runtime checks.
Audit production and development dependencies separately; a clean production audit does not imply that every development-tool advisory is resolved.

The production smoke build uses dummy Supabase settings at loopback port 9 and sends no session cookies.
It serves anonymous pages and local assets only; it does not need live credentials or contact the database.
