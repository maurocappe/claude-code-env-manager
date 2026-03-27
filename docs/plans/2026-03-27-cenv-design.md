# cenv — Claude Code Environment Manager

**Date:** 2026-03-27
**Status:** Design Complete — Ready for Implementation Planning

---

## Problem Statement

The Claude Code ecosystem is exploding with plugins, skills, MCP servers, and configuration frameworks (superpowers, gstack, claude-mem, etc.). Users and teams face a real problem: trying new setups risks breaking the one that already works. There's no way to maintain multiple Claude Code configurations, switch between them, or share them with teammates — without manually editing `~/.claude/` files and hoping nothing breaks.

44+ hearts on [GitHub issue #7075](https://github.com/anthropics/claude-code/issues/7075) confirm this pain. 15+ fragmented tools exist but none solve the full problem — they focus narrowly on auth switching, provider switching, or opaque directory swapping. None treat a Claude Code "setup" as a composable, shareable, reproducible environment.

## What cenv Is

A CLI wrapper that lets you define, compose, share, and launch Claude Code with specific environments — without ever touching your default Claude Code setup.

**Core principle:** `claude` always stays vanilla. `cenv run` is the opt-in entry point to a managed environment.

## Architecture

### Mental Model

```
cenv run tdd-python --auth work
         │                  │
         ▼                  ▼
    ┌─────────┐      ┌──────────┐
    │ env.yaml│      │auth/*.json│
    │claude.md│      └──────────┘
    │skills/  │           │
    │hooks/   │           │ env vars
    └─────────┘           │
         │                │
         ▼                ▼
    ┌────────────────────────────────┐
    │  cenv assembles:               │
    │  - merged settings.json        │
    │  - composed claude.md          │
    │  - mcp.json                    │
    │  - plugin dirs                 │
    │  → writes to /tmp/cenv-session/│
    └────────────────────────────────┘
                  │
                  ▼
    claude --settings /tmp/...settings.json \
           --append-system-prompt-file /tmp/...claude.md \
           --mcp-config /tmp/...mcp.json \
           --plugin-dir /path/to/plugin1 \
           --plugin-dir /path/to/plugin2 \
           "$@"
```

### Activation Model: Wrapper (Option B)

`cenv run <env>` assembles temporary config files from the environment definition and launches `claude` with the appropriate CLI flags. The user's default `~/.claude/` setup is **never modified**.

This is a deliberate choice: Claude Code is not a runtime bound to a directory (like Python or Node). It's a tool you invoke from anywhere, on any project. You don't "enter" an environment — you **launch Claude with one**.

### Directory Structure

**Personal environments (never shared):**
```
~/.claude-envs/
  envs/
    tdd-python/
      env.yaml                     # manifest
      claude.md                    # instructions for this env
      skills/                      # optional: custom bundled skills
        db-migrations/
          SKILL.md
      hooks/                       # optional: custom hook scripts
        on-start.sh
    gstack-tryout/
      env.yaml
      claude.md
  auth/                            # NEVER leaves this machine
    personal.json
    work-api.json
    openrouter.json
  cache/                           # installed dependencies
    plugins/
      superpowers/5.0.6/
    skills/
      gstack-review/
    mcp/
      mcp-server-postgres/
```

**Project environments (shared via repo):**
```
my-project/
  .claude-envs/                    # our directory, NOT .claude/
    tdd-python/
      env.yaml
      claude.md
      skills/
        db-migrations/
          SKILL.md
```

**We do NOT touch `.claude/`.** That directory belongs to Claude Code. If Anthropic changes its structure, our tool is unaffected.

### Temporary Session Files

When `cenv run` launches, it generates temporary config files:

```
/tmp/cenv-session-<uuid>/
  settings.json                    # merged from env.yaml settings
  claude.md                        # from env folder
  mcp.json                         # assembled from env.yaml mcp_servers
```

This gives full control over what Claude sees, including cherry-picked skills and partial plugin selection. Temp files are cleaned up after the session ends.

---

## Environment Definition

### env.yaml

```yaml
name: tdd-python
description: "TDD workflow with Python tooling"

# ── Plugins (coarse-grained) ────────────────────────
# Default: full plugin included. Cherry-pick with `disable` list.
plugins:
  enable:
    - name: superpowers
      source: claude-plugins-official
      version: "^5.0.0"
    - name: pyright-lsp
      source: claude-plugins-official
      version: "1.0.0"
  disable:
    - superpowers:brainstorming          # disable specific skill from enabled plugin
    - superpowers:writing-plans          # granular control

# ── Skills (fine-grained, independent of plugins) ───
skills:
  - name: review
    source: github:garrytan/gstack
    ref: main
    path: skills/review
  - path: ./skills/db-migrations         # local, bundled with env

# ── MCP Servers ─────────────────────────────────────
mcp_servers:
  postgres:
    install: "uvx mcp-server-postgres"
    command: "uvx"
    args: ["mcp-server-postgres", "postgresql://localhost/mydb"]
  github:
    install: "npm install -g @modelcontextprotocol/server-github"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "keychain:github-pat"

# ── Hooks ───────────────────────────────────────────
hooks:
  SessionStart:
    - command: "echo 'TDD mode active'"
  Stop:
    - command: "./hooks/on-stop.sh"

# ── Settings ────────────────────────────────────────
settings:
  effortLevel: high
  permissions:
    allow:
      - "Bash(pytest *)"
      - "Bash(uv *)"
```

### claude.md

A standalone markdown file per environment. **Not embedded in YAML.**

When creating a new environment, the user's current `~/.claude/CLAUDE.md` is copied as a starting point. After that, it's the env's own file — edited directly with any editor.

### Composable Units

Every piece is independently composable. A plugin is one way to bundle them, but you can cherry-pick at any granularity:

| Unit | Can reference from | Can disable individually |
|------|-------------------|------------------------|
| Plugin | marketplace, git repo, local path | Yes |
| Skill (within a plugin) | plugin name + skill name | Yes |
| Skill (standalone) | git repo, local path | Yes |
| MCP Server (within a plugin) | plugin name + server name | Yes |
| MCP Server (standalone) | install command + run command | Yes |
| Hook (within a plugin) | plugin name + hook type | Yes |
| Hook (standalone) | shell command | Yes |
| Settings | inline in env.yaml | N/A — merged |

**Plugin default behavior:** When a plugin is enabled, ALL its components are included. Cherry-picking is opt-in — you disable specific components you don't want, not select the ones you do.

---

## Auth System

Auth is **completely orthogonal** to environments. It answers "where do tokens come from" — not "how does Claude behave."

### Auth Profiles

Stored in `~/.claude-envs/auth/` — **never shared, never committed, never leaves the machine.**

```json
// api-key provider (Anthropic direct)
{
  "type": "api-key",
  "env": {
    "ANTHROPIC_API_KEY": "keychain:work-anthropic-key"
  }
}

// openrouter (api-key + base URL)
{
  "type": "api-key",
  "env": {
    "ANTHROPIC_API_KEY": "keychain:openrouter-key",
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1"
  }
}

// claude pro/max subscription (OAuth) — uses active session
{
  "type": "oauth"
}

// aws bedrock
{
  "type": "bedrock",
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_PROFILE": "my-aws-profile",
    "AWS_REGION": "us-east-1"
  }
}

// google vertex
{
  "type": "vertex",
  "env": {
    "CLAUDE_CODE_USE_VERTEX": "1",
    "CLOUD_ML_REGION": "us-east5",
    "ANTHROPIC_VERTEX_PROJECT_ID": "my-project"
  }
}
```

### Security

- **API keys** are stored in the system keychain (macOS Keychain, Linux secret-service). The JSON holds a `"keychain:<key-name>"` reference, never plaintext.
- **OAuth** has a Claude Code limitation: only one active session at a time. There is no native multi-profile OAuth support. The `oauth` auth type simply means "use the currently logged-in subscription." Switching OAuth accounts requires `claude logout` + re-login — this is a Claude Code constraint we cannot work around.
- **AWS/GCP** references existing cloud credential profiles. No cloud credentials stored by us.
- **Auto-protection:** `~/.claude-envs/auth/` gets an auto-generated `.gitignore` with `*` on creation. If cenv detects an auth file inside a git repo, it warns and refuses.

### Multi-Profile OAuth (Solved)

Claude Code natively stores one active OAuth credential at a time in the macOS Keychain (service: `Claude Code-credentials`). However, Claude Code also accepts OAuth credentials via environment variables:

```
CLAUDE_CODE_OAUTH_TOKEN          — access token (sk-ant-oat01-...)
CLAUDE_CODE_OAUTH_REFRESH_TOKEN  — refresh token (sk-ant-ort01-...)
```

**cenv's multi-profile OAuth approach:**
1. `cenv auth create work-sub` → snapshot current keychain credentials → store in cenv's own keychain entry (`cenv-auth:work-sub`)
2. `cenv run --auth work-sub` → read from `cenv-auth:work-sub` → inject as `CLAUDE_CODE_OAUTH_TOKEN` + `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` env vars
3. No keychain swapping, no restore-on-exit, no mutation of Claude Code's state
4. Multiple OAuth profiles can run simultaneously in different terminals

The OAuth auth profile JSON:
```json
{
  "type": "oauth",
  "keychainEntry": "cenv-auth:work-sub"
}
```

For NEW OAuth accounts, the flow is:
1. Back up current keychain credentials
2. Run `claude logout && claude login` → user authenticates new account
3. Snapshot new credentials → store in cenv keychain entry
4. Restore original credentials to Claude Code's keychain
5. Done — both profiles available via env var injection

---

## Name Resolution

When `cenv run tdd-python` is invoked:

1. If it's a path (starts with `./` or `/`) → use directly, no resolution
2. Search `~/.claude-envs/envs/tdd-python/`
3. Search `./.claude-envs/tdd-python/` (current repo)
4. If found in **one** location → use it silently
5. If found in **both** → interactive picker:

```
Found "tdd-python" in multiple locations:

❯ 1. ~/.claude-envs/envs/tdd-python     (personal)
  2. ./.claude-envs/tdd-python           (project: my-api)

Select environment (1-2):
```

6. If not found → error with suggestions

---

## Dependency Installation

### `cenv install <env>`

Checks what the env.yaml requires vs what's available, using a **hybrid approach**: use what's already installed in Claude Code, cache the rest locally.

```
$ cenv install tdd-python

  ✓ superpowers@claude-plugins-official v5.0.6 (installed in Claude Code)
  ↓ pyright-lsp@claude-plugins-official v1.0.0 (caching locally...)
  ↓ skill: review from garrytan/gstack (fetching...)
  ✓ mcp-server-postgres (available via uvx)

  Environment ready. Run with: cenv run tdd-python
```

### Version Resolution

env.yaml supports semver ranges:

```yaml
plugins:
  enable:
    - name: superpowers
      source: claude-plugins-official
      version: "^5.0.0"          # any 5.x.x satisfies
    - name: pyright-lsp
      source: claude-plugins-official
      version: "1.0.0"           # exact pin
```

On version mismatch, interactive resolution:

```
⚠ superpowers@claude-plugins-official
  env requires:  ^5.0.0
  installed:     v4.0.3 (does not satisfy)

  ❯ 1. Cache v5.0.6 for this env (recommended)
    2. Use installed v4.0.3 anyway
    3. Upgrade global installation to v5.0.6
```

### Cache Location

```
~/.claude-envs/
  cache/
    plugins/
      superpowers/5.0.6/          # loaded via --plugin-dir
    skills/
      gstack-review/              # copied skill
    mcp/
      mcp-server-postgres/        # installed package
```

---

## CLI Command Surface

### Core

```bash
cenv run <env>                         # launch claude with env
cenv run <env> --auth <profile>        # with specific auth
cenv run <env> --auth                  # interactive auth picker
cenv run ./path/to/env                 # explicit path
cenv run                               # interactive env picker
cenv run <env> -- -p "fix the bug"     # pass-through args to claude
```

### Environment Management

```bash
cenv create <name>                     # empty scaffold
cenv create <name> --snapshot          # from current claude setup
cenv create <name> --from <source>     # from repo/path/template
cenv create <name> --wizard            # interactive cherry-picker

cenv edit <name>                       # open env.yaml in $EDITOR
cenv edit <name> --md                  # open claude.md in $EDITOR

cenv list                              # all envs (personal + current repo)
cenv show <name>                       # details: plugins, skills, mcp, hooks
cenv diff <env1> <env2>                # compare two envs
cenv delete <name>                     # remove env (with confirmation)
```

### Sharing & Installation

```bash
cenv install <name>                    # install missing deps for an env
cenv add <name>                        # copy repo env → personal envs
cenv add ./path --as <name>            # import from path with rename
```

### Auth (Local Only)

```bash
cenv auth create                       # interactive wizard
cenv auth create <name>                # with name pre-set
cenv auth list                         # list profiles
cenv auth delete <name>                # remove profile
```

### Setup

```bash
cenv init                              # first-time: creates ~/.claude-envs/
```

### Flag Patterns

Bare flags trigger interactive pickers:
```bash
cenv run                               # pick env interactively
cenv run <env> --auth                  # pick auth interactively
```

---

## Creation Wizard (`--wizard`)

Scans locally installed components and presents an interactive multi-select:

```
$ cenv create tdd-python --wizard

  ── Plugins ──────────────────────────────────────────
  (space to toggle, → to cherry-pick, enter to confirm)
  ❯ [✓] superpowers@claude-plugins-official v5.0.6  (full)
    [✓] pyright-lsp@claude-plugins-official v1.0.0  (full)
    [ ] claude-mem@thedotmack v10.6.2
    [ ] frontend-design@claude-plugins-official

  ── Standalone Skills ────────────────────────────────
  ❯ [✓] gstack:review
    [ ] gstack:plan
    [ ] skill-creator

  ── MCP Servers ──────────────────────────────────────
  ❯ [✓] postgres (uvx mcp-server-postgres)
    [ ] github (@modelcontextprotocol/server-github)

  ── Hooks ────────────────────────────────────────────
  ❯ [✓] SessionStart: notify.sh
    [ ] Stop: notify.sh

  ── Settings ─────────────────────────────────────────
  Import current permissions? (Y/n): y
  Effort level (low/medium/high) [high]: high

  ── CLAUDE.md ────────────────────────────────────────
  ❯ 1. Current ~/.claude/CLAUDE.md
    2. Empty
    3. Skip for now

  ✓ Created ~/.claude-envs/envs/tdd-python/
```

**Plugin cherry-picking** (when pressing → on a plugin):

```
  [~] superpowers@claude-plugins-official v5.0.6  (partial)
      ├─ Skills (5/14)
      │   [✓] test-driven-development
      │   [✓] systematic-debugging
      │   [✓] verification-before-completion
      │   [ ] brainstorming
      │   [ ] writing-plans
      │   ...
      ├─ MCP Servers (0/0)
      ├─ Hooks
      │   [✓] SessionStart
      └─ Agents (0)
```

Default is **full plugin** — cherry-picking is opt-in via expand.

---

## Security: The Allow Model

When `cenv run` encounters a project-level environment (from `.claude-envs/` in a repo), trust must be established:

```
$ cenv run tdd-python

⚠ This environment is from the project repository.

  Plugins:  superpowers@5.0.6, pyright-lsp@1.0.0
  Skills:   3 custom
  MCP:      2 servers (postgres, github)
  Hooks:    1 (SessionStart)
  Settings: effortLevel=high, 4 permission overrides

  Run `cenv allow` to trust this environment.
```

After `cenv allow`:
- Hash of the env folder contents is cached in `~/.claude-envs/.allowed`
- If the env files are modified in the repo, re-allow is required
- `cenv allow --dir .` trusts all envs in the current repo (for trusted projects)

Personal envs in `~/.claude-envs/envs/` are always trusted.

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Claude Code ecosystem alignment |
| Runtime | Bun | Fast, `bun build --compile` for binaries |
| TUI/Prompts | clack (`@clack/prompts`) | Multi-select, grouping, beautiful output |
| Config format | YAML (`env.yaml`) | Human-friendly for manifest files |
| Auth secrets | System keychain | macOS Keychain / Linux secret-service |
| Distribution | npm + GitHub releases | `npm install -g` + compiled binaries |

---

## What cenv Does NOT Do

- **Does not modify `~/.claude/`** — ever
- **Does not manage OAuth flows** — delegates to `claude auth`
- **Does not store credentials in plaintext** — keychain references only
- **Does not auto-switch on `cd`** — each invocation is explicit
- **Does not replace plugins/skills** — composes and orchestrates them
- **Does not have a global default env** — `claude` without `cenv` is always vanilla

---

## Differentiation vs Existing Tools

| Tool | What it does | What cenv adds |
|------|-------------|----------------|
| clenv | Swaps entire `~/.claude/` | Granular composition, doesn't touch `~/.claude/` |
| claudectx | Switches settings.json | Full env: skills + MCP + hooks + CLAUDE.md |
| CCS | Account/auth switching | Full env composition, auth is just one piece |
| CC Switch | Desktop GUI profiles | CLI-native, composable, team sharing |
| gstack/superpowers | Skill packs | Can compose skills FROM these into custom envs |

**cenv's unique value:** Granular composition of any Claude Code primitive (skills, MCP servers, hooks, plugins, settings, CLAUDE.md) into reproducible, shareable environments — without ever modifying the user's default setup.

---

## Open Questions for Implementation

1. **Lockfile format** — Should `cenv install` generate an `env.lock` for exact reproducibility? (v2 candidate)
2. **Environment inheritance** — Should envs be able to extend other envs? (v2 candidate)
3. **Remote templates** — Registry of community env templates? (v2 candidate)
4. **`cenv update`** — How to handle updating dependencies within an env?
5. **Conflict detection** — When two components define the same hook or skill, how to surface this?
