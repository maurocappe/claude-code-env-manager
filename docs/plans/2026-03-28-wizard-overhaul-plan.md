# Implementation Plan: Wizard Overhaul

**Date:** 2026-03-28
**Context:** The wizard needs to capture ALL env config explicitly. Settings that aren't in env.yaml shouldn't exist in the env. Three categories are missing: hooks, statusLine, and commands.

## Dependencies

- fake-home.ts exists and handles settings generation, skill symlinks, plugin registry
- Scanner module has `scanInstalledPlugins`, `scanInstalledSkills`, `scanPluginComponents`, `scanCurrentSettings`
- Wizard already has working patterns for multiselect, confirm, select via @clack/prompts

---

## Tasks

### Task 1: Add `statusLine` and `commands` to schema

**What:** Extend EnvConfig types to support statusLine config and commands references.

**Where:** `src/types.ts`

**Implementation:**
- Add `statusLine` to `SettingsConfig` (flexible type to support various formats):
  ```typescript
  export interface SettingsConfig {
    effortLevel?: 'low' | 'medium' | 'high'
    permissions?: PermissionsConfig
    statusLine?: Record<string, unknown>
  }
  ```
- Add `commands` to `EnvConfig`:
  ```typescript
  export interface EnvConfig {
    // ... existing fields
    commands?: CommandRef[]
  }
  export interface CommandRef {
    path: string
  }
  ```

**Watch out:** `hooks` already exists in EnvConfig — no schema change needed for hooks.

**Tests:** Type-only change, verified by compilation.

---

### Task 2: Add scanner functions for hooks, statusLine, commands

**What:** New scanner functions the wizard will call to discover available hooks, statusLine config, and commands.

**Where:** `src/lib/scanner.ts`

**Implementation:**
- `scanCurrentHooks(settingsPath?)` — reads hooks from settings.json, returns `Record<string, HookConfig[]>` or empty
- `scanStatusLine(settingsPath?)` — reads statusLine from settings.json, returns the object or null
- `scanInstalledCommands(commandsDir?)` — reads `~/.claude/commands/`, returns array of `{ name: string; path: string; description?: string }` (parse YAML frontmatter from each .md file for description)

**Watch out:** `scanCurrentSettings` already exists and returns the raw settings object. The new functions are convenience wrappers that extract specific fields. Commands are `.md` files with optional YAML frontmatter (--- delimited).

**Tests:** `test/lib/scanner.test.ts` already has 452 lines of tests. Add tests for the 3 new functions.

---

### Task 3: Update fake-home.ts for statusLine and commands

**What:** Make `generateSettings()` handle statusLine, and add commands symlink logic to `buildFakeHome`.

**Where:** `src/lib/fake-home.ts`

**Implementation:**

In `generateSettings()`:
- Add statusLine passthrough:
  ```typescript
  if (config.settings?.statusLine) {
    settings.statusLine = config.settings.statusLine
  }
  ```

In `buildFakeHome()`, after skill symlinks:
- Create `<claudeHome>/commands/` directory with symlinks:
  ```typescript
  if (config.commands?.length) {
    const commandsDir = path.join(claudeHome, 'commands')
    fs.mkdirSync(commandsDir, { recursive: true })
    for (const cmd of config.commands) {
      if (!cmd.path || !fs.existsSync(cmd.path)) continue
      const name = path.basename(cmd.path)
      safeSymlink(cmd.path, path.join(commandsDir, name))
    }
  }
  ```
- Create `<claudeHome>/hooks/` directory with symlinks for hook scripts:
  Hook commands may reference scripts (e.g., `/Users/user/.claude/hooks/notify.sh start`). Extract script paths from hook commands and symlink them so relative imports inside scripts work:
  ```typescript
  if (config.hooks) {
    const hooksDir = path.join(claudeHome, 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    // Symlink real hooks dir content so hook scripts can find siblings
    const realHooksDir = path.join(realClaudeHome, 'hooks')
    if (fs.existsSync(realHooksDir)) {
      for (const entry of fs.readdirSync(realHooksDir)) {
        safeSymlink(path.join(realHooksDir, entry), path.join(hooksDir, entry))
      }
    }
  }
  ```

**Builds on:** Task 1 (types)

**Tests:** Add to `test/lib/fake-home.test.ts` — test statusLine in settings, test command symlinks, test hooks dir symlinks.

---

### Task 4: Add wizard steps for hooks, statusLine, commands

**What:** Add 3 new wizard steps and reorder the flow. The new wizard flow:

1. Intro (existing)
2. Plugins with skill cherry-pick (existing)
3. Standalone skills (existing)
4. Commands — NEW
5. MCP servers (existing, from settings.json)
6. Hooks — NEW
7. StatusLine — NEW
8. Settings: permissions + effort (existing)
9. CLAUDE.md source (existing)
10. Write files (existing)
11. Outro (existing)

**Where:** `src/commands/wizard.ts`

**Implementation:**

**Step 4 — Commands (NEW):**
```typescript
const allCommands = scanInstalledCommands(/* commandsDir override */)
if (allCommands.length > 0) {
  const commandOptions = allCommands.map(c => ({
    value: c.path,
    label: c.name,
    hint: c.description,
  }))
  const chosen = await multiselect({
    message: 'Select commands to include:',
    options: commandOptions,
    required: false,
  })
  abortOnCancel(chosen)
  selectedCommandPaths.push(...(chosen as string[]))
}
```

**Step 6 — Hooks (NEW):**
```typescript
const currentHooks = scanCurrentHooks(settingsPath)
const hookEventNames = Object.keys(currentHooks)
if (hookEventNames.length > 0) {
  const importHooks = await confirm({
    message: `Import ${hookEventNames.length} hook(s) from settings? (${hookEventNames.join(', ')})`,
    initialValue: true,
  })
  abortOnCancel(importHooks)
  if (importHooks) {
    selectedHooks = currentHooks
  }
}
```

**Step 7 — StatusLine (NEW):**
```typescript
const currentStatusLine = scanStatusLine(settingsPath)
if (currentStatusLine) {
  const importStatusLine = await confirm({
    message: 'Import current statusLine configuration?',
    initialValue: true,
  })
  abortOnCancel(importStatusLine)
  if (importStatusLine) {
    selectedStatusLine = currentStatusLine
  }
}
```

**Update config building (Step 10):**
```typescript
if (selectedCommandPaths.length > 0) {
  config.commands = selectedCommandPaths.map(p => ({ path: p }))
}
if (selectedHooks && Object.keys(selectedHooks).length > 0) {
  config.hooks = selectedHooks
}
if (selectedStatusLine) {
  if (!config.settings) config.settings = {}
  config.settings.statusLine = selectedStatusLine
}
```

**Watch out:**
- The wizard's `WizardPaths` interface needs new optional overrides: `commandsDir?`
- Hook commands may contain absolute paths to `~/.claude/hooks/` — these should work since they're absolute, not HOME-relative
- The scanner functions need to be imported

**Builds on:** Tasks 1, 2, 3

**Tests:** Update `test/commands/wizard.test.ts` — add tests for hooks import, statusLine import, commands selection.

---

### Task 5: Update wizard tests

**What:** Add tests for the 3 new wizard steps. Update existing tests that mock the clack prompt sequence (they'll need additional responses for the new prompts).

**Where:** `test/commands/wizard.test.ts`

**Implementation:**
- Existing tests use `mockClack()` with ordered multiselect/confirm/select responses. The new steps add more prompts:
  - Commands: 1 multiselect (if commands exist)
  - Hooks: 1 confirm
  - StatusLine: 1 confirm
- Existing tests that have NO commands/hooks/statusLine available should be unaffected (steps are skipped when empty)
- Add new test suite:
  - `runWizard — hooks import`: test with hooks in settings, verify env.yaml has hooks
  - `runWizard — statusLine import`: test with statusLine in settings, verify env.yaml has statusLine
  - `runWizard — commands selection`: test with commands dir, verify env.yaml has commands
  - `runWizard — all steps combined`: full flow with everything available

**Builds on:** Task 4

---

## Task Dependency Graph

```
Task 1 (types) ────────┐
                        ├──→ Task 3 (fake-home)
Task 2 (scanners) ─────┤
                        ├──→ Task 4 (wizard) ──→ Task 5 (wizard tests)
                        │
                        └──→ Task 3 also needs Task 1
```

Tasks 1 and 2 are independent (parallel).
Task 3 depends on 1.
Task 4 depends on 1, 2, and 3.
Task 5 depends on 4.

---

## Testing Strategy

**Unit:** Scanner tests for new functions, fake-home tests for statusLine + commands.
**Integration:** Wizard tests with mocked clack prompts verifying env.yaml output.
**Manual:** Run `cenv create --wizard full-test`, verify all steps appear and env.yaml captures everything.

## Risks

1. **Existing wizard tests break** — New wizard steps add prompts. If existing test fixtures DON'T have hooks/statusLine/commands available, those steps are skipped (no prompt consumed). But verify this by running existing tests after Task 4 changes. If tests break, update mockClack responses to account for new prompts.
2. **Command frontmatter parsing** — `.md` files may not have YAML frontmatter. Scanner must handle both (with and without frontmatter) gracefully, returning `undefined` for description.
3. **Hook script relative imports** — Hook commands may contain scripts with relative imports. Mitigated by symlinking the entire real `~/.claude/hooks/` dir into fake HOME so siblings are accessible.
