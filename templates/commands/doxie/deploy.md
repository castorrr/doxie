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
