# Getting Started with cenv

A step-by-step guide to set up and use `cenv` — the Claude Code Environment Manager.

## Prerequisites

- macOS (Linux support coming soon)
- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)
- Claude Code installed and working (`claude --version`)

## Installation

```bash
# Clone the repo
git clone https://github.com/maurocappe/claude-code-env-manager.git
cd claude-code-env-manager

# Install dependencies
bun install

# Option A: Run directly (no install needed)
bun run src/index.ts --help

# Option B: Create a global alias
alias cenv="bun run $(pwd)/src/index.ts"

# Option C: Compile to a standalone binary
bun run compile
sudo mv cenv /usr/local/bin/
```

## Step 1: Initialize cenv

```bash
cenv init
```

This creates `~/.claude-envs/` with subdirectories for your environments, auth profiles, and cache.

## Step 2: Create Your First Environment

### Option A: Snapshot your current setup

This captures your existing Claude Code plugins, skills, settings, MCP servers, and CLAUDE.md:

```bash
cenv create my-setup --snapshot
```

### Option B: Start from scratch

```bash
cenv create my-setup
```

This creates a minimal scaffold. Edit it:

```bash
cenv edit my-setup         # edit env.yaml
cenv edit my-setup --md    # edit claude.md
```

### Option C: Use the interactive wizard

```bash
cenv create my-setup --wizard
```

The wizard scans your installed plugins, skills, and MCP servers, and lets you cherry-pick what goes into the environment.

## Step 3: Customize Your Environment

Your environment lives at `~/.claude-envs/envs/my-setup/` with two files:

**env.yaml** — what plugins, skills, MCP servers, hooks, and settings to use:

```yaml
name: my-setup
description: "My custom Claude Code environment"
isolation: additive

plugins:
  enable:
    - name: superpowers
      source: claude-plugins-official
      version: "^5.0.0"
  disable:
    - superpowers:brainstorming    # disable specific skills

skills:
  - name: review
    source: github:garrytan/gstack
    ref: main
    path: skills/review

mcp_servers:
  postgres:
    command: "uvx"
    args: ["mcp-server-postgres", "postgresql://localhost/mydb"]

hooks:
  SessionStart:
    - command: "echo 'Custom env active'"

settings:
  effortLevel: high
  permissions:
    allow:
      - "Bash(pytest *)"
      - "Bash(uv *)"
```

**claude.md** — instructions for Claude in this environment:

```markdown
# My Setup

## Workflow
1. Always write tests first
2. Use conventional commits
3. Never push directly to main
```

## Step 4: Test It

```bash
# See what cenv would pass to claude (without launching):
cenv run my-setup --dry-run

# Actually launch:
cenv run my-setup

# Pass args through to claude:
cenv run my-setup -- -p "explain this codebase"
```

Your normal `claude` command is completely unaffected. It still uses your default `~/.claude/` setup.

## Step 5: Create More Environments

```bash
cenv create tdd-python --snapshot      # start from current, customize for TDD
cenv create minimal                     # stripped-down for quick tasks
cenv create full-stack --wizard         # cherry-pick what you need
```

```bash
# See all your environments:
cenv list

# Compare two:
cenv diff my-setup tdd-python

# Show details:
cenv show tdd-python
```

## Step 6: Set Up Auth Profiles (Optional)

If you use multiple API keys or accounts:

```bash
cenv auth create
```

The wizard walks you through setting up:
- **Anthropic API key** — stored in your system keychain, never plaintext
- **OpenRouter** — API key + base URL
- **Claude Pro/Max subscription** — snapshot your OAuth credentials for multi-profile support
- **AWS Bedrock** or **Google Vertex AI** — references your existing cloud profiles

Use with any environment:

```bash
cenv run my-setup --auth work-key
cenv run my-setup --auth              # interactive picker
```

## Step 7: Share with Your Team

Put environments in your repo:

```
my-project/
  .claude-envs/
    backend-dev/
      env.yaml
      claude.md
```

Teammates clone the repo and run:

```bash
# Install any missing plugins/skills/MCP servers:
cenv install backend-dev

# Trust the project's environments (required for security):
cenv allow

# Launch:
cenv run backend-dev
```

Like a team env? Keep it:

```bash
cenv add backend-dev                 # copies to your personal envs
cenv edit backend-dev                # customize without affecting the team
```

## Quick Reference

```bash
# Environments
cenv create <name>                   # new empty env
cenv create <name> --snapshot        # from current setup
cenv create <name> --wizard          # interactive builder
cenv create <name> --from <source>   # from repo/path
cenv list                            # show all envs
cenv show <name>                     # details
cenv edit <name>                     # edit env.yaml
cenv edit <name> --md                # edit claude.md
cenv diff <a> <b>                    # compare
cenv delete <name>                   # remove

# Running
cenv run <name>                      # launch claude with env
cenv run <name> --dry-run            # show what would run
cenv run <name> --auth <profile>     # with auth profile
cenv run                             # interactive env picker

# Sharing
cenv install <name>                  # install missing deps
cenv add <name>                      # import project env
cenv allow                           # trust project envs

# Auth
cenv auth create                     # new auth profile
cenv auth list                       # list profiles
cenv auth delete <name>              # remove profile

# Setup
cenv init                            # first-time setup
```

## How It Works

`cenv run` never modifies your `~/.claude/` directory. It:

1. Reads your env.yaml and claude.md
2. Generates temporary config files
3. Launches `claude` with the right CLI flags (`--settings`, `--plugin-dir`, `--mcp-config`, `--append-system-prompt-file`)
4. Cleans up temp files after the session

Your default Claude Code setup is always safe.

## Isolation Modes

**`additive`** (default) — layers your env on top of your existing Claude setup. You keep your default plugins, CLAUDE.md, etc. The env adds more.

**`bare`** — full isolation via `--bare` flag. Only what's in your env.yaml is loaded. Nothing from your default setup bleeds through. Use this when you want a completely controlled environment.

Set in env.yaml:
```yaml
isolation: additive   # or: bare
```

## Troubleshooting

**"Environment not found"** — Run `cenv list` to see available envs. Make sure you ran `cenv init` first.

**"Not trusted"** — Project environments need explicit trust. Run `cenv allow` in the project directory.

**Plugins not loading** — Run `cenv install <name>` to check and install missing dependencies.

**Auth not working** — Run `cenv auth list` to verify your profiles. API keys are stored in the system keychain — run `cenv auth create` to re-create if needed.
