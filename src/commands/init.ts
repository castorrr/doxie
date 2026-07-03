import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

const TEMPLATE_MAP: Record<string, string> = {
  docs: '.doxie/templates',
  commands: '.claude/commands',
  meta: '.doxie',
};

const DEPLOY_STATE_STUB = {
  drive_folder_id: '',
  subfolders: {},
  docs: {},
};

export interface InitOptions {
  force?: boolean;
}

export function init(options: InitOptions = {}): void {
  const cwd = process.cwd();
  const force = options.force ?? false;

  for (const [category, destRel] of Object.entries(TEMPLATE_MAP)) {
    const src = resolve(PACKAGE_ROOT, 'templates', category);
    const dest = resolve(cwd, destRel);
    cpSync(src, dest, {
      recursive: true,
      force,
      errorOnExist: false,
      filter: (source) => !source.split(/[\\/]/).includes('node_modules'),
    });
  }

  ensureDeployStateStub(resolve(cwd, '.doxie', 'deploy.json'));

  console.log(`Initialized doxie in ${cwd}${force ? ' (overwrote existing files)' : ''}`);
}

function ensureDeployStateStub(statePath: string): void {
  if (existsSync(statePath)) return;
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(DEPLOY_STATE_STUB, null, 2) + '\n', 'utf8');
}
