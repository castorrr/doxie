---
description: Update existing docs in doxie-docs/ when documented behavior has drifted from the code.
---

# /doxie:update

Update one or more existing docs in `doxie-docs/`. Triggered when documented behavior has drifted from the code — not for time-based staleness. Confirms each edit before writing. ADRs are append-only: the only edit allowed to an existing ADR is the `Status:` line; substance changes must go through `/doxie:create` as a new superseding ADR.

## Flow

### 1. Doc selection

List the docs in `doxie-docs/`:

- `overview.md`
- `adr/*.md`
- `feature/*.md`

Exclude any file whose name starts with `_` (those are templates).

If `doxie-docs/` is missing or empty, bail out: tell the user there's nothing to update and suggest `/doxie:create`.

Ask the user which one(s) to update — they can pick a single doc or multiple.

### 2. Gather signals (once, up front)

Before suggesting drift candidates or making edits, collect context. In order from cheapest to most expensive:

1. **Current conversation** — what has been discussed in this session.
2. **Uncommitted working changes** — `git status` and `git diff --stat`.
3. **Recent commits** — `git log -20 --oneline`.
4. **Targeted codebase reads** — only when the above are insufficient. Don't do a full crawl.

If `git` commands fail (not in a repo), continue without that signal.

### 3. Suggest drift candidates (suggestions only)

Using the signals, flag existing docs whose **documented behavior may no longer match the code** — e.g. a feature doc whose subject area has seen code changes that affect how the feature actually behaves, or an ADR whose decision touches code that has since shifted.

The trigger is **behavior drift, not age**: a doc isn't stale just because it's old, only if the code under it has changed in a way that affects what the doc describes.

Surface these as suggestions only: name the doc and the related code path or commit range that triggered the flag. **Do not auto-select or auto-edit anything.** The user picks from the suggestions, picks something else, or skips them.

### 4. Cross-reference check

For each selected doc, grep `doxie-docs/` for references to it (by filename or title) and surface anything that mentions it. Show the user the list and offer to add those referencing docs to the update set so related context doesn't drift.

### 5. Per-doc change gathering

For each selected doc, read the current contents and ask the user what changed or what they want to add. If the same change applies to several docs, the user can describe it once and confirm it covers all of them.

### 6. Draft each edit by doc type

Read the existing doc first; preserve structure where it makes sense. Match the doc type's audience and register precisely.

#### Overview

Audience is a stakeholder, new contributor, or future-you reading this months later. Plain language; describe purpose, users, and where this fits in the broader system. Avoid file paths, class/module names, function signatures, and library names. If you find yourself naming source files, pull back to the behavior they enable.

#### Feature

Audience is a PM, QA tester, or new contributor, not just an engineer staring at the code. Describe what users can do and why it matters, not how it's coded. The `Behavior` section covers user-observable inputs, outputs, and edge cases — not internal implementation. Avoid file paths, class/module names, function signatures, and library names.

#### ADR

ADRs are append-only. The only edit this command will make to an existing ADR is the `Status:` line. If the user wants to change the substance of an ADR (Context, Decision, Consequences, etc.), refuse and direct them to `/doxie:create` to write a new ADR that supersedes the old one.

**Supersession:** if the user is marking an ADR as superseded, update the `Status:` line to `Superseded by ADR-XXXX`. Ask whether the replacement ADR already exists:

- If yes, link it by ADR number and update that ADR's header to note what it supersedes (`Supersedes: ADR-XXXX`).
- If no, offer to run `/doxie:create` next to draft the replacement. Leave a placeholder `Status: Superseded by <pending>` and tell the user to re-run `/doxie:update` once the new ADR exists, so the link can be filled in and the back-reference added.

### 7. Self-check before each write

Before invoking `Write` on any doc, verify:

- No template placeholders remain in the edited content (`<title>`, `NNNN`, `YYYY-MM-DD`, etc.).
- For ADRs, the diff against the existing file touches **only** the `Status:` line — everything else is byte-identical.
- The doc's register matches its type: no file paths, class/module names, or function signatures introduced into an Overview or Feature; no plain-language summary diluting an ADR's technical substance.
- For superseded ADRs, the `Status:` line uses one of the canonical forms: `Superseded by ADR-XXXX` or `Superseded by <pending>`.

If any check fails, fix and re-verify before writing.

### 8. Confirm before write

For each doc, show the proposed change (diff or affected sections) and wait for user confirmation. On confirmation, write the change. If the user declines, skip writing and record as "Skipped (declined)".

### 9. Summary output

After all selected docs are handled, print a summary grouped by outcome. Omit empty groups.

Example:

```
Updated:
  - doxie-docs/feature/streaming-uploads.md
  - doxie-docs/adr/0003-streaming-uploads.md (Status: Superseded by ADR-0007)
Skipped (declined):
  - doxie-docs/overview.md
Skipped (ADR substance change requires /doxie:create):
  - doxie-docs/adr/0002-auth-strategy.md
```

## Notes

- ADRs are append-only. To revise an ADR's substance, write a new ADR via `/doxie:create` with `Supersedes: ADR-XXXX`; this command will refuse to edit anything else in an ADR.
- Drift suggestions are heuristic — surface them with the related path or commit range as reasoning, not as authoritative recommendations.
- The trigger for `/doxie:update` is code-vs-doc mismatch, not freshness. Don't flag docs purely because they haven't been touched in a while.
