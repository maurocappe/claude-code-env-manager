# Implementation Plan: Fake HOME Isolation

**Date:** 2026-03-28
**Design:** [fake-home-isolation-design.md](2026-03-28-fake-home-isolation-design.md)

---

## Context

Replace the CLI flag approach (`--bare`, `--plugin-dir`, `--disallowed-tools`, `--settings`, `--mcp-config`) with filesystem-level isolation by setting `HOME` to a per-env directory. Claude Code reads all config from `$HOME/.claude/`, so controlling the filesystem controls everything.

Key constraint from scout findings: `settings.json` does NOT natively contain `mcpServers`. MCP config must be written as a separate file. We'll write `<fakeHome>/.mcp.json` for auto-discovery, falling back to `--mcp-config` flag if needed.

**Bare mode is dropped.** With fake HOME, `installed_plugins.json` filtering is the isolation mechanism — non-selected plugins are invisible to Claude. The `isolation` field in env.yaml is no longer needed. The `plugins.disable` list still works for cherry-picking within selected plugins (e.g., enable superpowers but disable brainstorming), written to `settings.json` as `disallowedTools`.

**MCP config:** Write `.mcp.json` at fake HOME root. If Claude doesn't auto-discover it, fall back to `--mcp-config` as the single remaining CLI flag.

## Dependencies

- No external dependencies
- All existing scanner/config utilities remain usable
- Real `~/.claude/plugins/installed_plugins.json` must exist (source for filtering)

---

## Tasks

### Task 1: Create `src/lib/fake-home.ts`

**What:** New module that builds and regenerates the fake HOME directory structure for an environment. This is the core of the refactor.

**Where:** `src/lib/fake-home.ts` (new file, ~150-200 lines)

**Implementation:**

```typescript
export interface FakeHomeResult {
  homePath: string       // path to the fake HOME directory
  claudeHome: string     // path to fake HOME's .claude/
}

export async function buildFakeHome(
  config: EnvConfig,
  envDir: string,
  realHome?: string
): Promise<FakeHomeResult>
```

The function:

1. **Ensure structure exists** — `<envDir>/home/.claude/` with subdirs:
   - `plugins/` (with `data/` as persistent per-env dir)
   - `skills/`
   - `sessions/`, `session-env/` (persistent per-env)

2. **Create shared symlinks** (only on first run, skip if exist):
   - `plugins/cache/` → real `~/.claude/plugins/cache/`
   - `plugins/known_marketplaces.json` → real
   - `plugins/blocklist.json` → real
   - `projects/` → real `~/.claude/projects/`
   - `commands/` → real `~/.claude/commands/`
   - Dotfiles: `.gitconfig`, `.ssh/`, `.config/`, `.local/`, `.npmrc`, `.bunfig.toml`

3. **Regenerate config layer** (every run):
   - `settings.json` — from env.yaml (effort, permissions, hooks)
   - `plugins/installed_plugins.json` — filtered from real, only selected plugins
   - `CLAUDE.md` — symlink to `<envDir>/claude.md`
   - `skills/` — clear existing symlinks, create new ones for selected skills only
   - `.mcp.json` — MCP server config at fake HOME root

**Key functions:**
- `generateFilteredPluginRegistry(config, realPluginsPath)` — reads real `installed_plugins.json`, keeps only entries whose `name@source` key matches `config.plugins.enable`, writes to fake HOME
- `generateSettings(config)` — reuse logic from current `buildSettings()` in session.ts. Still generates `disallowedTools` from explicit `plugins.disable` list (for cherry-picking within selected plugins), but drops the computed bare-mode disables (registry filtering handles that now)
- `generateMcpConfig(config)` — reuse logic from current `buildMcpConfig()` in session.ts, write as `.mcp.json`
- `ensureDotfileSymlinks(fakeHome, realHome)` — create dotfile symlinks if they don't exist
- `regenerateSkillSymlinks(claudeHome, config)` — clear `skills/` dir, recreate symlinks for selected skills

**Watch out:**
- `installed_plugins.json` entries can have multiple scopes (user + local). Keep ALL entries for a matching plugin, not just the first.
- Skills in `~/.claude/skills/` are often symlinks to `~/.agents/skills/`. When creating symlinks in fake HOME, resolve to the real absolute path (use `fs.realpathSync`) so the symlink chain isn't broken by the fake HOME.
- MCP env vars with `keychain:` prefix need resolution (reuse `keychainRead` from keychain.ts).
- Dotfile symlinks: only create if the source exists in real HOME. Use `fs.existsSync` before `fs.symlinkSync`. Wrap symlink creation in try-catch to handle permission errors gracefully.
- Skill symlinks: use `fs.realpathSync()` to resolve through intermediate symlinks (skills in `~/.claude/skills/` are often symlinks to `~/.agents/skills/`). Wrap in try-catch — skip with warning if resolution fails (broken symlink).

**Tests:** `test/lib/fake-home.test.ts` (new file)
- Generates correct `installed_plugins.json` with only selected plugins
- Creates skill symlinks for selected skills only
- Creates dotfile symlinks
- Preserves persistent dirs across regenerations
- Handles missing dotfiles gracefully
- Resolves keychain refs in MCP config

---

### Task 2: Update types and constants

**What:** Replace `SessionFiles` with `FakeHomeResult`, clean up constants.

**Where:**
- `src/types.ts` — replace `SessionFiles` interface
- `src/constants.ts` — add dotfile list constant

**Implementation:**

In `src/types.ts`:
- Remove `SessionFiles` interface (6 fields → 2 fields)
- Add `FakeHomeResult` interface:
  ```typescript
  export interface FakeHomeResult {
    homePath: string
    claudeHome: string
  }
  ```

In `src/constants.ts`:
- Add dotfile list:
  ```typescript
  export const DOTFILE_SYMLINKS = [
    '.gitconfig', '.ssh', '.config', '.local',
    '.npmrc', '.bunfig.toml',
  ]
  ```
- Remove `SESSIONS_TMP_DIR` constant (no longer needed)

**Watch out:** `SessionFiles` is imported in `run.ts`, `runner.ts`, and 3 test files. All need updating (handled in tasks 3 and 5).

**Builds on:** Independent (can parallel with Task 1)

**Tests:** Type-only change, verified by TypeScript compilation.

---

### Task 3: Refactor `run.ts` and `runner.ts`

**What:** Wire `buildFakeHome` into the run command, simplify the runner to minimal arg passing.

**Where:**
- `src/commands/run.ts` — use fake home, set HOME env var
- `src/lib/runner.ts` — gut `assembleClaudeArgs`, keep `findClaudeBinary`

**Implementation:**

In `src/commands/run.ts`:
- Remove `import { createSession, cleanupStaleSessions }` → `import { buildFakeHome }`
- Remove `cleanupStaleSessions()` call (step 5 in current flow)
- Replace `createSession()` call with `buildFakeHome(resolved.config, resolved.path)`
- Change `assembleClaudeArgs` call to just pass through args
- Change spawn env:
  ```typescript
  const env = {
    ...process.env,
    HOME: fakeHome.homePath,
    ...authEnvVars,
  }
  Bun.spawn([claudeBin, ...passThroughArgs], { env, stdio: ['inherit', 'inherit', 'inherit'], cwd })
  ```
- Update dry-run output to show `HOME=<path>` instead of CLI flags

In `src/lib/runner.ts`:
- Delete `assembleClaudeArgs` function entirely
- Update `findClaudeBinary` to accept an optional `realHome` parameter:
  ```typescript
  export function findClaudeBinary(realHome?: string): string {
    const home = realHome ?? process.env.HOME ?? ''
    const absoluteCandidates = [
      path.join(home, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
    ]
    // ... rest unchanged
  }
  ```

In `src/commands/run.ts`, call binary discovery BEFORE building fake HOME:
```typescript
const realHome = process.env.HOME
const claudeBin = findClaudeBinary(realHome)
const fakeHome = await buildFakeHome(resolved.config, resolved.path, realHome)
Bun.spawn([claudeBin, ...passThroughArgs], {
  env: { ...process.env, HOME: fakeHome.homePath, ...authEnvVars },
  stdio: ['inherit', 'inherit', 'inherit'], cwd
})
```

**Watch out:**
- The dry-run output format changes — currently prints the full flag-assembled command. New format should show the HOME path and list what's inside it (plugins, skills, settings).

**Builds on:** Tasks 1 and 2

**Tests:** Covered in Task 5

---

### Task 4: Clean up `session.ts`

**What:** Remove dead code from session.ts. Move reusable config generation functions to fake-home.ts or a shared utility.

**Where:** `src/lib/session.ts`

**Implementation:**

**Delete entirely:**
- `createSession()` — replaced by `buildFakeHome()`
- `cleanupStaleSessions()` — no longer needed
- `computeBareDisabledSkills()` — not needed when plugins are filtered at registry level
- `resolvePluginDirs()` — not needed when we control `installed_plugins.json`
- `SessionCreateOptions` interface

**Also clean up bare mode remnants across codebase:**
- `src/types.ts` — remove `isolation` field from `EnvConfig` (or keep but ignore)
- `src/commands/wizard.ts` — remove `isolation: 'bare'` from generated config
- `src/lib/environments.ts` — remove `isolation: 'bare'` from scaffold
- `src/lib/snapshot.ts` — remove `isolation: 'bare'` from snapshot
- `src/commands/show.ts` — remove isolation label display

**Move to `fake-home.ts` (or inline there):**
- `buildSettings()` logic — adapted: remove `bareDisables` param, remove `disallowedTools` generation
- `buildMcpConfig()` logic — adapted: write to `.mcp.json` format instead of separate file

After moving, `session.ts` can be deleted entirely if nothing remains.

**Watch out:** `buildMcpConfig` uses `keychainRead` for resolving secrets. This import stays in whatever module the function moves to.

**Builds on:** Task 3 (after run.ts no longer imports from session.ts)

**Tests:** Covered in Task 5

---

### Task 5: Rewrite and update tests

**What:** Update all test files affected by the refactor.

**Where:**
- `test/lib/fake-home.test.ts` — **NEW** (core tests for the new module)
- `test/lib/runner.test.ts` — **REWRITE** (9 tests → simplified)
- `test/e2e/run.test.ts` — **REWRITE** (8 tests → new assertions)
- `test/lib/session.test.ts` — **DELETE** (replaced by fake-home.test.ts)
- `test/e2e/infrastructure.test.ts` — **UPDATE** (1 test checks mock claude args)

**Implementation:**

**`test/lib/fake-home.test.ts` (new, ~200 lines):**
- `buildFakeHome` creates correct directory structure
- `installed_plugins.json` contains only selected plugins
- `installed_plugins.json` preserves all scope entries for a selected plugin
- `settings.json` has correct effortLevel, permissions, hooks
- `.mcp.json` has resolved MCP server config
- `CLAUDE.md` symlink points to env's claude.md
- `skills/` contains only selected skill symlinks
- Dotfile symlinks created for existing files, skipped for missing
- Persistent dirs (`plugins/data/`, `sessions/`) survive regeneration
- Shared symlinks (`projects/`, `plugins/cache/`) point to real paths

**`test/lib/runner.test.ts` (rewrite, ~30 lines):**
- `findClaudeBinary` tests stay as-is
- Remove all `assembleClaudeArgs` tests (function deleted)

**`test/e2e/run.test.ts` (rewrite, ~150 lines):**
- Remove direct `assembleClaudeArgs` tests (3 tests deleted)
- Keep `createSession`-equivalent tests → verify `buildFakeHome` output
- Update dry-run tests: check for `HOME=` in output instead of `--settings`
- Add test: `cenv run` spawns claude with correct HOME env var

**`test/lib/session.test.ts` (delete):**
- All functionality moved to fake-home.test.ts
- `cleanupStaleSessions` tests deleted (function deleted)

**`test/e2e/infrastructure.test.ts` (update):**
- Line 65: update mock claude test to not expect `--settings` flag
- Mock claude binary should log the HOME env var instead

**Watch out:**
- The e2e test helper (`test/e2e/helpers/setup.ts`) creates a mock claude binary that logs received args. Update it to also log `HOME` env var so we can verify fake HOME is set.
- Many tests create `SessionFiles` objects inline with `disallowedTools: []`. These all need updating to use `FakeHomeResult`.

**Builds on:** Tasks 3 and 4

---

## Task Dependency Graph

```
Task 1 (fake-home.ts) ──┐
                         ├──→ Task 3 (run.ts + runner.ts + tests atomically)
Task 2 (types)      ─────┘         │
                                    ├──→ Task 4 (session.ts cleanup)
                                    │
                                    └──→ Task 5 (new fake-home tests + e2e updates)
```

Tasks 1 and 2 are independent and can run in parallel.
Task 3 requires 1 + 2. Tests that import deleted functions (runner.test.ts, e2e/run.test.ts) must be rewritten ATOMICALLY with the code changes.
Task 4 requires 3.
Task 5 can start after task 1 (fake-home.test.ts) and completes after task 4.

---

## Testing Strategy

**Unit tests:** `test/lib/fake-home.test.ts` covers all generation logic with temp directories.

**Integration:** `test/e2e/run.test.ts` verifies the full flow from `cenv run` → fake HOME creation → claude spawn with correct HOME.

**Manual smoke test:** After implementation, run `cenv create --wizard smoke-test`, select 1 plugin + 1 skill, then `cenv run smoke-test`. Verify:
1. `/plugins` shows only the selected plugin
2. `/skills` shows only skills from the selected plugin + the standalone skill
3. No default CLAUDE.md loads (only the env's)
4. Git commands work (dotfile symlinks)

---

## Risks

1. **MCP auto-discovery** — Unclear if Claude reads `.mcp.json` from `$HOME/`. If not, fall back to `--mcp-config` as the single remaining CLI flag. Low risk, easy fallback.

2. **Plugin sync interference** — Claude may try to sync/update plugins against our filtered registry. Could cause warnings or failed updates. Mitigation: if this happens, add `--bare` back for just plugin sync suppression.

3. **Dotfile gaps** — Some tools Claude spawns may need dotfiles we don't symlink (e.g., `.docker/`, `.aws/`). Mitigation: users can manually symlink additional dotfiles into the `home/` dir. Could add a `dotfiles` field to env.yaml in the future.

4. **Concurrent envs** — Two `cenv run test` invocations of the SAME env share the `home/` dir. The regeneration step might conflict. Low risk since regeneration is idempotent (same env.yaml → same output). Full concurrent isolation would need PID-scoped HOME (future consideration).
