import { defineCommand, runMain } from 'citty'
import pc from 'picocolors'

// ── Helpers ───────────────────────────────────────────────────────────────────

function notImplemented(name: string): void {
  console.log(pc.yellow(`[cenv] ${pc.bold(name)}: Not implemented yet`))
}

// ── auth subcommands ──────────────────────────────────────────────────────────

const authCreate = defineCommand({
  meta: { name: 'create', description: 'Create a new auth profile' },
  args: {
    name: { type: 'positional', description: 'Profile name', required: false },
  },
  run() {
    notImplemented('auth create')
  },
})

const authList = defineCommand({
  meta: { name: 'list', description: 'List auth profiles' },
  run() {
    notImplemented('auth list')
  },
})

const authDelete = defineCommand({
  meta: { name: 'delete', description: 'Delete an auth profile' },
  args: {
    name: { type: 'positional', description: 'Profile name', required: true },
  },
  run() {
    notImplemented('auth delete')
  },
})

// ── top-level commands ────────────────────────────────────────────────────────

const run = defineCommand({
  meta: { name: 'run', description: 'Launch Claude Code with an environment' },
  args: {
    env: {
      type: 'positional',
      description: 'Environment name or path',
      required: false,
    },
    auth: {
      type: 'string',
      description: 'Auth profile to use (omit for picker)',
      required: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Print the assembled command without executing',
      default: false,
    },
  },
  run() {
    notImplemented('run')
  },
})

const create = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a new environment',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name',
      required: true,
    },
    snapshot: {
      type: 'boolean',
      description: 'Snapshot current Claude Code setup',
      default: false,
    },
    from: {
      type: 'string',
      description: 'Create from a remote source (github:user/repo, ./path)',
      required: false,
    },
    wizard: {
      type: 'boolean',
      description: 'Interactive cherry-picker wizard',
      default: false,
    },
  },
  run() {
    notImplemented('create')
  },
})

const edit = defineCommand({
  meta: { name: 'edit', description: 'Open an environment in $EDITOR' },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name',
      required: true,
    },
    md: {
      type: 'boolean',
      description: 'Open claude.md instead of env.yaml',
      default: false,
    },
  },
  run() {
    notImplemented('edit')
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List all environments' },
  run() {
    notImplemented('list')
  },
})

const show = defineCommand({
  meta: { name: 'show', description: 'Show environment details' },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name',
      required: true,
    },
  },
  run() {
    notImplemented('show')
  },
})

const diff = defineCommand({
  meta: { name: 'diff', description: 'Compare two environments' },
  args: {
    env1: {
      type: 'positional',
      description: 'First environment',
      required: true,
    },
    env2: {
      type: 'positional',
      description: 'Second environment',
      required: true,
    },
  },
  run() {
    notImplemented('diff')
  },
})

const del = defineCommand({
  meta: { name: 'delete', description: 'Delete an environment' },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name',
      required: true,
    },
  },
  run() {
    notImplemented('delete')
  },
})

const install = defineCommand({
  meta: {
    name: 'install',
    description: 'Install missing dependencies for an environment',
  },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name',
      required: true,
    },
  },
  run() {
    notImplemented('install')
  },
})

const add = defineCommand({
  meta: { name: 'add', description: 'Copy a project environment to personal envs' },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name or path',
      required: true,
    },
    as: {
      type: 'string',
      description: 'Rename when importing',
      required: false,
    },
  },
  run() {
    notImplemented('add')
  },
})

const allow = defineCommand({
  meta: { name: 'allow', description: 'Trust a project environment' },
  args: {
    name: {
      type: 'positional',
      description: 'Environment name',
      required: false,
    },
    dir: {
      type: 'string',
      description: 'Trust all environments in a directory',
      required: false,
    },
  },
  run() {
    notImplemented('allow')
  },
})

const init = defineCommand({
  meta: { name: 'init', description: 'First-time setup: create ~/.claude-envs/' },
  run() {
    notImplemented('init')
  },
})

const auth = defineCommand({
  meta: { name: 'auth', description: 'Manage auth profiles' },
  subCommands: {
    create: authCreate,
    list: authList,
    delete: authDelete,
  },
  run() {
    notImplemented('auth')
  },
})

// ── Root command ──────────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'cenv',
    version: '0.1.0',
    description: 'Claude Code Environment Manager — compose and launch Claude with specific environments',
  },
  subCommands: {
    run,
    create,
    edit,
    list,
    show,
    diff,
    delete: del,
    install,
    add,
    allow,
    init,
    auth,
  },
})

runMain(main)
