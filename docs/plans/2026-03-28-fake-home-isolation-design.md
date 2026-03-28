# Fake HOME Isolation — Design

**Date:** 2026-03-28
**Status:** Design Complete — Ready for Implementation Planning

---

## Problem

Claude Code's CLI flags (`--bare`, `--plugin-dir`, `--disallowed-tools`) don't provide real isolation:

- `--bare` strips too much (LSP, hooks, memory, OAuth, CLAUDE.md discovery)
- `--plugin-dir` is additive — installed plugins always load from `~/.claude/plugins/installed_plugins.json`
- `--disallowed-tools` blocks invocation but skills still appear in `/skills` listing
- Standalone skills from `~/.claude/skills/` can't be selectively loaded

The CLI flag approach fights Claude Code's design. Filesystem-level control is the correct abstraction.

## Solution

Set `HOME` to a per-env directory when spawning Claude. Claude Code reads all config from `$HOME/.claude/`, so if HOME points to our curated structure, we control everything — plugins, skills, settings, CLAUDE.md — without any CLI flags.

### Core Principle

```
cenv run test
  → HOME=/Users/user/.claude-envs/envs/test/home claude
  → Claude reads $HOME/.claude/ → sees only what the env defines
```

No `--bare`. No `--plugin-dir`. No `--disallowed-tools`. Just a filesystem.

---

## Fake HOME Structure

Each env gets a persistent `home/` directory inside its env folder:

```
~/.claude-envs/envs/test/
  env.yaml                              # env manifest
  claude.md                             # env instructions
  home/                                 # persistent fake HOME
    .claude/
      # ── Regenerated each run (from env.yaml) ──────────
      settings.json                     # generated: effort, permissions, hooks, mcpServers
      CLAUDE.md         → ../../claude.md   # symlink to env file
      plugins/
        installed_plugins.json          # generated: only selected plugins
      skills/
        swarm-planning/ → /abs/path     # symlinks to selected skills only

      # ── Persistent (survives across sessions) ─────────
      projects/         → ~/.claude/projects/   # shared: project memory + history
      plugins/
        cache/          → ~/.claude/plugins/cache/       # shared: plugin code (read-only)
        data/                                            # per-env: plugin persistent state
        known_marketplaces.json → ~/.claude/plugins/known_marketplaces.json
        blocklist.json  → ~/.claude/plugins/blocklist.json
      sessions/                         # per-env session tracking
      session-env/                      # per-env session environment
      history.jsonl                     # per-env conversation history
      commands/         → ~/.claude/commands/   # shared: user commands

    # ── Dotfile symlinks (for git, ssh, etc.) ───────────
    .gitconfig          → ~/.gitconfig
    .ssh/               → ~/.ssh/
    .config/            → ~/.config/
    .local/             → ~/.local/
```

### What's Regenerated vs Persistent

| Layer | Lifecycle | Source |
|-------|-----------|--------|
| `settings.json` | Regenerated each run | Built from env.yaml |
| `CLAUDE.md` | Symlink (always current) | env's claude.md |
| `installed_plugins.json` | Regenerated each run | Filtered from env.yaml plugins.enable |
| `skills/` symlinks | Regenerated each run | From env.yaml skills |
| `plugins/data/` | Persistent per-env | Plugin state (claude-mem DB, etc.) |
| `projects/` | Shared symlink | Real ~/.claude/projects/ |
| `history.jsonl` | Persistent per-env | Conversation history |
| `sessions/`, `session-env/` | Persistent per-env | Session tracking |
| Dotfiles (.gitconfig, .ssh) | Symlinks (always current) | Real HOME |

### Key Design Decisions

1. **`installed_plugins.json` is the gatekeeper.** Only plugins listed here are discovered by Claude. The `cache/` symlink points to all plugin code, but Claude only loads what the registry says. Non-listed plugins are invisible.

2. **No CLI flags.** Claude runs in its normal mode, discovering config from `$HOME/.claude/`. No `--bare`, no `--settings`, no `--plugin-dir`. Just `HOME=<path> claude`.

3. **`projects/` is shared** across envs and vanilla Claude. Project memory is about the project, not the env configuration.

4. **`plugins/data/` is per-env.** Plugin state (like claude-mem's memory database) is isolated per environment.

5. **Regenerate on every run.** Config files (settings.json, installed_plugins.json, skill symlinks) are rebuilt from env.yaml each run. Overhead is trivial (2 JSON writes + symlinks). Guarantees `cenv edit` changes are always picked up.

---

## `installed_plugins.json` Generation

The generated registry contains only the env's selected plugins, pointing to the real cache paths:

```json
{
  "version": 2,
  "plugins": {
    "superpowers@claude-plugins-official": [
      {
        "scope": "user",
        "installPath": "/Users/user/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.6",
        "version": "5.0.6",
        "installedAt": "2026-03-25T17:00:36.302Z",
        "lastUpdated": "2026-03-25T18:18:22.405Z"
      }
    ]
  }
}
```

Source data: read the real `~/.claude/plugins/installed_plugins.json`, filter to only entries matching `env.yaml plugins.enable`, write to fake HOME.

---

## `settings.json` Generation

Assembled from env.yaml config:

```json
{
  "effortLevel": "high",
  "permissions": {
    "allow": ["Bash(bun *)", "Edit", "Write"]
  },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo hello" }] }]
  },
  "mcpServers": {
    "postgres": { "command": "uvx", "args": ["mcp-server-postgres"] }
  }
}
```

This replaces the separate `mcp.json` file — Claude Code reads `mcpServers` from settings.json natively.

---

## Runner Simplification

**Before (CLI flag assembly):**
```typescript
claude --bare \
  --settings /tmp/session/settings.json \
  --plugin-dir /path/to/superpowers \
  --plugin-dir /tmp/session/standalone-skills \
  --strict-mcp-config \
  --mcp-config /tmp/session/mcp.json \
  --append-system-prompt-file /path/to/claude.md \
  --disallowed-tools Skill(claude-mem:do) Skill(frontend-design:frontend-design)
```

**After (fake HOME):**
```typescript
HOME=/Users/user/.claude-envs/envs/test/home claude
```

The `assembleClaudeArgs` function reduces to just passing through user args (everything after `--`).

---

## Lifecycle

### First `cenv run test`

1. `home/` doesn't exist → create full structure
2. Create `.claude/` directory tree
3. Create persistent dirs: `plugins/data/`, `sessions/`, `session-env/`
4. Create shared symlinks: `projects/`, `plugins/cache/`, `commands/`, dotfiles
5. Regenerate config: `settings.json`, `installed_plugins.json`, `CLAUDE.md` symlink, `skills/` symlinks
6. Launch: `HOME=<home> claude [passthrough-args]`

### Subsequent `cenv run test`

1. `home/` exists → regenerate config layer only
2. Rebuild: `settings.json`, `installed_plugins.json`
3. Rebuild: `skills/` symlinks (clear and recreate)
4. Verify shared symlinks still valid
5. Launch: `HOME=<home> claude [passthrough-args]`

### `cenv delete test`

Removes entire env dir including `home/`. Persistent data (plugin state, history) is lost. Shared data (projects/) is unaffected since it's a symlink to real.

---

## Auth Integration

Auth env vars are injected into the process environment alongside HOME:

```typescript
const env = {
  ...process.env,
  HOME: fakeHomePath,
  ...authEnvVars,  // ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, etc.
}

Bun.spawn(['claude', ...passThroughArgs], { env })
```

OAuth works normally since keychain reads are NOT skipped (no `--bare`).

---

## Dotfile Symlinks

Symlinked from real HOME to fake HOME so Claude's subprocesses (git, ssh, npm, etc.) work:

| Dotfile | Purpose |
|---------|---------|
| `.gitconfig` | Git configuration |
| `.ssh/` | SSH keys and config |
| `.config/` | XDG config (various tools) |
| `.local/` | Local binaries (claude binary lives here) |
| `.npmrc` | npm configuration |
| `.bunfig.toml` | Bun configuration |

Only created if they exist in the real HOME. Missing dotfiles are silently skipped.

---

## What Changes in the Codebase

### New
- `src/lib/fake-home.ts` — builds and regenerates the fake HOME structure

### Refactored
- `src/lib/session.ts` — replaced by fake-home.ts (session concept becomes fake HOME lifecycle)
- `src/lib/runner.ts` — simplified to minimal arg passing, no flag assembly
- `src/commands/run.ts` — uses fake-home, sets HOME env var
- `src/types.ts` — new `FakeHome` type replaces `SessionFiles`

### Unchanged
- `src/lib/scanner.ts` — still scans real `~/.claude/` for wizard/snapshot
- `src/lib/snapshot.ts` — still captures real setup
- `src/commands/wizard.ts` — still reads real installed plugins
- `src/commands/create.ts` — unchanged (env creation doesn't touch HOME)

### Removed
- Temp session dir at `/tmp/cenv-sessions/` — no longer needed
- `cleanupStaleSessions()` — PID-based cleanup no longer needed
- `computeBareDisabledSkills()` — not needed when plugins are filtered at registry level
- All `--bare`, `--plugin-dir`, `--disallowed-tools`, `--mcp-config`, `--settings`, `--append-system-prompt-file` flag assembly

---

## What This Does NOT Change

- **env.yaml schema** — same format, same fields
- **Wizard flow** — still scans real `~/.claude/` for available plugins/skills
- **`cenv create`** — still creates env.yaml + claude.md
- **Auth system** — still orthogonal, env var injection unchanged
- **Trust model** — still hash-based allow for project envs
- **Never modifies real `~/.claude/`** — design principle preserved
