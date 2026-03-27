# cenv — Claude Code Environment Manager

Stop breaking your Claude Code setup every time you try something new.

`cenv` lets you define, compose, share, and launch Claude Code with specific environments — without ever touching your default setup. Think **nvm for Claude Code configurations**.

```bash
# Your default claude is always untouched
claude                                    # vanilla, your normal setup

# Launch with a specific environment
cenv run tdd-python                       # TDD workflow with Python tooling
cenv run gstack-fullstack                 # gstack skills + full-stack MCP servers
cenv run minimal --auth work              # stripped-down env with work API key
```

## The Problem

The Claude Code ecosystem is exploding — superpowers, gstack, claude-mem, custom MCP servers, dozens of skill packs. But trying a new setup means risking the one that already works. There's no way to:

- **Test new plugins/skills** without breaking your current config
- **Maintain multiple setups** for different projects or workflows
- **Share configurations** with your team reliably
- **Switch between approaches** (gstack for exploration, superpowers for TDD) without everything mixing together

Your options today: manually edit `~/.claude/` and pray, or use one of 15+ fragmented tools that only solve auth switching or provider switching — none handle the full picture.

## The Solution

An environment is a folder with two files:

```
~/.claude-envs/envs/tdd-python/
  env.yaml          # what plugins, skills, MCP servers, hooks, settings to use
  claude.md         # instructions for Claude in this environment
```

`cenv run tdd-python` assembles these into the right CLI flags and launches Claude. Your `~/.claude/` directory is never modified.

## Composable at Every Level

Environments aren't just "enable these plugins." Every Claude Code primitive is independently composable:

```yaml
name: tdd-python
description: "TDD workflow with Python tooling"

# Full plugins
plugins:
  enable:
    - name: superpowers
      source: claude-plugins-official
      version: "^5.0.0"
    - name: pyright-lsp
      source: claude-plugins-official
      version: "1.0.0"
  disable:
    - superpowers:brainstorming       # disable specific skills from a plugin
    - superpowers:writing-plans

# Cherry-pick individual skills (without installing the full plugin)
skills:
  - name: review
    source: github:garrytan/gstack
    ref: main
    path: skills/review
  - path: ./skills/db-migrations      # local custom skill

# Standalone MCP servers
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

# Custom hooks
hooks:
  SessionStart:
    - command: "echo 'TDD mode active'"

# Settings overrides
settings:
  effortLevel: high
  permissions:
    allow:
      - "Bash(pytest *)"
      - "Bash(uv *)"
```

Every field is optional. An environment can be as simple as "3 MCP servers and a claude.md" or as complete as a full workflow definition.

## Team Sharing

Put environments in your repo. Teammates install and run them:

```
my-project/
  .claude-envs/                    # checked into git
    backend-dev/
      env.yaml
      claude.md
      skills/
        db-migrations/SKILL.md
```

```bash
# Teammate clones the repo, then:
cenv install backend-dev           # installs missing plugins, skills, MCP servers
cenv allow                         # trust the project's environments (security check)
cenv run backend-dev               # launch Claude with the team's setup
```

Dependencies are declared with semver ranges. `cenv install` checks what's already installed in Claude Code, only caches what's missing:

```
$ cenv install backend-dev

  ✓ superpowers@claude-plugins-official v5.0.6 (already installed)
  ↓ pyright-lsp@claude-plugins-official v1.0.0 (caching locally...)
  ↓ skill: review from garrytan/gstack (fetching...)
  ✓ mcp-server-postgres (available via uvx)

  Environment ready. Run with: cenv run backend-dev
```

Like an environment from a project? Keep it:

```bash
cenv add backend-dev               # copies to your personal envs
cenv edit backend-dev               # customize it however you want
```

## Auth — Separate and Secure

Auth is orthogonal to environments. It answers "where do tokens come from" — not "how does Claude behave."

```bash
cenv auth create                   # interactive wizard
cenv auth list                     # see your profiles
cenv run my-env --auth work        # launch with specific auth
cenv run my-env --auth             # interactive auth picker
```

Supports every provider:
- **Anthropic API key** — stored in system keychain, never plaintext
- **OpenRouter** — API key + base URL
- **Claude Pro/Max subscription** — multi-profile OAuth (snapshot and swap credentials)
- **AWS Bedrock** — references existing AWS profiles
- **Google Vertex AI** — references existing GCP projects

Auth profiles never leave your machine. API keys are stored in the system keychain. If cenv detects an auth file inside a git repo, it refuses to proceed.

## Security

Project environments from git repos require explicit trust before they can run:

```
$ cenv run backend-dev

  ⚠ This environment is from the project repository.

    Plugins:  superpowers@5.0.6, pyright-lsp@1.0.0
    Skills:   3 custom
    MCP:      2 servers (postgres, github)
    Hooks:    1 (SessionStart)
    Settings: effortLevel=high, 4 permission overrides

  Run `cenv allow` to trust this environment.
```

Trust is hash-based (like direnv). Any modification to the environment files requires re-approval.

## Creating Environments

```bash
cenv create my-env                 # empty scaffold
cenv create my-env --snapshot      # clone your current Claude Code setup
cenv create my-env --from user/repo  # from a GitHub template
cenv create my-env --wizard        # interactive cherry-picker
```

The wizard scans everything installed locally and lets you compose:

```
$ cenv create my-env --wizard

  ── Plugins ──────────────────────────────────────────
  (space to toggle, enter to confirm)
  ❯ [✓] superpowers@claude-plugins-official v5.0.6  (full)
                                                     ↳ → to cherry-pick
    [✓] pyright-lsp@claude-plugins-official v1.0.0  (full)
    [ ] claude-mem@thedotmack v10.6.2
    [ ] frontend-design@claude-plugins-official

  ── MCP Servers ──────────────────────────────────────
  ❯ [✓] postgres (uvx mcp-server-postgres)
    [ ] github (@modelcontextprotocol/server-github)

  ── CLAUDE.md ────────────────────────────────────────
  ❯ 1. Current ~/.claude/CLAUDE.md
    2. Empty

  ✓ Created ~/.claude-envs/envs/my-env/
```

## CLI Reference

```bash
# Core
cenv run <env>                     # launch Claude with environment
cenv run <env> --auth <profile>    # with specific auth
cenv run <env> --auth              # interactive auth picker
cenv run                           # interactive env picker
cenv run <env> -- -p "fix bug"     # pass args through to claude

# Environment Management
cenv create <name>                 # empty scaffold
cenv create <name> --snapshot      # from current setup
cenv create <name> --from <source> # from repo/path
cenv create <name> --wizard        # interactive cherry-picker
cenv edit <name>                   # open env.yaml in $EDITOR
cenv edit <name> --md              # open claude.md in $EDITOR
cenv list                          # all envs (personal + project)
cenv show <name>                   # environment details
cenv diff <env1> <env2>            # compare two envs
cenv delete <name>                 # remove (with confirmation)

# Sharing
cenv install <name>                # install missing dependencies
cenv add <name>                    # copy project env to personal
cenv add ./path --as <name>        # import from path
cenv allow                         # trust project environments

# Auth
cenv auth create                   # interactive wizard
cenv auth list                     # list profiles
cenv auth delete <name>            # remove profile

# Setup
cenv init                          # first-time setup
```

## How It Works

`cenv` never modifies your `~/.claude/` directory. When you run `cenv run <env>`, it:

1. Reads the environment's `env.yaml` and `claude.md`
2. Generates temporary config files (settings.json, mcp.json)
3. Resolves plugin paths (from Claude Code's cache or cenv's own cache)
4. Resolves auth credentials (from system keychain)
5. Launches `claude` with the right CLI flags:

```bash
claude --settings /tmp/cenv-session/settings.json \
       --plugin-dir /path/to/superpowers \
       --plugin-dir /path/to/pyright-lsp \
       --strict-mcp-config --mcp-config /tmp/cenv-session/mcp.json \
       --append-system-prompt-file ~/.claude-envs/envs/tdd-python/claude.md
```

Your default `claude` command always works exactly as before.

## Install

```bash
# npm
npm install -g claude-code-env-manager

# or download binary from GitHub releases
curl -fsSL https://github.com/YOUR_ORG/cenv/releases/latest/download/cenv-macos-arm64 -o cenv
chmod +x cenv && mv cenv /usr/local/bin/

# then
cenv init
```

## What cenv Does NOT Do

- **Does not modify `~/.claude/`** — ever
- **Does not manage OAuth flows** — delegates to Claude Code
- **Does not store credentials in plaintext** — keychain only
- **Does not auto-switch on `cd`** — each invocation is explicit
- **Does not replace plugins/skills** — composes and orchestrates them

## vs Existing Tools

| Tool | What it does | What cenv adds |
|------|-------------|----------------|
| clenv | Swaps entire `~/.claude/` | Granular composition, doesn't touch `~/.claude/` |
| claudectx | Switches settings.json | Full env: skills + MCP + hooks + CLAUDE.md |
| CCS | Account/auth switching | Full env composition, auth is just one piece |
| CC Switch | Desktop GUI profiles | CLI-native, composable, team sharing |
| gstack / superpowers | Skill packs | Compose skills FROM these into custom envs |

## Status

Under active development. See the [implementation plan](docs/plans/2026-03-27-cenv-implementation-plan.md) for current progress.

## License

MIT
