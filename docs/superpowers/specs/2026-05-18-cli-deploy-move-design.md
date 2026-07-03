# Move deploy from scaffolded script to `doxie deploy` CLI subcommand

**Date:** 2026-05-18
**Branch:** `feature/move-deploy-to-cli`
**Status:** Approved (brainstorming) — pending implementation plan

## Problem

Today `doxie init` copies `templates/scripts/deploy.ts` (+ `package.json`, `package-lock.json`) into every target repo at `.doxie/scripts/`. The `/doxie:deploy` slash command runs `./.doxie/scripts/node_modules/.bin/tsx .doxie/scripts/deploy.ts`, which requires a one-time `npm install` inside `.doxie/scripts/` (~10s) plus a `.doxie/scripts/node_modules` gitignore entry that `init` appends to the target.

This bloats every target repo with a copy of the deploy engine — duplicating logic across every consumer, requiring a bootstrap install, and forcing `doxie init --force` whenever the deploy engine needs an update.

## Goal

Host the deploy engine once, in the doxie CLI itself. Target repos carry only their *configuration and state* (`.doxie/deploy.json`), *templates*, *slash commands*, and `CONTRIBUTING.md`. Running `/doxie:deploy` invokes `doxie deploy [--dry-run]` against the target's `cwd`.

## Non-goals (this scope)

- **Per-project Google accounts.** OAuth client + token files remain global at `~/.config/doxie/`. The CLI form makes a future `--account <name>` flag or `auth_dir` field in `deploy.json` straightforward to add, but we don't add it here.
- **Migration tooling for existing targets.** Hackathon-stage adopter set — a one-line "delete `.doxie/scripts/`" mention in the changelog is sufficient.
- **Automated tests.** doxie has no test suite today; this change matches the current bar with manual smoke validation.

## Design

### Architecture overview

| Concern | Lives in | Per-machine or per-project? |
|---|---|---|
| Deploy engine (code) | doxie repo at `src/commands/deploy.ts` | Per-machine (one install via `npm link`) |
| OAuth client JSON | `~/.config/doxie/oauth-client.json` | Per-machine (shared across projects) |
| OAuth refresh token | `~/.config/doxie/oauth-token.json` | Per-machine (which Google identity) |
| Drive folder ID + GDoc mapping | Target repo at `.doxie/deploy.json` | **Per-project** (committed) |
| `doxie-docs/` source markdown | Target repo | Per-project (committed) |

`doxie deploy` resolves `.doxie/deploy.json` and `doxie-docs/` from `process.cwd()`. Contract: "run from the target repo root" — same as today's scaffolded script.

### 1. New file: `src/commands/deploy.ts`

Port `templates/scripts/deploy.ts` into the doxie source tree. All pure helpers carry over unchanged in body (`hashContent`, `scanDocs`, `walk`, `diff`, `loadState`, `saveState`, `withRetry`, `extractStatus`, `errorMessage`, `ensureSubfolder`, `createDoc`, `updateDoc`, `printSummary`, OAuth helpers, constants). The file-level `__filename` / `isEntry` ESM-entrypoint plumbing is removed; no longer needed since the CLI dispatches `deploy()` directly.

Replace the `main()` + `isEntry` bootstrap block with a single named export:

```ts
export interface DeployOptions { dryRun?: boolean }
export async function deploy(options: DeployOptions = {}): Promise<void>
```

Body is the current `main()` verbatim, with `dryRun` taken from `options` instead of `process.argv`. Exit behavior preserved: throw on hard failures, `process.exit(1)` after `printSummary` if any per-doc failures accumulated.

### 2. Wire-up: `src/cli.ts`

```ts
program
  .command('deploy')
  .description('Publish doxie-docs/ to Google Drive')
  .option('--dry-run', 'Preview without making Drive writes')
  .action(async (opts) => { await deploy({ dryRun: opts.dryRun }); });
```

### 3. `package.json`

- Add `googleapis: ^144.0.0` and `google-auth-library` (explicit; today it's transitively pulled via `googleapis`, but we import the `OAuth2Client` type directly so it should be a declared dep) to `dependencies`.
- Bump `version` from `0.0.0` to `0.1.0` to mark the first CLI capability beyond `init`. Package stays `"private": true` per existing convention; the version is informational only.
- Existing users pick up the new behavior via `git pull && npm install` in their doxie clone (the `npm link` symlink stays current).

### 4. Templates: remove the scaffolded script

Delete:
- `templates/scripts/deploy.ts`
- `templates/scripts/package.json`
- `templates/scripts/package-lock.json`
- The `templates/scripts/` directory.

### 5. `src/commands/init.ts`

- Remove `scripts: '.doxie/scripts'` from `TEMPLATE_MAP`.
- Remove the `GITIGNORE_ENTRY` constant and the `ensureGitignoreEntry` call. `init` no longer touches the target's `.gitignore`.
- `ensureDeployStateStub` stays untouched — `.doxie/deploy.json` is still scaffolded and never overwritten.

Net result: `doxie init` writes `.doxie/templates/_*.md`, `.doxie/CONTRIBUTING.md`, `.doxie/deploy.json` (stub), `.claude/commands/doxie/*.md`. No `.doxie/scripts/`, no `.gitignore` mutation.

### 6. Slash command rewrite: `templates/commands/doxie/deploy.md`

Replace the "Flow" section with:

```markdown
### 1. Verify CLI is installed
Run `which doxie`. If missing, tell the user to install doxie
(see the doxie repo's setup instructions) and stop.

### 2. Resolve flags
If the user passed `--dry-run`, pass it through.

### 3. Run from the target repo root
doxie deploy [--dry-run]

### 4. Relay output verbatim
(unchanged)
```

Drop the scaffolding check, `npm install` bootstrap, and `tsx` invocation lines. Keep the "Setup requirements" section as-is.

### 7. `templates/meta/CONTRIBUTING.md` edits

- **File reference table:** drop rows for `.doxie/scripts/deploy.ts`, `.doxie/scripts/package.json` + lockfile, and `.doxie/scripts/node_modules/`.
- **Per-contributor setup:** remove the "Auto-install the script's dependencies (~10 sec)" bullet under "first run will". Add a one-liner: "Make sure doxie is installed and on your PATH (`which doxie`)."
- "How `/doxie:deploy` works" section: no edits — scan/hash/diff/persist/print behavior is unchanged.

### 8. Root `CLAUDE.md` edits

- "Expected resulting tree" section: remove the three `.doxie/scripts/` lines.
- "Adding new templates" table: remove the `templates/scripts/` row.
- Remove the mention of `init` appending `.doxie/scripts/node_modules` to the target's `.gitignore`.

## Validation (manual smoke test)

1. `cd ~/path/to/doxie && npm install` — confirm `googleapis` resolves cleanly.
2. `mkdir /tmp/doxie-test && cd /tmp/doxie-test && doxie init` — verify:
   - `.doxie/templates/_*.md` present
   - `.doxie/CONTRIBUTING.md` present
   - `.doxie/deploy.json` stub present (`drive_folder_id: ""`)
   - `.claude/commands/doxie/*.md` present
   - **No** `.doxie/scripts/`
   - No new `.gitignore` mutation from `init`
3. Populate `doxie-docs/` and set a real `drive_folder_id` in `.doxie/deploy.json`. Run `doxie deploy --dry-run` — confirm summary output format matches today.
4. Run `doxie deploy` (live) — confirm GDocs created/updated, `.doxie/deploy.json` updated atomically (the existing `.tmp` + `renameSync` pattern is preserved).
5. Negative paths from an empty cwd: `doxie deploy` should still fail fast with "No doxie-docs/" / "drive_folder_id empty" messages identical to today.
6. OAuth: delete `~/.config/doxie/oauth-token.json`, run `doxie deploy`, confirm consent flow on `127.0.0.1:8765` succeeds and token is persisted.

## Migration note for existing targets

Hackathon-stage tool, small adopter set. After upgrading doxie:

- Delete `.doxie/scripts/` from each target repo (orphaned but harmless).
- Remove the `.doxie/scripts/node_modules` line from each target's `.gitignore`.

`doxie init --force` will not prune these (`cpSync` overwrites known files but never deletes unknown ones). Manual cleanup is one `rm -rf`. A line in the doxie repo's changelog / README mentions this.

## Files touched

| File | Action |
|---|---|
| `src/commands/deploy.ts` | **Create** (port from template) |
| `src/cli.ts` | Edit — register `deploy` subcommand |
| `package.json` | Edit — add `googleapis`, `google-auth-library`; bump version to `0.1.0` |
| `package-lock.json` | Regenerated by `npm install` |
| `src/commands/init.ts` | Edit — drop `scripts` from `TEMPLATE_MAP`; drop gitignore mutation |
| `templates/scripts/deploy.ts` | **Delete** |
| `templates/scripts/package.json` | **Delete** |
| `templates/scripts/package-lock.json` | **Delete** |
| `templates/commands/doxie/deploy.md` | Rewrite Flow section |
| `templates/meta/CONTRIBUTING.md` | Edit — file table, per-contributor setup |
| `CLAUDE.md` | Edit — resulting tree, template map, gitignore mention |
