# Doxie

Ship code and docs in one go — AI-driven documentation for your codebase.

![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-%E2%89%A510-cb3837?logo=npm&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.x-3178c6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/status-hackathon-orange)

> Early hackathon scaffold. `doxie init` scaffolds templates into a target repo; the actual `/doxie:*` slash commands are run inside Claude Code.

## Prerequisites

Make sure these are installed and on your PATH before running `npm install`:

| Tool                        | Version  | Why                                                    |
| --------------------------- | -------- | ------------------------------------------------------ |
| 🟢 **[Node.js](https://nodejs.org)** | `≥ 20`   | Runtime for the CLI. Check with `node --version`.      |
| 📦 **npm**                  | `≥ 10`   | Bundled with Node 20. Used for `npm install` / `npm link`. |
| 🌿 **git**                  | any      | Required to clone the repo (and to track local edits). |

No build step or global TypeScript install is needed — `tsx` (installed locally via `npm install`) runs the `.ts` source directly via the CLI's shebang.

## Setup

```bash
git clone <repo-url> ~/path/to/doxie
cd ~/path/to/doxie
npm install
npm link
```

`npm link` puts `doxie` on your global PATH as a symlink to this clone. Edits to `src/` take effect immediately — no rebuild, no relink.

Verify:

```bash
which doxie      # resolves to your global npm bin
doxie --version  # prints the version from package.json
```

## Try it out

`doxie init` writes into the current working directory, so `cd` into whatever you want to scaffold — not this repo. Good candidates:

- An existing **non-confidential** project (open-source repo, demo app, etc.).
- A personal side project where it's fine to add some new folders.
- A throwaway scratch dir if you just want to see what gets generated:

  ```bash
  mkdir /tmp/doxie-test && cd /tmp/doxie-test
  ```

Then:

```bash
doxie init
```

You should see `doxie-docs/`, `.doxie/scripts/`, and `.claude/commands/doxie/` populated. Re-running is safe — `init` won't overwrite existing files.

Need to refresh the scaffolded templates after pulling new versions? Pass `--force`:

```bash
doxie init --force
```

This overwrites every scaffolded file in the target with the current template, so skip it if you've hand-edited files you want to keep.

## Extending: where to add new templates

`doxie init` copies everything under `templates/` into a target repo. The category folders map like this:

| To add a…           | Drop the file in…                       | Lands in the target repo at…           |
| ------------------- | --------------------------------------- | -------------------------------------- |
| Slash command       | `templates/commands/doxie/<name>.md`    | `.claude/commands/doxie/<name>.md`     |
| Docs template       | `templates/docs/<category>/<file>.md`   | `doxie-docs/<category>/<file>.md`      |
| Runtime script      | `templates/scripts/<name>.ts`           | `.doxie/scripts/<name>.ts`             |

No code changes are needed — `src/commands/init.ts` walks `templates/` recursively. Just add your file, re-run `doxie init` in a scratch dir, and check the output.

Conventions worth knowing:

- Command files are Markdown prompts (read by Claude Code as slash commands). See `templates/commands/doxie/create.md` for the shape.
- Doc templates use the `_<name>_template.md` convention (e.g. `_overview_template.md`, `_adr_template.md`, `_feature_template.md`). Anything prefixed with `_` is read by the relevant slash command at runtime and excluded from doc listings.
- Scripts are TypeScript run via `tsx`. Reference them from a command file as `tsx .doxie/scripts/<name>.ts`.

## Adding a new CLI subcommand

If you need a new top-level command (not a slash command), e.g. `doxie sync`:

1. Create `src/commands/<name>.ts` exporting a named function.
2. Wire it into `src/cli.ts` via `program.command('<name>').action(<fn>)`.

## Updating / removing

```bash
git pull
npm install            # only if dependencies changed
npm unlink -g doxie    # remove the global link
```

After pulling new doxie versions, target repos that were scaffolded against an older template won't automatically pick up the new prompts. Refresh them with `--force`:

```bash
cd /path/to/target-repo
doxie init --force
```

`--force` overwrites every file under `.claude/commands/doxie/`, `doxie-docs/`, and `.doxie/scripts/` with the current templates — including any hand-edits in the target. Skip it if you want to keep local edits, and copy the new prompt over manually instead.
