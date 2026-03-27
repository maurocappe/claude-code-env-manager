import { defineCommand, runMain } from 'citty'
import pc from 'picocolors'
import { runInit } from './commands/init'
import { runCreate } from './commands/create'
import { runList } from './commands/list'
import { runShow } from './commands/show'
import { runEdit } from './commands/edit'
import { runDelete } from './commands/delete'
import { runAuthCreate } from './commands/auth/create'
import { runAuthList } from './commands/auth/list'
import { runAuthDelete } from './commands/auth/delete'
import { runAllow } from './commands/allow'

// ── Helpers ───────────────────────────────────────────────────────────────────

function notImplemented(name: string): void {
  console.log(pc.yellow(`[cenv] ${pc.bold(name)}: Not implemented yet`))
}

// ── auth subcommands ──────────────────────────────────────────────────────────

const authCreate = defineCommand({
  meta: { name: 'create', description: 'Create a new auth profile' },
  async run() {
    await runAuthCreate()
  },
})

const authList = defineCommand({
  meta: { name: 'list', description: 'List auth profiles' },
  run() {
    runAuthList()
  },
})

const authDelete = defineCommand({
  meta: { name: 'delete', description: 'Delete an auth profile' },
  args: {
    name: { type: 'positional', description: 'Profile name', required: true },
  },
  async run({ args }) {
    await runAuthDelete(args.name)
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
  async run({ args }) {
    await runCreate(args.name, {
      snapshot: args.snapshot,
      from: args.from,
      wizard: args.wizard,
    })
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
  async run({ args }) {
    await runEdit(args.name, { md: args.md })
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List all environments' },
  async run() {
    await runList()
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
  async run({ args }) {
    await runShow(args.name)
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
  async run({ args }) {
    await runDelete(args.name)
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
  async run({ args }) {
    await runAllow(args.name as string | undefined, { dir: args.dir as string | undefined })
  },
})

const init = defineCommand({
  meta: { name: 'init', description: 'First-time setup: create ~/.claude-envs/' },
  async run() {
    await runInit()
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
