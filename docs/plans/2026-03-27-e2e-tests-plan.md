# Implementation Plan: E2E Test Suite

## Context

All cenv features are implemented (194 unit tests passing). We need E2E tests that validate full workflows in an isolated environment. The design uses local isolation with mock binaries — no Docker, no real Claude, no real keychain mutations.

Key constraint: the `keychain.ts` module calls `Bun.spawn(['security', ...])` directly. To mock it in E2E, we need the mock `security` script in PATH before the real one. Similarly, `runner.ts` uses `findClaudeBinary()` which checks PATH — mock `claude` must be found first.

Existing patterns to follow:
- `test/helpers/mock-env.ts` has `createTempCenvHome()` and `createTempEnvDir()` — extend this pattern
- All command functions accept `cenvHome` and `cwd` overrides
- All lib functions accept optional path parameters
- Tests use `bun:test` with `describe`/`test`/`expect`/`spyOn`/`beforeEach`/`afterEach`

## Dependencies

- `jq` must be available on the system (for mock claude binary to generate JSON) — or we write the mock in a way that doesn't need it
- All existing tests must continue to pass

## Tasks

### Task 1: E2E Infrastructure

**What**: Build the E2E test setup: context helper, mock binaries, fixtures, and verify the isolation works.

**Where**:
- `test/e2e/helpers/setup.ts` — E2E context creation and teardown
- `test/e2e/helpers/mock-claude.sh` — echo binary
- `test/e2e/helpers/mock-security.sh` — file-backed keychain
- `test/e2e/fixtures/` — mock Claude Code home structure + project env

**Deliverables**:

`test/e2e/helpers/setup.ts`:
```typescript
interface E2EContext {
  root: string
  home: string
  claudeHome: string
  cenvHome: string
  projectDir: string
  binDir: string
  outputFile: string
  keychainFile: string
  originalPath: string
  cleanup: () => void
}

async function createE2EContext(): Promise<E2EContext>
function readClaudeInvocation(ctx: E2EContext): { args: string[], env: Record<string, string | null> }
function readMockKeychain(ctx: E2EContext): Record<string, Record<string, string>>
function writeMockKeychain(ctx: E2EContext, data: Record<string, Record<string, string>>): void
```

- Creates temp dir at `/tmp/cenv-e2e-<timestamp>/`
- Copies fixtures from `test/e2e/fixtures/` into place
- Writes mock binaries to `bin/` with `chmod +x`
- Patches `installed_plugins.json` paths to point to temp dir
- Sets `process.env.PATH` to prepend `bin/` (so mock claude/security are found first)
- Sets `process.env.HOME` to the temp home dir
- `cleanup()` restores original PATH/HOME and removes temp dir

`test/e2e/helpers/mock-claude.sh`:
- Writes all args as JSON array to `$CENV_E2E_OUTPUT`
- Captures auth-related env vars (ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_USE_BEDROCK, etc.)
- Don't depend on `jq` — use pure bash/printf to generate JSON
- Exits 0

`test/e2e/helpers/mock-security.sh`:
- Reads/writes a JSON file at `$CENV_E2E_KEYCHAIN`
- Supports: `add-generic-password -U -a <acct> -s <svc> -w <data>`, `find-generic-password -s <svc> -w` (+ optional `-a`), `delete-generic-password -a <acct> -s <svc>`
- Exit 44 for not found, 0 for success
- Can depend on `jq` (available on macOS) or use a simpler format (one line per entry: `service:account:value`)

Fixtures — copy the structure from the design doc:
- `claude-home/settings.json`, `CLAUDE.md`, `plugins/installed_plugins.json`, plugin cache with superpowers (2 skills, hooks), standalone skill
- `project/.claude-envs/team-env/env.yaml` + `claude.md`

**Tests**: One smoke test that creates context, verifies all dirs exist, runs mock claude, reads invocation JSON, cleans up.

**Watch out**:
- `process.env.PATH` mutation affects all tests in the file — must restore in cleanup/afterEach
- `process.env.HOME` mutation affects `os.homedir()` — must restore
- Mock security script must handle the `-w` flag correctly (password as next arg after `-w`)
- Fixture `installed_plugins.json` has hardcoded paths — must be rewritten with temp dir paths at setup time

---

### Task 2: Smoke + Lifecycle Tests

**What**: CLI smoke tests and full environment lifecycle tests.

**Where**: `test/e2e/smoke.test.ts`, `test/e2e/lifecycle.test.ts`

**Deliverables**:

`smoke.test.ts` (5 tests):
- `cenv init` creates all dirs under cenvHome
- `cenv list` with no envs → doesn't crash, returns empty
- `cenv auth list` with no profiles → doesn't crash
- Unknown env name → throws EnvironmentNotFoundError
- `cenv create` with no name → throws

`lifecycle.test.ts` (8 tests):
- `init` → verify envs/, auth/, cache/, sessions/ dirs created
- `create my-env` → env.yaml + claude.md exist with correct content
- `create my-env` again → throws (already exists)
- `list` → shows the created env as personal
- `list` → also shows project env (team-env) from fixtures
- `show my-env` → loads and returns correct config
- `delete my-env` → directory gone
- `list` after delete → env no longer listed

Use `runInit`, `runCreate`, `runList`, `runShow`, `runDelete` directly with ctx paths. For `list` and `show`, capture output by spying on clack/console.

**Builds on**: Task 1 (setup helper)

---

### Task 3: Snapshot + Run Engine Tests

**What**: Test snapshot from mock Claude setup and run engine flag assembly.

**Where**: `test/e2e/snapshot.test.ts`, `test/e2e/run.test.ts`

**Deliverables**:

`snapshot.test.ts` (4 tests):
- `create snap-env --snapshot` → env.yaml has superpowers plugin from fixtures
- Snapshot copies CLAUDE.md content from mock claude home
- Snapshot extracts effortLevel from mock settings.json
- Snapshot extracts permissions from mock settings.json

Use `snapshotCurrentSetup()` directly with fixture paths.

`run.test.ts` (8 tests):
- `run my-env --dry-run` → verify output contains `--settings`, `--mcp-config`, `--append-system-prompt-file`
- `run my-env --dry-run` additive mode → no `--bare` in output
- Create env with `isolation: bare`, `run --dry-run` → `--bare` and `--strict-mcp-config` present
- `run my-env` (no dry-run, mock claude) → read invocation JSON, verify correct args
- `run my-env --auth api-profile` → mock claude sees `ANTHROPIC_API_KEY` in env
- `run my-env` with disabled skills → session settings.json has `disallowedTools`
- `run my-env` with MCP servers → session mcp.json has `mcpServers` with correct structure
- `run my-env` with plugin → `--plugin-dir` flag points to fixture plugin path

For non-dry-run tests: set `CENV_E2E_OUTPUT` env var, prepend mock claude to PATH, run `runRun()`, then read the invocation JSON to verify.

**Builds on**: Task 1, Task 2 (needs envs created)

**Watch out**:
- `runRun` calls `process.exit()` after claude exits — spy on `process.exit` to prevent test runner from dying
- Session files go to `/tmp/cenv-sessions/` — clean up in afterEach
- `findClaudeBinary()` needs to find our mock before the real claude

---

### Task 4: Auth + Trust Tests

**What**: Auth profile lifecycle and trust model for project envs.

**Where**: `test/e2e/auth.test.ts`, `test/e2e/trust.test.ts`

**Deliverables**:

`auth.test.ts` (7 tests):
- Create api-key profile → JSON written to auth dir, key in mock keychain
- Create bedrock profile → JSON with env vars, no keychain entry
- List profiles → shows correct types and masked details
- Delete profile → JSON gone, keychain entry cleaned
- Resolve api-key env vars → reads key from mock keychain, returns `{ ANTHROPIC_API_KEY: ... }`
- Resolve oauth env vars → reads JSON from mock keychain, returns `{ CLAUDE_CODE_OAUTH_TOKEN: ..., CLAUDE_CODE_OAUTH_REFRESH_TOKEN: ... }`
- Resolve bedrock env vars → returns `{ CLAUDE_CODE_USE_BEDROCK: "1", ... }` without keychain

Use `createAuthProfile`, `loadAuthProfile`, `listAuthProfiles`, `deleteAuthProfile`, `resolveAuthEnvVars` directly with ctx.cenvHome paths. For keychain tests, pre-populate the mock keychain file via `writeMockKeychain()`.

`trust.test.ts` (5 tests):
- Project env not allowed → `isAllowed()` returns false
- `allowEnv()` → `isAllowed()` returns true
- Modify env.yaml after allow → `isAllowed()` returns false (hash changed)
- Re-allow after modification → `isAllowed()` returns true again
- Personal env → `isPersonalEnv()` returns true, trust check skipped in run flow

Use trust functions directly with ctx paths.

**Builds on**: Task 1

---

### Task 5: Install + Add/Diff + Resolution Tests

**What**: Dependency resolution, env import/diff, and name resolution.

**Where**: `test/e2e/install.test.ts`, `test/e2e/add-diff.test.ts`, `test/e2e/resolution.test.ts`

**Deliverables**:

`install.test.ts` (5 tests):
- Plugin installed in mock Claude Code → resolved as `installed`
- Plugin not installed and not cached → resolved as `missing`
- Plugin installed but wrong version (fixture is 5.0.6, require `^6.0.0`) → `version-mismatch`
- Skill with local path that exists → resolved as `installed`
- MCP server with `echo` command → `checkMcpAvailable` returns true

Use `resolvePluginDeps`, `resolveSkillDeps`, `checkMcpAvailable` directly with fixture paths.

`add-diff.test.ts` (5 tests):
- `add team-env` from project → copies to personal cenvHome
- `add team-env --as renamed` → copies with new name
- `diff env-a env-b` with identical configs → empty diff
- `diff env-a env-b` with different plugins → shows added/removed
- `diff env-a env-b` with different settings → shows changes

Use `runAdd` and `diffEnvConfigs` directly.

`resolution.test.ts` (4 tests):
- Resolve personal env name → finds in cenvHome/envs/
- Resolve project env name → finds in projectDir/.claude-envs/
- Resolve explicit path → uses directly
- Resolve non-existent → throws EnvironmentNotFoundError

Use `resolveEnv` directly with ctx paths.

**Builds on**: Task 1, Task 2

---

## Execution Order

```
Task 1 (Infrastructure)
  ↓
Task 2 (Smoke + Lifecycle) ─── Task 4 (Auth + Trust)
  ↓
Task 3 (Snapshot + Run)
  ↓
Task 5 (Install + Add/Diff + Resolution)
```

Tasks 2 and 4 can run in parallel (independent). Tasks 3 and 5 depend on Task 2 (need created envs).

## Running

```bash
bun test test/e2e/          # E2E only
bun test                    # all tests (unit + E2E)
```

Add to package.json scripts:
```json
"test:e2e": "bun test test/e2e/",
"test:unit": "bun test test/lib/ test/commands/"
```
