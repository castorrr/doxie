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
