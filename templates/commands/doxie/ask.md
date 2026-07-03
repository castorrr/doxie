---
description: Answers questions about the service from Overview, Feature, and ADR docs in doxie-docs/.
---

# /doxie:ask

Answer a question about the service using the docs in `doxie-docs/`. Answer **only from what's documented**, at the altitude the docs themselves work at — high-level, not implementation details.

## Docs you'll be working with

`doxie-docs/` contains three kinds of docs. Each answers a different shape of question:

- **`overview.md`** — service-level: what the service does, who depends on it, where it fits. Answers _"what is this?"_, _"who uses this?"_, _"what's it for?"_
- **`adr/*.md`** — Architecture Decision Records. Each captures one decision: its Background, Rationale, Decision, and Expected Drawbacks. Has a `**Status:**` line (e.g. `Proposed` / `Accepted` / `Superseded by ADR-XXXX`, often with an emoji prefix). Answers _"why did we do X?"_, _"what trade-offs did we accept?"_
- **`feature/*.md`** — feature overviews from the user's perspective: what the feature is, what users can do, how it behaves. Answers _"what can users do?"_, _"how does feature X behave?"_

All three describe the service at a high level. They are **not** implementation docs — they don't cover libraries, code paths, schemas, or wiring. For those, the user should read the source.

## Flow

1. **Get the question.** If the user hasn't provided one, ask.

2. **Read `doxie-docs/overview.md` first** to ground yourself. Skip if the file doesn't exist — it's created on demand by `/doxie:create`, not scaffolded by `doxie init`.

3. **Find relevant docs.** Based on the question's shape, look in the matching doc type first:
   - _"What is the service / who uses it / what's its scope?"_ → `overview.md` (skip if it doesn't exist; fall through to Step 6)
   - _"Why did we choose X?"_ → `adr/`
   - _"What is feature X / what can users do / how does feature X behave?"_ → `feature/`

   If the question spans more than one doc type, draw from each. Then Grep `doxie-docs/` for keywords from the question to catch anything in other doc types. Read matching files in full. (Templates live in `.doxie/templates/`, not `doxie-docs/`, so you won't encounter `_template.md` files here.)

4. **Handle ADR status.**
   - Prefer `Accepted` ADRs as the source of truth.
   - If a `Superseded` ADR is relevant, include it only as historical context and label it explicitly as superseded.
   - If a relevant ADR is `Proposed`, surface it as a decision still under consideration — don't present its Decision as if it's settled.
   - If multiple `Accepted` ADRs appear to disagree, surface the conflict to the user instead of silently picking one.

5. **Answer.**
   - Use only what's documented. Don't fill in from general knowledge or by reading the project's source code.
   - Stay at the docs' altitude — what / who / why / what-users-can-do — not how-it's-implemented.
   - Cite the source file path inline for each claim, e.g. _(per `doxie-docs/adr/0007-async-processing.md`)_.
   - Don't dump full doc contents; stay focused on the question.

6. **If the docs don't cover the question:**
   - If `doxie-docs/` is effectively empty (no `overview.md`, and `adr/` / `feature/` are missing or empty), say so explicitly and recommend `/doxie:create` as the first step — there's no corpus to answer from yet.
   - Otherwise, say the docs don't cover it. Don't guess.
   - Name the gap concretely (e.g. _"no ADR covers how billing was scoped, and no feature doc covers refunds"_).
   - Suggest running `/doxie:create` to add the missing doc.
   - If the question is implementation-level (_"which library does X"_, _"how does the cache invalidate"_), say so and point the user to the source code instead — those are out of scope for these docs.

## Examples

**Q: "What does this service do?"**
Read `overview.md` and summarize at its level — what the service is responsible for, who depends on it, where it fits. Cite the file.

**Q: "Why did we move processing off the request path?"**
Head to `doxie-docs/adr/`. Grep for "async", "processing", "background". Read the matching ADRs and cite Background, Rationale, Decision, and Expected Drawbacks. If a related ADR is Superseded, mention it only as history.

**Q: "What can users do during onboarding?"**
Head to `doxie-docs/feature/`. Grep for "onboarding". If `feature/onboarding.md` exists, summarize the user-visible behavior described there and cite the file. If nothing covers it, say there's no feature doc and suggest `/doxie:create`.

**Q: "What ORM are we using?"** (out of scope)
This is implementation-level — `doxie-docs/` describes the service at a higher altitude. Say: _"That's an implementation detail not covered by `doxie-docs/` — check the source code or package manifest."_ Don't answer from docs.

## Constraints

- Strict to docs. If you're answering from general knowledge or source code, stop and surface the gap.
- Stay at high altitude — overview, decisions, user-visible behavior — not implementation specifics.
- Always cite file paths so the reader can verify.
