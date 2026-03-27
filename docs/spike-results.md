# Spike Results — Claude CLI Feature Verification

**Date:** 2026-03-27

## Results

### 1. `--plugin-dir` is repeatable
**CONFIRMED** — Help text explicitly states: "repeatable: --plugin-dir A --plugin-dir B"

### 2. `--disallowedTools` works for skill names
**CONFIRMED** — Help text shows: `--disallowedTools, --disallowed-tools <tools...>` accepts "Comma or space-separated list of tool names to deny (e.g. "Bash(git:*) Edit")"
Format for skills: `Skill(plugin:skill-name)` — needs runtime verification of exact format.

### 3. `CLAUDE_CODE_OAUTH_TOKEN` env var
**EXISTS IN BINARY** — discovered via binary analysis. Runtime verification deferred to Task 9 (OAuth snapshot). Fallback: keychain swap approach.

### 4. `--bare` + `--append-system-prompt-file`
**CONFIRMED** — `--bare` help text explicitly lists `--append-system-prompt[-file]` as a way to "explicitly provide context." Both `--system-prompt-file` and `--append-system-prompt-file` are hidden but functional flags.

### 5. `--bare` + `--settings`
**CONFIRMED** — `--bare` help text lists `--settings` as supported.

### 6. `--bare` + `--plugin-dir`
**CONFIRMED** — `--bare` help text lists `--plugin-dir` as supported.

### 7. `--strict-mcp-config` + `--mcp-config`
**CONFIRMED** — `--strict-mcp-config` help: "Only use MCP servers from --mcp-config, ignoring all other MCP configurations"

### 8. citty `--` pass-through
**CONFIRMED** — `cenv run test-env -- -p "hello"` correctly parses:
- `args.env = "test-env"` (positional)
- `args._ = ["test-env", "-p", "hello"]` (all remaining args)
- Pass-through args extractable by slicing `_` after the positional

### 9. `bun build --compile` with citty + yaml + clack
**CONFIRMED** — Compiled binary works correctly. 3 modules bundled, compiles in ~280ms, binary executes identically to source.

### 10. `--auth` bare flag behavior (citty)
**CONFIRMED** — citty handles optional string flags correctly:
- `--auth work` → `args.auth = "work"` (string)
- `--auth` (bare) → `args.auth = true` (boolean)
- omitted → `args.auth = undefined`
- Can use `typeof` to distinguish: string = explicit, boolean = picker, undefined = skip

### 11. OAuth credentials in keychain
**CONFIRMED** — `security find-generic-password -s "Claude Code-credentials" -w` returns JSON with accessToken, refreshToken, expiresAt, scopes, subscriptionType. Readable without special permissions.

### 12. `--setting-sources`
**CONFIRMED** — Accepts comma-separated: `user`, `project`, `local`. Controls which settings layers load.

## Design Implications

1. **No changes needed** — all core assumptions validated
2. **`--auth` bare flag** works natively via citty's type coercion — no special handling needed
3. **Pass-through args** need extraction from `args._` after the positional arg
4. **`--disallowedTools` format** for skills needs runtime testing (likely `Skill(superpowers:brainstorming)`)
5. **`CLAUDE_CODE_OAUTH_TOKEN`** still needs runtime verification — test during Task 9
