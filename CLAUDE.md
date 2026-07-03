# Doxie

CLI that scaffolds AI-driven documentation into a target project. Runs TypeScript directly via `tsx` (no build step). Distributed via `npm link` during the hackathon — not published to npm yet.

## Tracking new files

Any new file you create that belongs to the project (source, template, doc, config) must end up tracked in git. `npm link` is a live symlink to this working tree, so an uncommitted file works locally but silently breaks for teammates on `git pull`. After adding a file:

1. Confirm it isn't caught by `.gitignore` (`git check-ignore -v <path>`).
2. `git add` it as part of the change that introduced it.
3. If it shouldn't be tracked (genuinely local/throwaway), add it to `.gitignore` explicitly rather than leaving it untracked.

## Local setup (each contributor, once)

```bash
git clone <repo-url> ~/path/to/doxie
cd ~/path/to/doxie
npm install
npm link
```

After `npm link`, the `doxie` command is on your global PATH, pointing at this clone via symlink. Edits to `src/` take effect immediately — no rebuild, no relink.

Verify:

```bash
which doxie      # should resolve to your global npm bin
doxie --version  # should print the version from package.json
```

## Testing the CLI

`doxie init` writes into `process.cwd()`, so run it from the directory you want to scaffold — not from the doxie repo itself. Reasonable targets:

- An existing non-confidential project or a personal side project.
- A throwaway scratch dir: `mkdir /tmp/doxie-test && cd /tmp/doxie-test`.

```bash
doxie init
```

Expected stdout (one summary line):

```
Initialized doxie in <cwd>
```

Resulting tree relative to the target dir:

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

`.doxie/deploy.json` is **never** overwritten by `init`, even with `--force`, because it's project state.

`doxie-docs/` is not scaffolded by `init` — it gets created on demand the first time a doc-writing slash command (e.g. `/doxie:create`) writes a file into it.

Re-running `doxie init` is safe — existing files are skipped, not overwritten. Pass `--force` (or `-f`) to overwrite every scaffolded file with the current template; use sparingly, since it clobbers any hand-edits in the target.

## Project layout

- `src/cli.ts` — entry point. Shebang is `#!/usr/bin/env -S npx tsx` so the OS runs the TypeScript file via `tsx` directly.
- `src/commands/` — one file per CLI subcommand (`init.ts`, `deploy.ts`).
- `templates/` — files copied into target projects by `doxie init`. Subfolder layout mirrors what gets written to the target repo.
- `package.json` — `bin` maps `doxie` → `src/cli.ts`. `tsx` is a runtime dep (not devDep) because the shebang invokes it at runtime.

## Adding new templates

`src/commands/init.ts` defines a `TEMPLATE_MAP` that copies each top-level folder under `templates/` to a destination in the target repo:

| Source                              | Target destination               | What it's for                          |
| ----------------------------------- | -------------------------------- | -------------------------------------- |
| `templates/commands/`               | `.claude/commands/`              | Claude Code slash command prompts      |
| `templates/docs/`                   | `.doxie/templates/`              | Template skeletons (`_<name>_template.md`) read by slash commands at runtime |
| `templates/meta/`                   | `.doxie/`                        | Meta docs that ship into the target repo (e.g. `CONTRIBUTING.md`) |

To add a new template, just drop the file into the matching folder — `cpSync` walks recursively, so `doxie init` picks it up with no code change. Verify by running `doxie init` in a fresh scratch dir and checking the output. The only place to register a brand-new top-level category is `TEMPLATE_MAP` in `src/commands/init.ts`.

(See "Tracking new files" above — new templates need to be `git add`ed like anything else.)

Conventions:

- Slash commands: `templates/commands/doxie/<name>.md` — Markdown prompt files. Read `templates/commands/doxie/create.md` for the shape.
- Doc templates use the `_<name>_template.md` convention (e.g. `_overview_template.md`, `_adr_template.md`, `_feature_template.md`) and are read by the relevant slash command at runtime. Anything prefixed with `_` is treated as a template and excluded from doc listings.

If you need a new top-level CLI subcommand (not a slash command), add `src/commands/<name>.ts` exporting a named function and wire it into `src/cli.ts` via `program.command(...).action(...)`. Then update `TEMPLATE_MAP` only if the command needs new template categories.

## Conventions

- TypeScript with native ESM (`"type": "module"`). Use `.ts` extensions in imports (e.g. `from './commands/init.ts'`) — required by `tsx`'s ESM resolver.
- Commands live in `src/commands/<name>.ts`, exported as a named function, wired into `src/cli.ts` via `program.command(...).action(...)`.
- Keep `package.json` `"private": true` until we're ready to publish — it's a safety net against accidental `npm publish`.
- `doxie init` is idempotent by default: `cpSync` runs with `force: false, errorOnExist: false`, so re-running won't overwrite existing files. The `--force` flag flips `force` to `true` for the call, overwriting every scaffolded file.

## Updating

Pull changes from git — no extra step needed since `npm link` is a live symlink:

```bash
git pull
npm install   # only if dependencies changed
```

## Removing

```bash
npm unlink -g doxie
```
