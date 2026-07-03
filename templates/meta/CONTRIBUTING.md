# Doxie deployment guide

This project uses **doxie** to author docs in `doxie-docs/` and publish them to Google Drive via the `/doxie:deploy` slash command.

## Slash commands

| Command | Purpose |
|---|---|
| `/doxie:create` | Draft new docs (Overview / Feature / ADR) from repo state. |
| `/doxie:update` | Edit an existing doc. |
| `/doxie:ask` | Ask questions about the docs. |
| `/doxie:deploy` | Publish `doxie-docs/` to Google Drive as auto-converted Google Docs. |

---

## One-time per-project setup

These steps only happen once for the whole team. Any maintainer can do them; teammates just need the artifacts from step 2 (the OAuth client JSON) and a folder ID committed to git.

### 1. GCP project + OAuth consent screen

1. Create a Google Cloud project at https://console.cloud.google.com/.
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Docs API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** if your org is on Google Workspace (simplest — only your org's users can authorize). Use **External** only if personal Google accounts also need to deploy.
   - App name: `doxie`. Support email + developer contact: your work email.
   - Save and continue. No scopes need to be added at this stage; skip the test-users step.

### 2. OAuth client (Desktop app)

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `doxie`. Create.
3. **Download JSON** from the success dialog (or from the credentials list afterward).
4. Distribute that JSON file to teammates via a password manager or shared drive. Each teammate places it at `~/.config/doxie/oauth-client.json` with `chmod 600`.

> The `client_secret` in a Desktop OAuth client isn't a true secret (it's effectively bundled into every install of the app — Google designed the flow assuming it would leak). Still, treat it as moderately sensitive: don't commit it to public repos.

### 3. Drive folder

1. Create a folder in Drive where deployed docs should land.
2. Copy the folder ID from the URL — it's the long string after `/folders/` in `drive.google.com/drive/folders/<this part>`.
3. Open `.doxie/deploy.json` (scaffolded by `doxie init` with an empty `drive_folder_id`) and paste the ID:
   ```json
   {
     "drive_folder_id": "1AbCdEf...the_real_id",
     "subfolders": {},
     "docs": {}
   }
   ```
4. Commit `.doxie/deploy.json`. From this point, every teammate's clone will deploy into the same folder.

---

## Per-contributor setup (one-time)

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

---

## How `/doxie:deploy` works

Each invocation:

1. **Scans** `doxie-docs/` for `*.md` files (skips `_*.md` template guides and dotfiles).
2. **Hashes** each file's content (sha256) and compares to `.doxie/deploy.json`:
   - **New** docs (no entry) → create a Google Doc in the configured folder.
   - **Changed** docs (hash differs) → update the existing Google Doc *in place* — URL stays stable.
   - **Unchanged** docs → skip, no API call.
   - **Stale** entries (state references a path you've deleted locally) → warn, don't trash the GDoc.
3. **Persists** `.doxie/deploy.json` after every successful upload — Ctrl-C mid-run is recoverable.
4. **Prints** a grouped summary with GDoc URLs for each created/updated doc.

Drive layout mirrors `doxie-docs/`: `feature/*.md` → `feature/` subfolder, `adr/*.md` → `adr/` subfolder. Subfolders are created on first deploy and their IDs cached in `subfolders`.

### Dry run

Preview without making changes:

```
/doxie:deploy --dry-run
```

Same summary format, but no Drive API writes and `.doxie/deploy.json` is not modified.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `OAuth client credentials not found at ~/.config/doxie/oauth-client.json` | You haven't placed the JSON your maintainer shared. See step 1 of per-contributor setup. |
| `Invalid OAuth client JSON. Expected client_id and client_secret fields` | The file isn't a Desktop OAuth client JSON. Re-download from GCP → Credentials → your `doxie` client → Download JSON. |
| `drive_folder_id in .doxie/deploy.json is empty` | The maintainer hasn't filled in the folder ID, or you're on a stale branch. Pull, or do step 3 of project setup. |
| `403: The user does not have sufficient permissions for this file` | The Drive folder isn't shared with you (or you're authed with the wrong Google account). Get edit access or re-consent with the right account. |
| `User's Drive storage quota has been exceeded` | Your personal Drive is full. Free up space, or have the maintainer point `drive_folder_id` at a Shared Drive folder (storage counts against the Shared Drive, not your account). |
| Browser consent flow hangs forever | Port 8765 is in use. Check with `lsof -i :8765` and free it, then re-run. |
| Refresh token revoked (401 on every deploy) | Delete `~/.config/doxie/oauth-token.json` and re-run — first deploy will re-consent. |

---

## File reference

| Path | Purpose | Tracked in git |
|---|---|---|
| `doxie-docs/**/*.md` | Source markdown — what gets published | Yes |
| `.doxie/templates/_*.md` | Format guides used by `/doxie:create` and `/doxie:update` | Yes |
| `.doxie/deploy.json` | `drive_folder_id` + per-doc GDoc mapping | Yes |
| `.doxie/CONTRIBUTING.md` | This file | Yes |
| `.claude/commands/doxie/*.md` | Slash command prompts | Yes |
| `~/.config/doxie/oauth-client.json` | OAuth Desktop client (per-project, shared via password manager) | No — lives in `$HOME` |
| `~/.config/doxie/oauth-token.json` | Your personal refresh token from the consent flow | No — per-user, never shared |
