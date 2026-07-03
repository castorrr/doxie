# Move deploy to `doxie deploy` CLI subcommand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the deploy engine from a scaffolded `.doxie/scripts/deploy.ts` in every target repo into a `doxie deploy` CLI subcommand hosted in the doxie repo itself, so target repos only carry per-project config/state (`.doxie/deploy.json`) and slash-command markdown.

**Architecture:** Port the current `templates/scripts/deploy.ts` into `src/commands/deploy.ts` as a named-export function `deploy(options)`; wire it into `src/cli.ts` via commander. Add `googleapis` to doxie's own deps so the engine ships with the CLI. Delete the `templates/scripts/` tree and the `scripts` entry from `init.ts`'s `TEMPLATE_MAP`, plus the gitignore mutation. Rewrite the `/doxie:deploy` slash command to just invoke `doxie deploy`. Behavior on the user-facing side (OAuth, state file schema, Drive layout, summary format, dry-run) is unchanged.

**Tech Stack:** TypeScript (ESM, `tsx` runtime, no build), commander for CLI dispatch, googleapis for Drive/Docs API. Distribution via `npm link` (no npm publish yet).

**Reference spec:** `docs/superpowers/specs/2026-05-18-cli-deploy-move-design.md`

**Validation strategy:** No automated tests — doxie has no test suite today (the `tests/*.test.ts` script in `package.json` is aspirational; `tests/` does not exist). Per the spec, validation is manual smoke tests at each gate, against a scratch target directory at `/tmp/doxie-test-<task>`. This matches the project's current bar.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/commands/deploy.ts` | **Create** | Deploy engine — scan / hash / diff / upload / state persist. Named export `deploy(options)`. |
| `src/cli.ts` | Modify | Wire up the `deploy` subcommand. Switch `program.parse()` → `program.parseAsync()` (async action). |
| `package.json` | Modify | Add `googleapis`, `google-auth-library`. Bump version `0.0.0` → `0.1.0`. |
| `package-lock.json` | Regenerated | By `npm install`. |
| `src/commands/init.ts` | Modify | Remove `scripts` entry from `TEMPLATE_MAP`. Remove `GITIGNORE_ENTRY` + `ensureGitignoreEntry`. |
| `templates/scripts/deploy.ts` | **Delete** | No longer scaffolded. |
| `templates/scripts/package.json` | **Delete** | No longer scaffolded. |
| `templates/scripts/package-lock.json` | **Delete** | No longer scaffolded. |
| `templates/commands/doxie/deploy.md` | Modify | Rewrite "Flow" section to invoke `doxie deploy`. Keep "Setup requirements". |
| `templates/meta/CONTRIBUTING.md` | Modify | File-reference table + per-contributor setup. |
| `CLAUDE.md` | Modify | Resulting-tree section, `TEMPLATE_MAP` table, gitignore mention. |

---

## Task 1: Add `googleapis` + `google-auth-library` to doxie deps; bump version

**Files:**
- Modify: `package.json`
- Regenerated: `package-lock.json`

- [ ] **Step 1: Edit `package.json` — bump version and add deps**

Open `package.json`. Change line 3 `"version": "0.0.0"` to `"version": "0.1.0"`. In the `"dependencies"` object (lines 19-22), add the two new entries. Final dependencies block:

```json
"dependencies": {
  "commander": "^12.0.0",
  "google-auth-library": "^9.0.0",
  "googleapis": "^144.0.0",
  "tsx": "^4.0.0"
}
```

(Alphabetical order matches the existing convention.)

- [ ] **Step 2: Install**

Run from the doxie repo root:
```bash
npm install
```

Expected: lockfile updates; `node_modules/googleapis` and `node_modules/google-auth-library` exist. No errors.

- [ ] **Step 3: Verify install**

```bash
ls node_modules/googleapis/package.json node_modules/google-auth-library/package.json
```

Expected: both files exist. No error.

```bash
doxie --version
```

Expected: prints `0.1.0`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "add googleapis dep and bump version for deploy subcommand"
```

---

## Task 2: Create `src/commands/deploy.ts` — port the engine

**Files:**
- Create: `src/commands/deploy.ts`

This is a port of `templates/scripts/deploy.ts` with the entrypoint reshaped into a named-export function. The pure helpers transfer unchanged.

- [ ] **Step 1: Create the file**

Create `src/commands/deploy.ts` with this content. (This is the entire file — long, but self-contained. Compare against `templates/scripts/deploy.ts` to confirm the helpers transferred unchanged.)

```typescript
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { google, type drive_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

export interface DocEntry {
  gdoc_id: string;
  content_hash: string;
  last_deployed_at: string;
}

export interface DeployState {
  drive_folder_id: string;
  subfolders: Record<string, string>;
  docs: Record<string, DocEntry>;
}

export interface ScannedDoc {
  path: string;
  hash: string;
  content: string;
}

export interface DeployOptions {
  dryRun?: boolean;
}

export function hashContent(content: string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

export function scanDocs(docsRoot: string): ScannedDoc[] {
  const results: ScannedDoc[] = [];
  walk(docsRoot, docsRoot, results);
  return results;
}

function walk(root: string, current: string, results: ScannedDoc[]): void {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const full = join(current, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(root, full, results);
    } else if (stat.isFile() && entry.endsWith('.md')) {
      const content = readFileSync(full, 'utf8');
      results.push({
        path: relative(root, full).split(/\\/g).join('/'),
        hash: hashContent(content),
        content,
      });
    }
  }
}

export interface DiffResult {
  toCreate: ScannedDoc[];
  toUpdate: { doc: ScannedDoc; gdocId: string }[];
  unchanged: ScannedDoc[];
  stale: { path: string; gdocId: string }[];
}

export function diff(state: DeployState, scanned: ScannedDoc[]): DiffResult {
  const result: DiffResult = { toCreate: [], toUpdate: [], unchanged: [], stale: [] };
  const scannedPaths = new Set(scanned.map((d) => d.path));

  for (const doc of scanned) {
    const entry = state.docs[doc.path];
    if (!entry) {
      result.toCreate.push(doc);
    } else if (entry.content_hash !== doc.hash) {
      result.toUpdate.push({ doc, gdocId: entry.gdoc_id });
    } else {
      result.unchanged.push(doc);
    }
  }

  for (const [path, entry] of Object.entries(state.docs)) {
    if (!scannedPaths.has(path)) {
      result.stale.push({ path, gdocId: entry.gdoc_id });
    }
  }

  return result;
}

export function loadState(path: string): DeployState {
  if (!existsSync(path)) {
    return { drive_folder_id: '', subfolders: {}, docs: {} };
  }
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    drive_folder_id: parsed.drive_folder_id ?? '',
    subfolders: parsed.subfolders ?? {},
    docs: parsed.docs ?? {},
  };
}

export function saveState(path: string, state: DeployState): void {
  const sorted: DeployState = {
    drive_folder_id: state.drive_folder_id,
    subfolders: Object.fromEntries(Object.entries(state.subfolders).sort()),
    docs: Object.fromEntries(Object.entries(state.docs).sort()),
  };
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

const OAUTH_PORT = 8765;
const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}/oauth/callback`;
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive'];

export async function loadAuth(): Promise<OAuth2Client> {
  const clientPath = join(homedir(), '.config', 'doxie', 'oauth-client.json');
  const tokenPath = join(homedir(), '.config', 'doxie', 'oauth-token.json');

  if (!existsSync(clientPath)) {
    throw new Error(
      `OAuth client credentials not found at ${clientPath}.\n` +
        'Set up a "Desktop app" OAuth client in your GCP project:\n' +
        '  1. https://console.cloud.google.com/ → APIs & Services → OAuth consent screen.\n' +
        '     If not configured: User type "Internal", App name "doxie", your email as support.\n' +
        '  2. APIs & Services → Credentials → + Create Credentials → OAuth client ID.\n' +
        '     Application type: Desktop app. Name: doxie. Create.\n' +
        '  3. Download JSON. Save to ~/.config/doxie/oauth-client.json (chmod 600).',
    );
  }

  const raw = JSON.parse(readFileSync(clientPath, 'utf8'));
  const creds = raw.installed ?? raw.web ?? raw;
  if (!creds.client_id || !creds.client_secret) {
    throw new Error(
      `Invalid OAuth client JSON at ${clientPath}. Expected client_id and client_secret fields.`,
    );
  }

  const oauth2 = new google.auth.OAuth2(creds.client_id, creds.client_secret, OAUTH_REDIRECT_URI);

  if (existsSync(tokenPath)) {
    const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'));
    oauth2.setCredentials(tokens);
    return oauth2;
  }

  const tokens = await performConsentFlow(oauth2);
  mkdirSync(join(homedir(), '.config', 'doxie'), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2) + '\n', 'utf8');
  oauth2.setCredentials(tokens);
  return oauth2;
}

async function performConsentFlow(oauth2: OAuth2Client): Promise<Record<string, unknown>> {
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: OAUTH_SCOPES,
  });

  process.stdout.write(
    '\nDoxie needs to authorize access to your Google Drive.\n' +
      'Open this URL in your browser and approve:\n\n  ' +
      authUrl +
      '\n\nWaiting for consent (Ctrl-C to cancel)...\n',
  );

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const server = createServer((req, res) => {
      (async () => {
        try {
          const url = new URL(req.url ?? '/', `http://127.0.0.1:${OAUTH_PORT}`);
          if (url.pathname !== '/oauth/callback') {
            res.writeHead(404).end('Not found');
            return;
          }
          const code = url.searchParams.get('code');
          const errParam = url.searchParams.get('error');
          if (errParam) {
            res
              .writeHead(400, { 'Content-Type': 'text/html' })
              .end(`<h1>Authorization failed</h1><p>${errParam}</p>`);
            server.close();
            reject(new Error('OAuth authorization failed: ' + errParam));
            return;
          }
          if (!code) {
            res.writeHead(400).end('Missing code parameter');
            return;
          }
          const { tokens } = await oauth2.getToken(code);
          res
            .writeHead(200, { 'Content-Type': 'text/html' })
            .end('<h1>Doxie authorized.</h1><p>You can close this tab.</p>');
          server.close();
          resolve(tokens as Record<string, unknown>);
        } catch (err) {
          try {
            res.writeHead(500).end('Token exchange failed');
          } catch {
            // socket may already be closed
          }
          server.close();
          reject(err);
        }
      })();
    });

    server.on('error', reject);
    server.listen(OAUTH_PORT, '127.0.0.1');
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = extractStatus(err);
      const retriable =
        status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
      if (!retriable || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: number | string; response?: { status?: number } };
  if (typeof e.code === 'number') return e.code;
  if (typeof e.code === 'string' && /^\d+$/.test(e.code)) return parseInt(e.code, 10);
  return e.response?.status;
}

export function errorMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null) return String(err);
  const e = err as {
    response?: { data?: { error?: { message?: string } } };
    message?: string;
  };
  return e.response?.data?.error?.message || e.message || String(err);
}

export async function ensureSubfolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
  state: DeployState,
): Promise<string> {
  if (state.subfolders[name]) return state.subfolders[name];
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  const id = res.data.id;
  if (!id) throw new Error(`Drive did not return an id when creating subfolder "${name}"`);
  state.subfolders[name] = id;
  return id;
}

export async function createDoc(
  drive: drive_v3.Drive,
  folderId: string,
  title: string,
  content: string,
): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    },
    media: {
      mimeType: 'text/markdown',
      body: content,
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  const id = res.data.id;
  if (!id) throw new Error(`Drive did not return an id when creating doc "${title}"`);
  return id;
}

export async function updateDoc(
  drive: drive_v3.Drive,
  gdocId: string,
  content: string,
): Promise<void> {
  await drive.files.update({
    fileId: gdocId,
    media: {
      mimeType: 'text/markdown',
      body: content,
    },
    supportsAllDrives: true,
  });
}

export interface SummaryInput {
  dryRun: boolean;
  folderId: string;
  created: { path: string; gdocId: string }[];
  updated: { path: string; gdocId: string }[];
  unchanged: string[];
  stale: { path: string; gdocId: string }[];
  failed: { path: string; error: string }[];
}

export function printSummary(s: SummaryInput): void {
  const folderUrl = `https://drive.google.com/drive/folders/${s.folderId}`;
  const header = s.dryRun
    ? `Dry run — no changes made. Target folder: ${folderUrl}`
    : `Deployed to folder: ${folderUrl}`;
  process.stdout.write(header + '\n\n');

  if (s.created.length) {
    process.stdout.write(`Created (${s.created.length}):\n`);
    for (const c of s.created) {
      process.stdout.write(`  - ${c.path} → https://docs.google.com/document/d/${c.gdocId}/edit\n`);
    }
    process.stdout.write('\n');
  }
  if (s.updated.length) {
    process.stdout.write(`Updated (${s.updated.length}):\n`);
    for (const u of s.updated) {
      process.stdout.write(`  - ${u.path} → https://docs.google.com/document/d/${u.gdocId}/edit\n`);
    }
    process.stdout.write('\n');
  }
  if (s.unchanged.length) {
    if (s.unchanged.length <= 5) {
      process.stdout.write(`Unchanged (${s.unchanged.length}):\n`);
      for (const p of s.unchanged) process.stdout.write(`  - ${p}\n`);
    } else {
      process.stdout.write(`Unchanged: ${s.unchanged.length} doc(s)\n`);
    }
    process.stdout.write('\n');
  }
  if (s.stale.length) {
    process.stdout.write(
      `Stale (${s.stale.length}, GDocs left in place — remove manually if desired):\n`,
    );
    for (const st of s.stale) {
      process.stdout.write(
        `  - ${st.path} → https://docs.google.com/document/d/${st.gdocId}/edit\n`,
      );
    }
    process.stdout.write('\n');
  }
  if (s.failed.length) {
    process.stdout.write(`Failed (${s.failed.length}):\n`);
    for (const f of s.failed) process.stdout.write(`  - ${f.path}: ${f.error}\n`);
    process.stdout.write('\n');
  }
}

export async function deploy(options: DeployOptions = {}): Promise<void> {
  const dryRun = options.dryRun ?? false;

  const auth = await loadAuth();
  const drive = google.drive({ version: 'v3', auth });

  const cwd = process.cwd();
  const statePath = join(cwd, '.doxie', 'deploy.json');
  const docsRoot = join(cwd, 'doxie-docs');

  if (!existsSync(docsRoot)) {
    process.stderr.write('No doxie-docs/ found. Run /doxie:create first.\n');
    process.exit(1);
  }

  const state = loadState(statePath);
  if (!state.drive_folder_id) {
    process.stderr.write(
      'drive_folder_id in .doxie/deploy.json is empty.\n' +
        'Open the file and paste the ID of the Drive folder you want to deploy into\n' +
        '(the long string after /folders/ in the Drive URL).\n' +
        'The service account email needs Editor access on that folder.\n',
    );
    process.exit(1);
  }

  const scanned = scanDocs(docsRoot);
  const d = diff(state, scanned);

  const created: { path: string; gdocId: string }[] = [];
  const updated: { path: string; gdocId: string }[] = [];
  const failed: { path: string; error: string }[] = [];

  if (dryRun) {
    for (const doc of d.toCreate) created.push({ path: doc.path, gdocId: '(dry-run)' });
    for (const { doc, gdocId } of d.toUpdate) updated.push({ path: doc.path, gdocId });
  } else {
    for (const doc of d.toCreate) {
      try {
        const parts = doc.path.split('/');
        let parentId = state.drive_folder_id;
        if (parts.length > 1) {
          parentId = await ensureSubfolder(drive, state.drive_folder_id, parts[0], state);
          saveState(statePath, state);
        }
        const title = parts[parts.length - 1].replace(/\.md$/, '');
        const gdocId = await withRetry(() => createDoc(drive, parentId, title, doc.content));
        state.docs[doc.path] = {
          gdoc_id: gdocId,
          content_hash: doc.hash,
          last_deployed_at: new Date().toISOString(),
        };
        saveState(statePath, state);
        created.push({ path: doc.path, gdocId });
      } catch (err) {
        const msg = errorMessage(err);
        failed.push({ path: doc.path, error: msg });
        process.stderr.write(`Failed to create ${doc.path}: ${msg}\n`);
        if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
      }
    }

    for (const { doc, gdocId } of d.toUpdate) {
      try {
        await withRetry(() => updateDoc(drive, gdocId, doc.content));
        state.docs[doc.path] = {
          gdoc_id: gdocId,
          content_hash: doc.hash,
          last_deployed_at: new Date().toISOString(),
        };
        saveState(statePath, state);
        updated.push({ path: doc.path, gdocId });
      } catch (err) {
        const msg = errorMessage(err);
        failed.push({ path: doc.path, error: msg });
        process.stderr.write(`Failed to update ${doc.path}: ${msg}\n`);
        if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
      }
    }
  }

  printSummary({
    dryRun,
    folderId: state.drive_folder_id,
    created,
    updated,
    unchanged: d.unchanged.map((s) => s.path),
    stale: d.stale,
    failed,
  });

  if (failed.length > 0) process.exit(1);
}
```

**Notes on the port:**
- Removed: `async function main()`, `__filename`, the `isEntry` block at the bottom (lines 480-489 of the original). The CLI now invokes `deploy()` directly.
- Added: `DeployOptions` interface; named `export async function deploy(options: DeployOptions = {})`.
- Inside `deploy`: read `dryRun` from `options.dryRun ?? false` instead of `process.argv.includes('--dry-run')`.
- Final exit: `if (failed.length > 0) process.exit(1);` — drops the `process.exit(0)` for the success path so commander can continue cleanly.
- Hard-failure paths (missing `doxie-docs/`, empty `drive_folder_id`) still call `process.exit(1)` directly. Matches today's behavior verbatim; no scope to change error handling here.
- Removed `fileURLToPath` import — no longer needed.

- [ ] **Step 2: Type-check the project**

The project has a `tsconfig.json` with `noEmit: true` and `allowImportingTsExtensions: true`. Run `tsc` with no args from the doxie root so it picks up the tsconfig and type-checks `src/**/*`:

```bash
npx tsc
```

Expected: exit code 0, no diagnostics. (If `tsc` complains about types in the ported helpers, that's a real bug — fix before continuing. Don't proceed to Task 3 with type errors.)

- [ ] **Step 3: Commit**

```bash
git add src/commands/deploy.ts
git commit -m "port deploy engine into src/commands/deploy.ts"
```

---

## Task 3: Wire `deploy` into the CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Edit `src/cli.ts`**

Replace the entire file with:

```typescript
#!/usr/bin/env -S npx tsx
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { init } from './commands/init.ts';
import { deploy } from './commands/deploy.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };

const program = new Command();

program
  .name('doxie')
  .description('Ship code and docs in one go — AI-driven documentation for your codebase.')
  .version(pkg.version);

program
  .command('init')
  .description('Scaffold docs/ in the current directory')
  .option('-f, --force', 'Overwrite existing files in the target directory')
  .action((opts: { force?: boolean }) => init({ force: opts.force }));

program
  .command('deploy')
  .description('Publish doxie-docs/ to Google Drive')
  .option('--dry-run', 'Preview without making Drive writes')
  .action(async (opts: { dryRun?: boolean }) => {
    await deploy({ dryRun: opts.dryRun });
  });

await program.parseAsync();
```

**Changes from the original:**
- New import: `import { deploy } from './commands/deploy.ts';`
- New `program.command('deploy')` block.
- Final line `program.parse()` → `await program.parseAsync()`. Needed because the `deploy` action is async; with the synchronous `parse()`, the process can exit before uploads finish.

- [ ] **Step 2: Verify `doxie deploy --help` works**

```bash
doxie deploy --help
```

Expected output (something like):
```
Usage: doxie deploy [options]

Publish doxie-docs/ to Google Drive

Options:
  --dry-run   Preview without making Drive writes
  -h, --help  display help for command
```

- [ ] **Step 3: Verify `doxie init --help` still works (regression check)**

```bash
doxie init --help
```

Expected: still shows the init help with `-f, --force` option.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "wire deploy subcommand into doxie CLI"
```

---

## Task 4: Smoke-test `doxie deploy` end-to-end against a scratch target

This is a **validation gate** — no code changes, no commit. We confirm the new CLI subcommand behaves identically to the scaffolded script before deleting the template.

- [ ] **Step 1: Pick a target directory that already has a working deploy setup**

If you have a personal target repo with `.doxie/deploy.json` populated and `doxie-docs/` content, use it. Otherwise, scaffold one:

```bash
mkdir -p /tmp/doxie-smoke && cd /tmp/doxie-smoke
doxie init
# Edit .doxie/deploy.json — paste a real drive_folder_id
mkdir -p doxie-docs
echo "# Smoke test\n\nHello world." > doxie-docs/smoke.md
```

(`~/.config/doxie/oauth-client.json` and `~/.config/doxie/oauth-token.json` must exist and point at a Google account with edit access to that folder. If not, follow the OAuth setup in `templates/meta/CONTRIBUTING.md`.)

- [ ] **Step 2: Run dry-run**

```bash
cd /tmp/doxie-smoke    # (or your real target)
doxie deploy --dry-run
```

Expected: summary printed to stdout, showing `Dry run — no changes made.` header, listing `smoke.md` (or your real docs) under `Created` with `(dry-run)` as the gdocId. Exit code 0.

- [ ] **Step 3: Run live deploy**

```bash
doxie deploy
```

Expected: same summary format but with real GDoc URLs. `.doxie/deploy.json` updated with the new `gdoc_id` + `content_hash` + `last_deployed_at` entries. Exit code 0.

- [ ] **Step 4: Re-run live deploy (idempotency check)**

```bash
doxie deploy
```

Expected: docs reported as `Unchanged`, no API writes. Exit code 0. `.doxie/deploy.json` unmodified.

- [ ] **Step 5: Negative path — missing `doxie-docs/`**

```bash
mkdir -p /tmp/doxie-empty && cd /tmp/doxie-empty
doxie deploy
```

Expected: stderr says `No doxie-docs/ found. Run /doxie:create first.`; exit code 1.

- [ ] **Step 6: Negative path — empty `drive_folder_id`**

```bash
cd /tmp/doxie-empty
doxie init
doxie deploy
```

Expected: stderr says `drive_folder_id in .doxie/deploy.json is empty.` plus the multi-line instruction. Exit code 1.

**If any of these fail, stop and diagnose before continuing — the engine port has a bug.**

---

## Task 5: Remove the scaffolded scripts template

**Files:**
- Delete: `templates/scripts/deploy.ts`
- Delete: `templates/scripts/package.json`
- Delete: `templates/scripts/package-lock.json`
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Delete the templates/scripts/ tree**

```bash
git rm -r templates/scripts/
```

Expected: three files removed (`deploy.ts`, `package.json`, `package-lock.json`).

- [ ] **Step 2: Edit `src/commands/init.ts`**

Open `src/commands/init.ts`. Apply these changes:

**Change A — remove `scripts` entry from `TEMPLATE_MAP`** (lines 8-13):

```typescript
const TEMPLATE_MAP: Record<string, string> = {
  docs: '.doxie/templates',
  commands: '.claude/commands',
  meta: '.doxie',
};
```

(Removed: `scripts: '.doxie/scripts',`)

**Change B — remove `GITIGNORE_ENTRY` constant** (line 15):

Delete this line entirely:
```typescript
const GITIGNORE_ENTRY = '.doxie/scripts/node_modules';
```

**Change C — remove the `ensureGitignoreEntry` call** (line 42):

Delete this line entirely:
```typescript
ensureGitignoreEntry(resolve(cwd, '.gitignore'), GITIGNORE_ENTRY);
```

**Change D — remove the `ensureGitignoreEntry` function and the `appendFileSync` import**

Delete the entire function (lines 54-64):

```typescript
function ensureGitignoreEntry(gitignorePath: string, entry: string): void {
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, entry + '\n', 'utf8');
    return;
  }
  const contents = readFileSync(gitignorePath, 'utf8');
  const lines = contents.split('\n').map((l) => l.trim());
  if (lines.includes(entry) || lines.includes(entry + '/')) return;
  const sep = contents.endsWith('\n') ? '' : '\n';
  appendFileSync(gitignorePath, sep + entry + '\n', 'utf8');
}
```

Also update the imports on line 1 — remove `appendFileSync` and the now-unused `readFileSync`:

```typescript
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
```

After these changes, `src/commands/init.ts` should be:

```typescript
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
```

- [ ] **Step 3: Verify `doxie init` in a fresh scratch dir produces the expected tree**

```bash
rm -rf /tmp/doxie-init-test && mkdir -p /tmp/doxie-init-test && cd /tmp/doxie-init-test
doxie init
find . -type f | sort
```

Expected output (exact):
```
./.claude/commands/doxie/ask.md
./.claude/commands/doxie/create.md
./.claude/commands/doxie/deploy.md
./.claude/commands/doxie/update.md
./.doxie/CONTRIBUTING.md
./.doxie/deploy.json
./.doxie/templates/_adr_template.md
./.doxie/templates/_feature_template.md
./.doxie/templates/_overview_template.md
```

Verify:
- **No** `.doxie/scripts/` directory.
- **No** `.gitignore` file (init no longer creates one).
- `.doxie/deploy.json` contains the stub `{"drive_folder_id": "", "subfolders": {}, "docs": {}}`.

- [ ] **Step 4: Commit**

```bash
git add -u templates/ src/commands/init.ts
git commit -m "remove .doxie/scripts/ scaffolding; deploy logic now ships with CLI"
```

(`-u` stages the deletions of `templates/scripts/*` and the modifications to `init.ts`. The deletions were already staged by `git rm` in step 1; this commit picks up both.)

---

## Task 6: Rewrite the `/doxie:deploy` slash command markdown

**Files:**
- Modify: `templates/commands/doxie/deploy.md`

- [ ] **Step 1: Replace the file**

Open `templates/commands/doxie/deploy.md`. Replace the entire contents with:

```markdown
---
description: Publish doxie-docs/ to Google Drive as auto-converted Google Docs.
---

# /doxie:deploy

Publish the markdown docs in `doxie-docs/` to Google Drive. The deploy engine tracks which MD file maps to which Google Doc in `.doxie/deploy.json`, so re-runs update existing GDocs in place (the URL never changes) and only docs whose content has changed since the last deploy are pushed.

## Flow

### 1. Verify the doxie CLI is installed

Run `which doxie` (or `doxie --version`). If `doxie` isn't on PATH, tell the user they need to install/link the doxie CLI before they can deploy — point them at the doxie repo's setup instructions. Stop.

### 2. Resolve flags

If the user passed `--dry-run` (e.g. `/doxie:deploy --dry-run`), pass it through to the CLI. Dry-run reports what would deploy without making any Drive writes and does not modify `.doxie/deploy.json`.

### 3. Run the CLI

Invoke from the **target repo root** (not from `.doxie/`), so the CLI can resolve `doxie-docs/` and `.doxie/deploy.json` correctly:

```
doxie deploy [--dry-run]
```

### 4. Relay the output

Show the CLI's stdout summary back to the user verbatim — do not rephrase or summarize. The contributor needs to see the exact `Created` / `Updated` / `Unchanged` / `Stale` / `Failed` sections, along with the GDoc URLs.

If the CLI exits non-zero, also surface what was printed to stderr (this contains full error details for any per-doc failures, useful for triage).

## Setup requirements

doxie uses OAuth — each contributor authorizes once via a browser consent flow, and deployed docs are owned by their own Google account (no service account, no storage-quota issues).

### Per-project, one-time (any maintainer)

1. Create a GCP project; enable the **Drive API** and **Docs API**.
2. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - User type: **Internal** (Workspace org) or **External** (personal accounts).
   - App name: `doxie`. Support email: yours. Save.
3. **Credentials** (APIs & Services → Credentials → + Create Credentials → OAuth client ID):
   - Application type: **Desktop app**. Name: `doxie`. Create.
   - **Download JSON** — this is the OAuth client credentials.
4. In Drive, create a folder for deployed docs (any folder you own works — personal Drive is fine since files will belong to whoever deploys, not a service account).
5. Open `.doxie/deploy.json` (scaffolded by `doxie init`) and paste the folder ID into `drive_folder_id`.
6. Commit `.doxie/deploy.json`. Distribute the downloaded OAuth client JSON to teammates (password manager / Drive — it's a client config, low risk, but treat the `client_secret` as sensitive).

### Per-contributor, one-time

1. Install the doxie CLI (see the doxie repo's README; `npm link` from a local clone is the hackathon path).
2. Save the OAuth client JSON from step 3 above to `~/.config/doxie/oauth-client.json` (`chmod 600`).
3. On first `/doxie:deploy`, the CLI opens a browser for Google's consent screen. Approve. A refresh token is saved at `~/.config/doxie/oauth-token.json` and reused on subsequent runs.

The CLI fails fast with actionable messages when any of these are missing.
```

**Diff summary vs. the original:**
- Header tagline: "deploy script" → "deploy engine".
- Flow step 1: "Verify scaffolding" (check `.doxie/scripts/deploy.ts`) → "Verify the doxie CLI is installed" (check `which doxie`).
- **Deleted** entire former Flow step 2 ("Ensure deps are installed" with `npm install` bootstrap).
- Flow step 3 (formerly 4): tsx invocation → plain `doxie deploy`.
- "Per-contributor, one-time" gained a new step 1: "Install the doxie CLI."
- Last paragraph: "script fails fast" → "CLI fails fast".

- [ ] **Step 2: Verify the file is well-formed**

```bash
head -3 templates/commands/doxie/deploy.md
```

Expected: frontmatter `---` and `description:` line intact.

- [ ] **Step 3: Re-test `doxie init` and confirm the new markdown lands in the target**

```bash
rm -rf /tmp/doxie-init-test && mkdir -p /tmp/doxie-init-test && cd /tmp/doxie-init-test
doxie init
grep -c 'doxie deploy \[--dry-run\]' .claude/commands/doxie/deploy.md
```

Expected: `1`. Confirms the new content is scaffolded.

- [ ] **Step 4: Commit**

```bash
cd ~/path/to/doxie    # back to doxie repo root
git add templates/commands/doxie/deploy.md
git commit -m "rewrite /doxie:deploy slash command to invoke doxie CLI"
```

---

## Task 7: Update `templates/meta/CONTRIBUTING.md`

**Files:**
- Modify: `templates/meta/CONTRIBUTING.md`

- [ ] **Step 1: Edit the per-contributor setup section**

Open `templates/meta/CONTRIBUTING.md`. Find the "Per-contributor setup (one-time)" section (around line 54).

Replace the existing numbered list (steps 1-3, lines 56-70) with:

```markdown
1. Install the doxie CLI. From a local clone of the doxie repo:
   ```bash
   git clone <doxie-repo-url> ~/path/to/doxie
   cd ~/path/to/doxie && npm install && npm link
   which doxie    # verify it's on your PATH
   ```
2. Get `oauth-client.json` from your maintainer (see step 2 above) and save it:
   ```bash
   mkdir -p ~/.config/doxie
   mv ~/Downloads/client_secret_*.json ~/.config/doxie/oauth-client.json
   chmod 600 ~/.config/doxie/oauth-client.json
   ```
3. In Claude Code (from this repo's root), run:
   ```
   /doxie:deploy
   ```
   The first run will:
   - Print a Google OAuth URL — open it, sign in with your work account, click **Allow**.
   - Catch the browser redirect on `127.0.0.1:8765`, save a refresh token to `~/.config/doxie/oauth-token.json`, and proceed with uploads.
4. Subsequent deploys reuse the cached refresh token — no browser prompt.
```

**Changes:**
- New step 1: install the doxie CLI.
- Old step 1 (OAuth client placement) becomes step 2.
- Old step 2 becomes step 3, with the "Auto-install the script's dependencies (~10 sec)" bullet **removed**.
- Old step 3 becomes step 4.

- [ ] **Step 2: Edit the file-reference table**

Find the "File reference" section at the bottom of the file (around line 115).

Delete these three rows from the table:
- `| `.doxie/scripts/deploy.ts` | Deploy engine | Yes |`
- `| `.doxie/scripts/package.json` + `package-lock.json` | Script dependencies | Yes |`
- `| `.doxie/scripts/node_modules/` | Installed deps (auto-bootstrapped on first deploy) | No — gitignored |`

The final table should be:

```markdown
| Path | Purpose | Tracked in git |
|---|---|---|
| `doxie-docs/**/*.md` | Source markdown — what gets published | Yes |
| `.doxie/templates/_*.md` | Format guides used by `/doxie:create` and `/doxie:update` | Yes |
| `.doxie/deploy.json` | `drive_folder_id` + per-doc GDoc mapping | Yes |
| `.doxie/CONTRIBUTING.md` | This file | Yes |
| `.claude/commands/doxie/*.md` | Slash command prompts | Yes |
| `~/.config/doxie/oauth-client.json` | OAuth Desktop client (per-project, shared via password manager) | No — lives in `$HOME` |
| `~/.config/doxie/oauth-token.json` | Your personal refresh token from the consent flow | No — per-user, never shared |
```

- [ ] **Step 3: Smoke check**

```bash
grep -c '\.doxie/scripts' templates/meta/CONTRIBUTING.md
```

Expected: `0`. Confirms all references to the old scripts folder are gone.

- [ ] **Step 4: Commit**

```bash
git add templates/meta/CONTRIBUTING.md
git commit -m "update CONTRIBUTING template for CLI-based deploy"
```

---

## Task 8: Update root `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "Resulting tree" block**

Open `CLAUDE.md`. Find the section starting with "Resulting tree relative to the target dir:" (under "Testing the CLI", around line 50).

Delete these three lines from the tree block:
```
.doxie/scripts/deploy.ts
.doxie/scripts/package.json
.doxie/scripts/package-lock.json
```

The final tree block should be:

```
.doxie/templates/_overview_template.md
.doxie/templates/_feature_template.md
.doxie/templates/_adr_template.md
.doxie/deploy.json                  # empty stub; maintainer pastes drive_folder_id
.doxie/CONTRIBUTING.md              # setup + usage guide for the deploy command
.claude/commands/doxie/create.md
.claude/commands/doxie/update.md
.claude/commands/doxie/ask.md
.claude/commands/doxie/deploy.md
```

- [ ] **Step 2: Remove the gitignore-mutation note**

Find the paragraph starting with "`doxie init` also appends `.doxie/scripts/node_modules` to the target's `.gitignore`" (right below the tree block).

Replace that entire paragraph with:

```markdown
`.doxie/deploy.json` is **never** overwritten by `init`, even with `--force`, because it's project state.
```

(We're collapsing the old two-sentence note into the single sentence about `deploy.json`, which is the only non-template behavior `init` still has.)

- [ ] **Step 3: Update the `TEMPLATE_MAP` table**

Find the table under "Adding new templates" (around line 90). Delete this row:

```
| `templates/scripts/`                | `.doxie/scripts/`                | Runtime scripts invoked by commands    |
```

- [ ] **Step 4: Update the "Conventions" / `init` description**

Find the "Conventions" section near the bottom. The bullet about `doxie init` idempotency still applies unchanged. No edits needed there.

But find this earlier statement (under "Project layout" or similar — around line 80):

> Scripts are TypeScript run via `tsx`. Invoke from a command file as `tsx .doxie/scripts/<name>.ts`.

Delete this sentence entirely. There are no more scripts shipped this way; deploy is a CLI subcommand now. If a future feature genuinely needs a scaffolded script, that line can be re-added then.

- [ ] **Step 5: Smoke check**

```bash
grep -c '\.doxie/scripts' CLAUDE.md
```

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "update CLAUDE.md for CLI-based deploy"
```

---

## Task 9: Final end-to-end validation

No code changes. Confirm the full chain works in one clean run.

- [ ] **Step 1: Clean scratch dir + init**

```bash
rm -rf /tmp/doxie-final && mkdir -p /tmp/doxie-final && cd /tmp/doxie-final
doxie init
find . -type f | sort
```

Expected: exactly the 9 files listed in Task 5 Step 3. No `.doxie/scripts/`, no `.gitignore` mutation.

- [ ] **Step 2: Populate doc + folder ID**

```bash
mkdir -p doxie-docs
echo -e "# Final smoke\n\nLast check before merge." > doxie-docs/final.md
# Edit .doxie/deploy.json — paste your real drive_folder_id
```

- [ ] **Step 3: Dry-run**

```bash
doxie deploy --dry-run
```

Expected: `Dry run — no changes made.` header, `final.md` under `Created (1):` with `(dry-run)` gdocId, exit 0.

- [ ] **Step 4: Live deploy**

```bash
doxie deploy
```

Expected: real GDoc URL printed, `.doxie/deploy.json` updated. Exit 0.

- [ ] **Step 5: Edit + redeploy (update path)**

```bash
echo -e "\n\nEdited." >> doxie-docs/final.md
doxie deploy
```

Expected: `final.md` under `Updated (1):` with the same GDoc URL as before, exit 0.

- [ ] **Step 6: Idempotency**

```bash
doxie deploy
```

Expected: `final.md` under `Unchanged`, exit 0.

- [ ] **Step 7: Confirm git state on the doxie repo**

```bash
cd ~/path/to/doxie
git log --oneline main..HEAD
```

Expected: ~8 commits on `feature/move-deploy-to-cli`, one per task (1, 2, 3, 5, 6, 7, 8 — task 4 and 9 are validation gates, no commits).

```bash
git status
```

Expected: clean working tree.

---

## Done

At this point the branch is ready for PR. The PR description should mention:

- Behavior unchanged for end users; OAuth credentials, state file, Drive layout, summary format all preserved.
- Existing target repos still have orphaned `.doxie/scripts/` folders — recommend manual `rm -rf .doxie/scripts/` and removing the `.doxie/scripts/node_modules` line from their `.gitignore`. No code-level migration needed (the slash command no longer references that folder).
- Spec: `docs/superpowers/specs/2026-05-18-cli-deploy-move-design.md` (currently uncommitted — decide whether to commit alongside the implementation or discard).
