# NewWeb agent guide

Nested independent repo (own CI) embedded into the `chimera` binary as the default WebUI. Keep `bun run test:run` green before handing off changes.

## Testing pitfalls (learned the hard way)

### localStorage polyfill must be complete

`src/test/setup.ts` installs a Map-backed localStorage polyfill. Node 26 exposes a **stub** `globalThis.localStorage` (non-functional without `--localstorage-file`), so the install guard checks for `key()` too, not just `getItem`. If you extend the polyfill, keep it complete: `length`, `key(i)`, `getItem`, `setItem`, `removeItem`, `clear` — store code enumerates via `.length`/`.key()` (`utils/perServerStorage.ts`, `store/followupQueueStore.ts`).

### Spy on `localStorage`, not `Storage.prototype`

The polyfill is a plain object, so `vi.spyOn(Storage.prototype, 'setItem')` silently never intercepts anything. Write `vi.spyOn(localStorage, 'setItem')` and take `localStorage.setItem` as the original when delegating.

### Store mocks must satisfy import-time initializers

Several stores call `serverStore` during module evaluation (e.g. `notificationStore` reads `getActiveServerId()` in a field initializer, `modelVisibilityStore` calls `onServerChange()` in its constructor). A partial `vi.mock('../store/serverStore', ...)` blows up the whole test file at import time with `TypeError: X is not a function`. Mock every member accessed at import/construct time: at minimum `getActiveServerId: () => 'local'` and `onServerChange: () => () => {}`.

### Drift guards against the Chimera server

- `api-call-inventory.json` is a generated baseline; `openapi-inventory.test.ts` and `server-workflow-closure.test.ts` compare it against a live `bun dev generate` from `packages/chimera`. When the server evolves, regenerate with `bun run api:inventory:update` — never hand-edit.
- `server-workflow-closure.json` `currentlyUsed` claims must equal inventory membership. When a workflow's UI ships (e.g. ProviderSettings started calling `provider.list`), flip the claims or the guard fails on purpose.

### Graph API parameters are numbers

The Chimera OpenAPI declares graph line/depth params as `integer`; the SDK serializes numbers into query strings itself. Pass numbers through — do not stringify, and do not write tests expecting string conversion.

## Environment and collaboration pitfalls

### Do not run `npm install` here — use bun

`node_modules` in this package consists of bun workspace symlinks into the repo-root `node_modules/.bun` store. With `overrides` present in `package.json`, npm 11's arborist crashes with `Cannot read properties of null (reading 'edgesOut')`. Install with `bun install` from the workspace root instead. When `package-lock.json` (consumed by Docker/CI builds) must change, patch the entry by hand, verify the integrity hash with `npm view <pkg>@<version> dist.integrity`, and update the bun side with `bun update <pkg>` from the workspace root.

### Dependencies are exact-pinned

This fork locks every dependency to an exact version (no `^` ranges) in `package.json`. Keep that style when adding or bumping packages; use `overrides` for transitive security fixes (see the `fast-uri` entry).

### Nested repo boundary

This is an independent git repo embedded in the `coding-chimera` checkout (tracked there like a submodule pointer). Commit here separately from the outer repo, and never stage or revert outer-repo changes unrelated to your task — the outer repo often carries other in-flight work (check root `memory.md`).

### Subagent scheduling

Follow the root `AGENTS.md` / runtime scheduling convention: implementation subagents never run on `kimi-k3` (reserved for the root session) — large models (L/XL) run at a low reasoning variant, small models at a high reasoning variant, always with explicit model+variant; scouting/exploration fans out via swarm with `workload=scout`.

## Verify

- `bun run test:run` — vitest suite
- `bun run typecheck` — `tsc -b`
- `bun run api:inventory:update` — after touching `src/api/**` call patterns or when the Chimera server surface changed
