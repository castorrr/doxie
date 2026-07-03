---
description: Draft a new Overview, Feature, or ADR doc from repo signals.
---

# /doxie:create

Create one or more docs in `doxie-docs/`. Supports Overview, Feature, and ADR doc types. Infers candidate content from the repository state, prompts the user to confirm each draft, and auto-fills metadata. Never clobbers an existing doc.

## Flow

### 1. Doc type selection

Ask the user which doc types they want to create. Offer Overview, Feature, and ADR as a multi-select. The user may pick one or more.

If the user selects nothing, exit politely: tell them to re-run `/doxie:create` when ready.

Process types in this fixed order, even when multi-selected: **Overview → Feature → ADR**. Overview is processed first because the other docs may reference it.

### 2. Gather signals (once, up front)

Before handling any individual doc type, collect context. In order from cheapest to most expensive:

1. **Current conversation** — what has been discussed in this session.
2. **Uncommitted working changes** — `git status` and `git diff --stat`.
3. **Recent commits** — `git log -20 --oneline`.
4. **Targeted codebase reads** — only when the above are insufficient. Don't do a full crawl.

If `git` commands fail (not in a repo), continue without that signal.

Bail out if `.doxie/templates/` is missing: tell the user to run `doxie init` first — that's where the templates live. `doxie-docs/` itself may not exist yet; that's expected (it's created on demand when the first doc is written), so don't treat its absence as an error.

### 3. Per-type handling (sequential, confirm each)

#### Overview

1. Check whether `doxie-docs/overview.md` exists.
2. If it exists, skip: tell the user the overview already exists and suggest `/doxie:update`.
3. Otherwise, read `.doxie/templates/_overview_template.md` as a format guide. If the template is missing, tell the user the scaffold is incomplete and suggest `doxie init --force`. Draft an overview from the signals: the service name (H1), a 2–3 sentence summary, an `About the Service` section, and a `Features` list. Auto-fill `Date Created:` and `Date Updated:` in the footer with today's date in `Month DD, YYYY` format. Ask the user which team maintains this service and fill the `Maintained By:` field with their answer. Ask one or two additional targeted follow-ups only if a key piece is genuinely missing.

   **Write at a high level.** The audience is a stakeholder, new contributor, or future-you reading this months later — not someone reviewing code. Use plain language; describe purpose, users, and where this fits in the broader system. Avoid file paths, class/module names, function signatures, library names, and other implementation details. If you find yourself naming source files, pull back to the behavior they enable.
4. Show the draft. On user confirmation, write to `doxie-docs/overview.md`.
5. If the user declines, skip writing and surface as "Skipped (declined)" in the final summary.

#### Feature

1. From signals, infer one to three candidate features. Look for recent `feat:`-style commits, new modules or endpoints, and what the conversation has been about.
2. Present the candidates. Example: *"It looks like you recently added `streaming uploads` — is that what you want to document, or did you have a different feature in mind?"*
3. If no plausible candidates surface, don't guess — ask the user to describe the feature in their own words.
4. Once the user confirms a feature title, derive a kebab-case slug (lowercase, hyphen-separated, no punctuation).
5. Check `doxie-docs/feature/<slug>.md`:
   - **Exists** → skip, tell the user, suggest `/doxie:update`.
   - **Doesn't exist** → read `.doxie/templates/_feature_template.md` as a format guide. If the template is missing, tell the user the scaffold is incomplete and suggest `doxie init --force`. Draft `Overview` and `Behavior and Limitations` from the inferred details. Auto-fill `Date Created:` and `Date Updated:` in the footer with today's date in `Month DD, YYYY` format. Ask targeted follow-ups only where genuinely needed.

     **Write at a high level.** The doc should be readable by a product manager, QA tester, or new contributor — not just an engineer staring at the code. Describe what users can do and why it matters, not how it's coded. `Behavior and Limitations` covers user-observable inputs, outputs, edge cases, and known limitations — not internal implementation. Avoid file paths, class/module names, function signatures, and library names.
6. Show the draft. On user confirmation, write to `doxie-docs/feature/<slug>.md`.
7. If the user declines, skip writing and surface as "Skipped (declined)".

#### ADR

1. From signals, infer one to three candidate decisions. Look for commits like "switch to …", conversation about a tradeoff, or config changes that imply a choice.
2. Present the candidates. If none surface, ask the user to describe the decision themselves.
3. List `doxie-docs/adr/*.md`, excluding any file whose name starts with `_` (those are templates). The next ADR number is the largest existing four-digit prefix plus one, zero-padded. If no ADRs exist, start at `0001`.
4. Read `.doxie/templates/_adr_template.md` as a format guide. If the template is missing, tell the user the scaffold is incomplete and suggest `doxie init --force`.
5. Draft `Background`, `Rationale`, `Decision`, `Expected Drawbacks` from the signals plus one or two follow-ups if needed. Auto-fill `Date Created:` and `Date Updated:` in the footer with today's date in `Month DD, YYYY` format. Set `**Status:**` to `🟡 Proposed`. Ask the user for impact level and set `**Impact:**` to the matching value (`🟢 Low`, `🟡 Medium`, or `🔴 High`); default to `🟡 Medium` if the user is unsure. If the user indicates this supersedes a prior ADR, add a `Supersedes: ADR-XXXX` line directly below `**Impact:**`.

   **Write as a hybrid of plain-language framing and technical substance.** `Background` frames the problem in product or business terms — anyone on the team should grasp why this matters before reading the technical details. `Rationale` explains in one tight paragraph how the team arrived at the chosen option: the criteria, the contenders, and the deciding factor. `Decision` is understandable at the top line by a non-technical reader, with technical specifics only where they sharpen the choice (e.g., "Postgres for relational guarantees and JSONB; MySQL was a near-miss but lacks JSONB indexing"). `Expected Drawbacks` notes concrete trade-offs — latency, scaling limits, API surface changes, operational burden — without naming files, functions, or line-level specifics.
6. Derive a kebab-case slug from the decision title.
7. Show the draft. On user confirmation, write to `doxie-docs/adr/<NNNN>-<slug>.md`.
8. ADRs are append-only — never skip due to topic overlap.
9. If the user declines, skip writing and surface as "Skipped (declined)".

### 4. Self-check before each write

Before invoking `Write` on any doc, verify:

- `Date Created:` and `Date Updated:` in the footer are today's date in `Month DD, YYYY` format.
- Slug is kebab-case, lowercase, no spaces or punctuation.
- The target file path doesn't already exist — re-check the file system as the source of truth, not the earlier listing.
- No template placeholders remain in the output: no stray `<Service Name>`, `<Feature Title>`, `<Title>`, `<team>`, `<Month DD, YYYY>`, `NNNN`, etc.

If any check fails, fix and re-verify before writing.

### 5. Summary output

After all selected doc types are handled, print a summary grouped by outcome. Omit empty groups.

Example:

```
Created:
  - doxie-docs/feature/streaming-uploads.md
  - doxie-docs/adr/0003-streaming-uploads.md
Skipped (already exists, run /doxie:update):
  - doxie-docs/overview.md
Skipped (declined):
  - (none)
```

## Notes

- No template engine is used — `_<name>_template.md` files are format guides that Claude reads and fills directly.
- ADRs are immutable. To override an old ADR, write a new one with `Supersedes: ADR-XXXX` and update the old ADR's `**Status:**` line to `⚪ Superseded by ADR-XXXX` (the only edit allowed to an existing ADR).
