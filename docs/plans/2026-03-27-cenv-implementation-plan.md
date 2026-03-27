# Implementation Plan: cenv — Claude Code Environment Manager

## Context

This plan implements the cenv CLI tool as designed in `2026-03-27-cenv-design.md`. Key technical discoveries from scouting:

- **Claude CLI flags are composable**: `--settings` adds a layer (doesn't replace), `--plugin-dir` is additive and repeatable, `--strict-mcp-config` + `--mcp-config` gives deterministic MCP control, `--append-system-prompt-file` appends to default prompt
- **`--bare` mode** gives full isolation: skips hooks, plugins, CLAUDE.md auto-discovery, keychain reads. Skills still work. `--plugin-dir`, `--settings`, `--mcp-config` all still function. BUT: also skips the default Claude Code system prompt.
- **OAuth via env vars**: `CLAUDE_CODE_OAUTH_TOKEN` + `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` enable multi-profile OAuth without keychain mutation (discovered in binary, undocumented — needs verification)
- **OAuth credentials location**: macOS Keychain entry `Claude Code-credentials` (account: `$USER`), JSON with accessToken, refreshToken, expiresAt, scopes, subscriptionType
- **Process execution**: `exec` replaces wrapper process, preserving TTY and signals. Best for interactive mode
- **`--disallowedTools`**: exists as CLI flag for blocking specific tools/skills

## Known Limitations

- **macOS-only for MVP**: Auth system uses macOS Keychain via `security` CLI. Linux support (secret-service/libsecret) is a v2 target.
- **Plugin cherry-picking deferred**: MVP supports full-plugin enable/disable + `disallowedTools` for individual skill blocking. Per-component cherry-picking (individual hooks, MCP servers within a plugin) is v0.2.0.

## Tech Stack

| Component | Library | Why |
|-----------|---------|-----|
| Runtime | Bun | Fast, compile to binary, Claude Code ecosystem |
| CLI framework | citty | Zero deps, TypeScript-first, subcommand routing |
| Interactive prompts | @clack/prompts | Multi-select, select, confirm, spinner, grouping |
| Colors | picocolors | Smallest, fastest |
| YAML parsing | yaml (npm) | Full YAML 1.2, TypeScript types |
| Semver | semver (npm) | Standard semver range matching |
| Keychain | Bun.spawn → `security` CLI | Native macOS, no extra deps |
| Testing | bun:test | Built-in, Jest-compatible |
| Linting | oxlint | Fast, Rust-based |

## Project Structure

```
src/
  index.ts                 # entry point: citty defineCommand + subcommand routing
  commands/
    run.ts                 # cenv run <env>
    create.ts              # cenv create <name> [--snapshot|--from|--wizard]
    edit.ts                # cenv edit <name> [--md]
    list.ts                # cenv list
    show.ts                # cenv show <name>
    diff.ts                # cenv diff <env1> <env2>
    delete.ts              # cenv delete <name>
    install.ts             # cenv install <name>
    add.ts                 # cenv add <name>
    allow.ts               # cenv allow [name]
    init.ts                # cenv init
    auth/
      create.ts            # cenv auth create
      list.ts              # cenv auth list
      delete.ts            # cenv auth delete
  lib/
    config.ts              # env.yaml loading, parsing, validation
    environments.ts        # env CRUD: create dirs, scaffold, snapshot
    resolver.ts            # name resolution (personal vs project, ambiguity)
    session.ts             # temp session file generation (settings.json, mcp.json)
    runner.ts              # assemble claude CLI args and exec
    auth.ts                # auth profile CRUD, env var resolution
    keychain.ts            # macOS keychain read/write via `security` CLI
    scanner.ts             # scan installed plugins, skills, MCP, hooks from ~/.claude/
    installer.ts           # dependency resolution, caching, plugin/skill fetching
    trust.ts               # allow model: hash-based trust for repo envs
    snapshot.ts            # snapshot current Claude Code setup into env.yaml
    diff.ts                # diff engine for comparing two env configs
  types.ts                 # EnvConfig, AuthProfile, PluginRef, SkillRef, etc.
  errors.ts                # CenvError, ConfigError, EnvironmentNotFoundError
  constants.ts             # paths, defaults, keychain service names
test/
  lib/
    config.test.ts
    environments.test.ts
    resolver.test.ts
    session.test.ts
    runner.test.ts
    auth.test.ts
    keychain.test.ts
    scanner.test.ts
    trust.test.ts
  commands/
    run.test.ts
    create.test.ts
    list.test.ts
  helpers/
    fixtures.ts            # test env.yaml files, mock plugin structures
    mock-env.ts            # CENV_HOME override for test isolation
```

---

## Tasks

### Task 1: Spike — Verify Undocumented Features

**What**: Experimentally verify the Claude Code features we depend on before building on them.

**Where**: Manual testing + documented results in `docs/spike-results.md`

**Verify**:
1. `--plugin-dir` is repeatable: `claude --plugin-dir A --plugin-dir B` loads both
2. `--disallowedTools` works for skill names: `claude --disallowedTools "Skill(superpowers:brainstorming)"` blocks that skill
3. `CLAUDE_CODE_OAUTH_TOKEN` env var works: set it, run claude, verify auth works without keychain
4. `--bare` + `--append-system-prompt-file`: does append work in bare mode? Or is it only `--system-prompt-file`?
5. `--bare` + `--settings`: does the settings layer apply?
6. `--bare` + `--plugin-dir`: do plugins load?
7. `--strict-mcp-config` + `--mcp-config`: verify only specified servers load
8. citty `--` pass-through: can citty forward args after `--` to claude?
9. `bun build --compile` with citty + yaml + clack: verify compiled binary works

**Output**: `docs/spike-results.md` documenting what works, what doesn't, and any necessary design adjustments.

**Watch out**: If `CLAUDE_CODE_OAUTH_TOKEN` doesn't work, fallback is keychain swap approach (more complex but proven). If `--bare` drops the system prompt entirely, we need the `isolation: bare | additive` approach.

---

### Task 2: Project Scaffolding

**What**: Initialize the Bun + TypeScript project with all dependencies, build scripts, and config files.

**Where**: Project root

**Deliverables**:
- `package.json` with:
  - `bin: { "cenv": "./dist/index.js" }`
  - scripts: dev, build, compile, test, typecheck, check
  - dependencies: citty, @clack/prompts, picocolors, yaml, semver
  - devDependencies: @types/bun, typescript, oxlint
- `tsconfig.json` with Bun-recommended settings
- `.gitignore` (node_modules, dist, cenv binary)
- `src/index.ts` — citty `defineCommand` with all subcommands as stubs
- `src/types.ts` — all TypeScript interfaces
- `src/errors.ts` — CenvError, ConfigError, EnvironmentNotFoundError, AuthError
- `src/constants.ts` — CENV_HOME, ENVS_DIR, AUTH_DIR, CACHE_DIR, SESSIONS_DIR
- Verify: `bun run src/index.ts --help` shows all commands
- Verify: `bun build src/index.ts --compile --outfile cenv` produces working binary

**Tests**: `bun test` passes. `cenv --help` output is correct.

**Builds on**: Task 1 (spike results may change type definitions)

---

### Task 3: Keychain Module

**What**: Low-level macOS Keychain integration used by both auth and session modules.

**Where**: `src/lib/keychain.ts`

**Deliverables**:
- `keychainRead(service: string, account?: string): Promise<string | null>`
  - Runs `security find-generic-password -s <service> -g` (+ `-a <account>` if specified)
  - Parses the quirky output format: password is on stderr, prefixed with `password: "..."` or `password: 0x<hex>`
  - Returns the raw string value, or null if not found
- `keychainWrite(service: string, account: string, data: string): Promise<void>`
  - Runs `security add-generic-password -U -a <account> -s <service> -w <data>`
  - The `-U` flag updates if exists, creates if not
- `keychainDelete(service: string, account: string): Promise<void>`
  - Runs `security delete-generic-password -a <account> -s <service>`
- All via `Bun.spawn`, capturing stderr for password output
- Error handling: distinguish "not found" from actual errors

**Watch out**: The `security` CLI outputs the password to **stderr**, not stdout. The `-g` flag is what triggers password display. For large JSON payloads, test with the actual credential size (~500 bytes).

**Tests**: Integration test against real keychain (use a unique test service name, clean up after). Mock tests for error cases.

---

### Task 4: Core Config and Directory Management

**What**: env.yaml schema, config loading, directory structure, and `cenv init`.

**Where**: `src/types.ts`, `src/lib/config.ts`, `src/lib/environments.ts`, `src/commands/init.ts`

**Deliverables**:

**Types** (`src/types.ts`):
```typescript
interface EnvConfig {
  name: string
  description?: string
  isolation?: 'bare' | 'additive'  // default: 'additive'
  plugins?: { enable?: PluginRef[], disable?: string[] }
  skills?: SkillRef[]
  mcp_servers?: Record<string, McpServerConfig>
  hooks?: Record<string, HookConfig[]>
  settings?: SettingsConfig
}
```
- `isolation: 'additive'` (default) — overlays on top of user's existing Claude setup
- `isolation: 'bare'` — full isolation via `--bare` flag, env defines everything

**Config** (`src/lib/config.ts`):
- `loadEnvConfig(envDir: string): EnvConfig` — reads and validates env.yaml
- `writeEnvConfig(envDir: string, config: EnvConfig): void` — writes env.yaml
- Validation: required `name` field, valid semver ranges, valid plugin references

**Environments** (`src/lib/environments.ts`):
- `ensureCenvHome()` — creates `~/.claude-envs/{envs,auth,cache,sessions}` dirs
- `createEnvDir(name: string): string` — creates scaffold with empty env.yaml + claude.md
- `deleteEnvDir(name: string): void` — removes env directory
- `getEnvPath(name: string): string`, `getAuthPath(): string`, etc.

**`cenv init`**: runs `ensureCenvHome()`, creates `.gitignore` in `auth/` with `*`, prints success.

**Tests**: Config loading (valid/invalid YAML). Directory creation + idempotency. Validation errors.

---

### Task 5: Environment CRUD Commands

**What**: `create`, `list`, `show`, `edit`, `delete` commands.

**Where**: `src/commands/create.ts`, `list.ts`, `show.ts`, `edit.ts`, `delete.ts`

**Deliverables**:
- **`cenv create <name>`** — scaffold with empty env.yaml + claude.md
- **`cenv create <name> --snapshot`** — see Task 6 (snapshot logic lives in `lib/snapshot.ts`)
- **`cenv list`** — scan both `~/.claude-envs/envs/` and `./.claude-envs/`, show table: name, location, plugin/skill/mcp counts
- **`cenv show <name>`** — resolve env (Task 7), load config, display structured summary
- **`cenv edit <name>`** — open env.yaml in `$EDITOR`. `--md` opens claude.md
- **`cenv delete <name>`** — clack `confirm()` prompt, then remove

**Builds on**: Task 4 (config + environments), Task 7 (resolver — for `show` and `delete`)

**Tests**: Create + verify files. List with personal + project envs. Delete with confirmation.

---

### Task 6: Snapshot Current Setup

**What**: Read the user's current Claude Code installation and generate an env.yaml from it.

**Where**: `src/lib/snapshot.ts`, `src/lib/scanner.ts`

**Deliverables**:

**Scanner** (`src/lib/scanner.ts`):
- `scanInstalledPlugins(): InstalledPlugin[]` — reads `~/.claude/plugins/installed_plugins.json`, returns name, version, source, scope for each
- `scanInstalledSkills(): InstalledSkill[]` — reads `~/.claude/skills/` and `~/.agents/.skill-lock.json`
- `scanCurrentSettings(): object` — reads `~/.claude/settings.json`
- `scanMcpServers(): McpServerConfig[]` — reads MCP configs from settings and plugins

**Snapshot** (`src/lib/snapshot.ts`):
- `snapshotCurrentSetup(envDir: string): void`:
  1. Scan all installed components
  2. Generate env.yaml with all plugins, skills, MCP servers, hooks, settings
  3. Copy `~/.claude/CLAUDE.md` → `<envDir>/claude.md`
  4. Write env.yaml

**Builds on**: Task 4 (config writing)

**Tests**: Mock scanner with fixture data. Verify generated env.yaml structure.

---

### Task 7: Name Resolution

**What**: Resolve env name to directory path, handle ambiguity with interactive picker.

**Where**: `src/lib/resolver.ts`

**Deliverables**:
- `resolveEnv(nameOrPath: string): Promise<ResolvedEnv>`:
  1. Path (starts with `./` or `/`) → use directly
  2. Search `~/.claude-envs/envs/<name>/`
  3. Search `./.claude-envs/<name>/`
  4. One match → return
  5. Both match → clack `select()` picker (personal vs project)
  6. No match → `EnvironmentNotFoundError` with fuzzy suggestions
- `listAllEnvs(): EnvEntry[]` — both locations with metadata
- Returns: `{ path: string, source: 'personal' | 'project', config: EnvConfig }`

**Builds on**: Task 4 (config loading)

**Tests**: Single match (personal/project). Both match (mock clack). Path resolution. Not found.

---

### Task 8: Auth Profile CRUD

**What**: Create, list, delete auth profiles. Keychain storage for secrets. Env var resolution.

**Where**: `src/lib/auth.ts`, `src/commands/auth/create.ts`, `list.ts`, `delete.ts`

**Deliverables**:

**Auth module** (`src/lib/auth.ts`):
- `createAuthProfile(name: string, profile: AuthProfile): void` — writes JSON to `~/.claude-envs/auth/<name>.json`
- `loadAuthProfile(name: string): AuthProfile`
- `listAuthProfiles(): AuthProfileEntry[]` — scans auth dir, shows type + masked identifier
- `deleteAuthProfile(name: string): void` — removes JSON + keychain entries
- `resolveAuthEnvVars(profile: AuthProfile): Promise<Record<string, string>>`:
  - `api-key` → read from keychain → `{ ANTHROPIC_API_KEY: "..." }` (+ optional `ANTHROPIC_BASE_URL`)
  - `oauth` → read from keychain → `{ CLAUDE_CODE_OAUTH_TOKEN: "...", CLAUDE_CODE_OAUTH_REFRESH_TOKEN: "..." }`
  - `bedrock` → `{ CLAUDE_CODE_USE_BEDROCK: "1", AWS_PROFILE: "...", AWS_REGION: "..." }`
  - `vertex` → `{ CLAUDE_CODE_USE_VERTEX: "1", CLOUD_ML_REGION: "...", ANTHROPIC_VERTEX_PROJECT_ID: "..." }`

**`cenv auth create`** — interactive wizard:
1. Prompt name (clack `text()`)
2. Select type (clack `select()`: API key, OpenRouter, OAuth, Bedrock, Vertex, Custom)
3. Per-type flow:
   - **API key / OpenRouter / Custom**: prompt for key + optional base URL → store in keychain as `cenv-auth:<name>`
   - **Bedrock**: prompt for AWS profile + region
   - **Vertex**: prompt for project ID + region

**Builds on**: Task 3 (keychain), Task 4 (directory management)

**Tests**: Profile CRUD (mock keychain). Env var resolution for each type.

---

### Task 9: OAuth Snapshot Flow

**What**: Enable multi-profile OAuth by snapshotting credentials from Claude Code's keychain.

**Where**: `src/lib/auth.ts` (extend), `src/commands/auth/create.ts` (extend)

**Deliverables**:
- **Snapshot current session**: read `Claude Code-credentials` keychain entry → parse JSON → store in `cenv-auth:<name>` keychain entry
- **Login to new account**: backup current creds → `claude logout` + `claude login` (via Bun.spawn, inherited stdio for browser flow) → snapshot new creds → restore backup
- OAuth auth profile JSON: `{ "type": "oauth", "keychainEntry": "cenv-auth:<name>" }`

**Watch out**:
- Depends on Task 1 spike: if `CLAUDE_CODE_OAUTH_TOKEN` env var doesn't work, fallback is keychain swap approach at runtime (swap → exec → restore on exit)
- The `security` CLI outputs the password to stderr. Parse carefully
- The backup/restore flow during new account login must be robust — if login fails mid-flow, original creds must be restored

**Builds on**: Task 3 (keychain), Task 8 (auth CRUD)

**Tests**: Mock keychain reads. Test the snapshot data structure. Test backup/restore logic.

---

### Task 10: Session File Generation

**What**: Engine that reads env.yaml and generates temp config files for claude.

**Where**: `src/lib/session.ts`

**Deliverables**:
- `createSession(config: EnvConfig, envDir: string): SessionFiles`:
  - Creates `/tmp/cenv-sessions/<env-name>-<pid>/`
  - Generates `settings.json`: merged from env.yaml `settings` field. Includes `permissions`, `hooks`, `effortLevel`, `enabledPlugins`, `disallowedTools` (for skill disable)
  - Generates `mcp.json`: `{ "mcpServers": { ... } }` from env.yaml `mcp_servers`. Resolves `keychain:*` references to actual values
  - Returns paths to generated files + env's claude.md path
- `cleanupStaleSessions()`: scan `/tmp/cenv-sessions/`, find dirs whose PID no longer exists (check with `process.kill(pid, 0)`), remove them
- Skill disabling: map env.yaml `plugins.disable` entries to `disallowedTools` in settings.json

**Watch out**:
- PID-based temp dirs allow multiple simultaneous sessions of the same env
- `cleanupStaleSessions()` runs at the start of every `cenv run`
- `keychain:*` references in MCP server env vars need resolving via keychain module

**Builds on**: Task 3 (keychain), Task 4 (config)

**Tests**: Generate settings.json → verify structure. Generate mcp.json → verify format. Stale session cleanup. Keychain reference resolution (mocked).

---

### Task 11: Trust / Allow Model

**What**: Security model for project-level environments.

**Where**: `src/lib/trust.ts`, `src/commands/allow.ts`

**Deliverables**:
- `hashEnvDir(envDir: string): string` — SHA-256 of all files in env dir (env.yaml, claude.md, skills/, hooks/)
- `isAllowed(envDir: string): boolean` — check hash in `~/.claude-envs/.allowed`
- `allowEnv(envDir: string): void` — add hash to `.allowed`
- `cenv allow [name]` — resolves env, computes hash, saves trust
- `cenv allow --dir .` — trusts all envs in `.claude-envs/`
- Personal envs always trusted (skip check)

**Builds on**: Task 7 (resolver)

**Tests**: Hash stability. Allow → trusted. Modify → untrusted. Personal → always trusted.

---

### Task 12: The Run Engine

**What**: Core `cenv run` command — assembles everything and launches claude.

**Where**: `src/commands/run.ts`, `src/lib/runner.ts`

**Deliverables**:

**Runner** (`src/lib/runner.ts`):
- `assembleClaudeArgs(session: SessionFiles, envConfig: EnvConfig, plugins: ResolvedPlugin[]): string[]`:
  - If `isolation: 'bare'`: assemble with `--bare` flag
  - If `isolation: 'additive'` (default): assemble without `--bare`
  - Always includes: `--settings <session>/settings.json`
  - Plugin dirs: `--plugin-dir <path>` for each resolved plugin
  - MCP: `--strict-mcp-config --mcp-config <session>/mcp.json` (bare mode) or `--mcp-config <session>/mcp.json` (additive)
  - System prompt: `--append-system-prompt-file <env>/claude.md`
  - Pass-through args from user
- `execClaude(args: string[], env: Record<string, string>): never`:
  - Uses Bun's exec equivalent (or `Bun.spawn` with `{ stdio: 'inherit' }` and process replacement)
  - Injects auth env vars
  - Preserves TTY for interactive mode

**Run command** (`src/commands/run.ts`):
1. `cenv run` (no arg) → interactive env picker
2. Resolve env name/path → env directory
3. Check trust (if project env, verify allowed via Task 11)
4. Load env.yaml
5. Resolve auth (if `--auth` specified or `--auth` bare flag → picker)
6. Clean stale sessions
7. Generate session files (Task 10)
8. Resolve plugin paths (check Claude Code installed + our cache)
9. Assemble args + env vars
10. Exec claude

**`--dry-run` flag**: prints the assembled command without executing. Critical for testing.

**Builds on**: Task 7 (resolver), Task 8+9 (auth), Task 10 (session), Task 11 (trust)

**Tests**: Dry-run mode → verify generated command. Test with different isolation modes. Test auth injection. Test interactive pickers (mocked clack).

---

### Task 13: Dependency Installation (`cenv install`)

**What**: Resolve and install missing dependencies for an environment.

**Where**: `src/commands/install.ts`, `src/lib/installer.ts`

**Deliverables**:

**Installer** (`src/lib/installer.ts`):
- `resolvePluginDeps(config: EnvConfig): DepResolution[]`:
  1. For each plugin: check installed (scanner) → version match (semver)?
  2. Check cached (`~/.claude-envs/cache/`) → version match?
  3. Return status: `installed`, `cached`, `missing`, `version-mismatch`
- `installPlugin(ref: PluginRef)`: run `claude plugins install <name>@<source>` via Bun.spawn
- `cachePlugin(ref: PluginRef)`: clone/download to `~/.claude-envs/cache/plugins/`
- `installSkill(ref: SkillRef)`: git clone to `~/.claude-envs/cache/skills/`
- `checkMcpAvailable(config: McpServerConfig): boolean`: verify command exists
- `installMcpServer(config: McpServerConfig)`: run the `install` command

**`cenv install <name>`**:
1. Resolve env → load config
2. Run dependency resolution
3. Display status per dependency (spinner)
4. For version mismatches → interactive resolution (clack select: cache specific / use installed / upgrade)
5. Install missing items

**Watch out**:
- `claude plugins install` may need interactive confirmation → `Bun.spawn` with inherited stdio
- Git cloning standalone skills needs sparse checkout
- MCP `install` commands are arbitrary shell — show before executing

**Builds on**: Task 6 (scanner), Task 7 (resolver), Task 4 (config)

**Tests**: Resolution logic (all installed, all missing, version mismatch). Install commands (mocked).

---

### Task 14: `cenv add` (Import Env)

**What**: Copy a project env or path env into personal envs.

**Where**: `src/commands/add.ts`

**Deliverables**:
- `cenv add <name>` — find in `./.claude-envs/`, copy to `~/.claude-envs/envs/<name>/`
- `cenv add ./path --as <new-name>` — copy from path, rename
- If target exists → prompt: overwrite, rename, cancel
- Copies all files: env.yaml, claude.md, skills/, hooks/

**Builds on**: Task 7 (resolver)

**Tests**: Add from project. Add with rename. Conflict handling.

---

### Task 15: Creation Wizard (`cenv create --wizard`)

**What**: Interactive cherry-picker for composing environments from installed components.

**Where**: `src/commands/create.ts` (extend), `src/lib/scanner.ts` (extend)

**Deliverables**:

**Extended scanner**:
- `scanPluginComponents(pluginPath: string): PluginComponents` — reads plugin's skills/, hooks/, .mcp.json
- Returns which skills, hooks, MCP servers exist in each plugin

**Wizard flow** (clack prompts):
1. **Plugins**: `multiselect()` — installed plugins with name, version, component counts
2. **Cherry-pick option**: for each selected plugin, offer "Customize?" — if yes, show skills as `multiselect` (default: all on). Map deselected skills to `plugins.disable` in env.yaml
3. **Standalone skills**: `multiselect()` of skills not in selected plugins
4. **MCP Servers**: show current MCP servers as `multiselect()`
5. **Hooks**: show current hooks as `multiselect()`
6. **Settings**: confirm import permissions, select effort level
7. **CLAUDE.md**: `select()` — current, empty, skip
8. Generate env.yaml + claude.md

**Builds on**: Task 5 (create), Task 6 (scanner)

**Tests**: Scanner against fixture plugin structures. Wizard flow with mocked prompts.

---

### Task 16: `cenv diff`

**What**: Compare two environments side by side.

**Where**: `src/commands/diff.ts`, `src/lib/diff.ts`

**Deliverables**:
- `diffEnvConfigs(a: EnvConfig, b: EnvConfig): EnvDiff` — returns structured diff
- `cenv diff <env1> <env2>` — resolve both, display:
  - Plugins: added/removed/version-changed
  - Skills: added/removed
  - MCP: added/removed/config-changed
  - Settings: changed values
- Colored output (picocolors): green additions, red removals, yellow changes

**Builds on**: Task 4 (config), Task 7 (resolver)

**Tests**: Identical envs. Additions. Removals. Mixed changes.

---

### Task 17: `cenv create --from`

**What**: Create from a remote source.

**Where**: `src/commands/create.ts` (extend)

**Deliverables**:
- `cenv create <name> --from <source>`:
  - `github:user/repo` or `github:user/repo/path` — git clone (sparse if path)
  - `./local/path` — copy
- After creation, run `cenv install <name>`

**Builds on**: Task 5 (create), Task 13 (install)

**Tests**: From local path. Malformed source handling.

---

## Execution Order

```
Task 1 (Spike)
  ↓
Task 2 (Scaffolding) ──── Task 3 (Keychain)
  ↓                            ↓
Task 4 (Config + Dirs) ──────────────────────
  ↓                                          ↓
Task 5 (CRUD) ─── Task 6 (Scanner/Snapshot)  │
  ↓                    ↓                     │
Task 7 (Resolver)      │                     │
  ↓                    │                     │
  ├─── Task 8 (Auth CRUD) ◄── Task 3        │
  │         ↓                                │
  │    Task 9 (OAuth Snapshot) ◄── Task 3    │
  │         ↓                                │
  ├─── Task 10 (Session Gen) ◄── Task 3     │
  │         ↓                                │
  ├─── Task 11 (Trust)                       │
  │         ↓                                │
  └──► Task 12 (Run Engine) ◄── all above    │
           ↓                                 │
      Task 13 (Install) ◄── Task 6           │
           ↓                                 │
      Task 14 (Add)                          │
           ↓                                 │
      Task 15 (Wizard) ── Task 16 (Diff) ── Task 17 (--from)
```

**Parallel opportunities:**
- Tasks 2 + 3 (scaffolding + keychain)
- Tasks 5 + 6 (CRUD + scanner)
- Tasks 8 + 10 + 11 (auth + session + trust — all depend on keychain and config, independent of each other)
- Tasks 15 + 16 + 17 (wizard + diff + from)

## MVP Scope

**MVP (v0.1.0)**: Tasks 1–12
- Spike verification
- Create, list, show, edit, delete environments
- Snapshot current setup
- Name resolution with ambiguity picker
- Auth profiles (all types including multi-OAuth)
- Session file generation
- Trust model for project envs
- `cenv run` with `--dry-run`, `--auth`, interactive pickers
- Both `bare` and `additive` isolation modes

**v0.2.0**: Tasks 13–15 (install, add, wizard)
**v0.3.0**: Tasks 16–17 (diff, --from) + Linux keychain support

## Risks

1. **`CLAUDE_CODE_OAUTH_TOKEN` is undocumented** — Task 1 spike verifies this. Fallback: keychain swap at runtime.
2. **`--bare` drops default system prompt** — The `isolation` field lets users choose. `additive` (default) avoids this. `bare` is opt-in for users who want full isolation and will write a comprehensive claude.md.
3. **Plugin internal structure is not a stable API** — scanner/wizard reads plugin directories that Anthropic could restructure. Mitigated by reading only well-known paths (skills/, hooks/, .mcp.json).
4. **Temp file cleanup** — PID-based dirs with stale cleanup on startup handles crash recovery. Multiple simultaneous sessions work because each gets a unique PID-based dir.
5. **macOS-only auth** — Documented limitation. Linux support deferred to v0.3.0.
