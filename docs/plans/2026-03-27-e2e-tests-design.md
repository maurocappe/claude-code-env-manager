# E2E Test Suite Design

**Date:** 2026-03-27
**Status:** Design Complete

## Goal

Validate that all cenv features work end-to-end in an isolated environment without touching the user's real Claude Code setup, keychain, or filesystem.

## Isolation Approach: Local with Mocks

Each test run creates a fully isolated temp directory structure:

```
/tmp/cenv-e2e-<timestamp>/
  home/
    .claude/                     # mock Claude Code (from fixtures)
      settings.json
      CLAUDE.md
      plugins/
        installed_plugins.json
        cache/claude-plugins-official/superpowers/5.0.6/
          .claude-plugin/plugin.json
          skills/test-driven-development/SKILL.md
          skills/brainstorming/SKILL.md
          hooks/hooks.json
      skills/
        gstack-review/SKILL.md
    .claude-envs/                # cenv home (created by cenv init)
  project/                       # fake project with shared envs
    .claude-envs/
      team-env/
        env.yaml
        claude.md
  bin/                           # mock binaries
    claude                       # echo binary
    security                     # file-backed keychain
  output/                        # invocation capture
    claude-invocation.json
  keychain.json                  # file-backed keychain store
```

## Mock Binaries

### Mock `claude`

Dumps args and auth-related env vars to a JSON file, then exits 0:

```bash
#!/bin/bash
printf '%s\n' "$@" | jq -R . | jq -s '{args: ., env: {
  ANTHROPIC_API_KEY: (env.ANTHROPIC_API_KEY // null),
  ANTHROPIC_BASE_URL: (env.ANTHROPIC_BASE_URL // null),
  CLAUDE_CODE_OAUTH_TOKEN: (env.CLAUDE_CODE_OAUTH_TOKEN // null),
  CLAUDE_CODE_OAUTH_REFRESH_TOKEN: (env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN // null),
  CLAUDE_CODE_USE_BEDROCK: (env.CLAUDE_CODE_USE_BEDROCK // null),
  CLAUDE_CODE_USE_VERTEX: (env.CLAUDE_CODE_USE_VERTEX // null)
}}' > "$CENV_E2E_OUTPUT"
```

### Mock `security`

File-backed keychain using a JSON file. Supports the three operations cenv uses:

- `add-generic-password -U -a <account> -s <service> -w <data>` → write to JSON
- `find-generic-password -s <service> -w` → read from JSON, exit 44 if not found
- `delete-generic-password -a <account> -s <service>` → delete from JSON, exit 44 if not found

## Test Invocation

Tests import command functions directly and pass isolated paths:

```typescript
const ctx = await setupE2E()
await runRun('my-env', [], { dryRun: true }, ctx.cenvHome, ctx.projectDir)
```

All functions already accept `cenvHome` and `cwd` overrides. This is faster than subprocess spawning and gives direct access to errors and return values.

For `cenv run` without `--dry-run`, the mock claude binary in `$PATH` captures the invocation.

## Test Categories

### 1. CLI Smoke (5 tests)
- Every command's `--help` runs without crashing
- `cenv --version` shows version
- Unknown command shows help
- `cenv run` with no envs shows helpful error
- `cenv init` creates directory structure

### 2. Environment Lifecycle (8 tests)
- `init` → creates `~/.claude-envs/` with all subdirs
- `create my-env` → scaffold exists with env.yaml + claude.md
- `create my-env` when exists → throws
- `list` → shows personal and project envs
- `show my-env` → displays config details
- `edit my-env` → would open $EDITOR (verify path resolution)
- `delete my-env` → removes directory
- `list` after delete → env gone

### 3. Snapshot (4 tests)
- `create my-env --snapshot` → env.yaml contains plugins from mock installed_plugins.json
- Snapshot copies CLAUDE.md
- Snapshot extracts settings (effortLevel, permissions)
- Snapshot with no Claude setup → creates minimal env

### 4. Run Engine (8 tests)
- `run my-env --dry-run` → outputs correct flags
- `run my-env --dry-run` in additive mode → no `--bare`, no `--strict-mcp-config`
- `run my-env --dry-run` in bare mode → includes `--bare` + `--strict-mcp-config`
- `run my-env` (no dry-run) → mock claude receives correct args
- `run my-env --auth api-profile` → mock claude sees `ANTHROPIC_API_KEY` env var
- `run my-env --auth oauth-profile` → mock claude sees `CLAUDE_CODE_OAUTH_TOKEN`
- `run my-env` with disabled skills → settings.json has `disallowedTools`
- `run my-env` with MCP servers → mcp.json has correct structure
- `run my-env` with plugins → `--plugin-dir` flags point to correct paths

### 5. Auth (7 tests)
- Create API key profile → JSON written, key in mock keychain
- Create bedrock profile → JSON with env vars, no keychain
- List profiles → shows all types with masked details
- Delete profile → JSON gone, keychain cleaned
- Resolve api-key env vars → reads from mock keychain
- Resolve oauth env vars → parses JSON from mock keychain
- Resolve bedrock env vars → returns correct env vars without keychain

### 6. Trust (5 tests)
- Project env blocked without `allow` → error message
- `allow` → project env trusted → `run` works
- Modify env.yaml → trust invalidated → blocked again
- Re-allow → works again
- Personal env → always trusted, no allow needed

### 7. Install (5 tests)
- All deps installed → all show ✓
- Plugin missing → shows ↓
- Plugin version mismatch → shows ⚠
- Skill with local path exists → shows ✓
- MCP server command available → shows ✓

### 8. Add + Diff (5 tests)
- `add team-env` from project → copies to personal
- `add team-env --as my-env` → renames
- `diff env1 env2` identical → "identical"
- `diff env1 env2` with differences → shows adds/removes/changes
- `add` when target exists → prompts (mock clack)

### 9. Name Resolution (4 tests)
- Resolve personal env → finds in `~/.claude-envs/envs/`
- Resolve project env → finds in `./.claude-envs/`
- Resolve path `./path/to/env` → uses directly
- Not found → error with suggestion

**Total: ~51 tests**

## File Structure

```
test/
  e2e/
    helpers/
      setup.ts               # createE2EContext(), teardown, fixture copying
      mock-claude.sh          # echo binary
      mock-security.sh        # file-backed keychain
    fixtures/
      claude-home/            # mock ~/.claude/ structure
      project/                # mock project with .claude-envs/
    smoke.test.ts             # category 1
    lifecycle.test.ts         # category 2
    snapshot.test.ts          # category 3
    run.test.ts               # category 4
    auth.test.ts              # category 5
    trust.test.ts             # category 6
    install.test.ts           # category 7
    add-diff.test.ts          # category 8
    resolution.test.ts        # category 9
```

## E2E Setup Helper

```typescript
interface E2EContext {
  root: string           // /tmp/cenv-e2e-<ts>/
  home: string           // root/home
  claudeHome: string     // root/home/.claude
  cenvHome: string       // root/home/.claude-envs
  projectDir: string     // root/project
  binDir: string         // root/bin
  outputFile: string     // root/output/claude-invocation.json
  keychainFile: string   // root/keychain.json
  cleanup: () => void
}

async function createE2EContext(): Promise<E2EContext>
```

- Creates temp dir structure
- Copies fixtures into place
- Writes mock binaries with correct permissions
- Updates installed_plugins.json paths to match temp dir
- Returns context object with all paths
- `cleanup()` removes everything

## Running

```bash
bun test test/e2e/          # run only E2E tests
bun test                    # run all tests (unit + E2E)
```
