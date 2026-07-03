# Doxie Roadmap

> **North star:** One source of truth, maintained inside the repo, that stays true to the code — that **AI agents and engineers can trust as ground truth**, and that still reaches non-engineers in plain language.

**Status:** POC shipped · roadmap proposed
**Date:** June 13, 2026
**Audience:** the Doxie team + anyone deciding whether to adopt it

---

## TL;DR

Doxie evolves from "a way to publish docs to Google Drive" into **an AI-driven knowledge base for a service** — one engine that serves two readers:

- a **human tier** (high-altitude, published to Drive) — what exists today, and
- a new **AI / technical tier** (deep, implementation-level, lives in the repo) that an AI agent reads as trusted context: runbooks for how to run the service, how it talks to other systems, architecture, and a `.doxie/context.md` map the agent loads first.

It gets there in four phases, each killing a real reason docs fail and unlocking the next:

1. **Trust** — docs you can *believe*. Doxie catches when a code change made a doc wrong and drafts the fix. *(Flagship — designed in full. Matters even more for the AI tier: feeding an agent wrong context is worse than none.)*
2. **Depth & the AI layer** — docs that *cover what matters, for both readers*. The technical tier, AI runbooks, the `.doxie/context.md` entrypoint, plus an auto-index and consistency checks.
3. **Reach** — docs everyone can *find*. A catalog + navigable publishing for humans; the entrypoint *is* the agent's reach.
4. **Intelligence** — *answers, not just docs*. The AI tier graduates from in-repo reads to a queryable, cross-repo knowledge base (MCP).

**Order matters:** you can't let an agent (or a person) act on docs nobody trusts, and shallow docs aren't worth aggregating. So **Trust → Depth → Reach → Intelligence.**

---

## 1. Where Doxie is today

A working proof of concept. For a single repo, an engineer can author docs with Claude and publish them to Google Drive for non-engineers to read.

**Shipped:**

- **`doxie init`** — scaffolds doc templates, slash-command prompts, a contributing guide, and an empty `deploy.json`.
- **`doxie deploy`** — publishes `doxie-docs/` to Drive as Google Docs; hashes content so only changes push, and docs update in place.
- **Four slash commands:** `/doxie:create`, `/doxie:update`, `/doxie:ask`, `/doxie:deploy`.
- **Three doc types**, all deliberately *high-altitude*: Overview, Feature, ADR. The `/create` command explicitly forbids file paths and implementation detail.

**The honest limits today:**

- It only serves **one audience** — non-engineers — and only at high altitude. There's nothing an AI agent or an on-call engineer can use to actually *run* or *reason about* the system.
- Nothing watches the code, so staying current is a manual chore.
- Knowledge is trapped per-repo, and the output is "markdown converted to Google Docs," not a knowledge base.

---

## 2. The reframe: one source of truth, two audiences

This is the core shift. Doxie keeps the human tier and adds an **AI / technical tier** — same authoring/review/publish engine, but a different register, destination, and reader.

| | **Human tier** *(today)* | **AI / Technical tier** *(new)* |
|---|---|---|
| **Reader** | stakeholders, PMs, support, new hires | **AI agents** + engineers |
| **Register** | high-altitude; no code, no file paths | **deep, implementation-level** |
| **Doc types** | Overview, Feature, ADR | **Runbook** (how to run/operate), **System Interactions** (how it talks to other systems), **Architecture**, **Dev Setup**, Troubleshooting |
| **Entry point** | `overview.md` + index | **`.doxie/context.md`** — the agent's map of the service, linking into the deep docs |
| **Lives** | published to **Google Drive** | **in the repo only** — read by agents and engineers where they already are |

Key principles of the new tier:

- **In-repo, not Drive.** The technical tier is documentation that lives *with the code*, not an export. Deploy keeps publishing only the human tier to Drive; the technical tier never leaves the repo.
- **The `.doxie/context.md` entrypoint.** A compact, high-signal map of the service — what it is, how to run it, what it depends on, where the deep docs are. An agent loads this first instead of re-deriving everything from raw source every session. (Optionally surfaced through a root `CLAUDE.md` / `AGENTS.md` so tools auto-discover it.)
- **"AI runbook" = an agent-consumable Runbook doc.** How *we* run the service, how it interacts with other systems — written so an agent can follow it, not just a human.
- **Trust binds the two.** Both tiers run through the same drift detection (Phase 1), so the context an agent trusts is the same source humans read — and both stay honest.

---

## 3. The problem we're really solving

Doc tools fail because of specific, human (and now *agent*) pain points. The roadmap kills them one by one.

| # | The pain | What it feels like | Addressed in |
|---|----------|--------------------|--------------|
| **P1** | **Docs drift silently** | Code changed three times since; the doc is now confidently *wrong*. | Trust |
| **P2** | **Updating is a separate chore** | You finish the code, you're tired, the doc is "later." Later never comes. | Trust |
| **P3** | **No one knows what's missing** | You find the gap mid-incident, or while onboarding someone. | Trust |
| **P4** | **The blank page is daunting** | Starting from scratch is intimidating; nobody's sure of the right altitude. | Depth |
| **P5** | **Quality is uneven** | Some leak code detail, some are too vague, none share a shape. | Depth |
| **P9** | **Every session starts from zero** | An AI agent (or a new engineer) re-derives how the service works from raw code every time — slow, inconsistent, and it misses the *why* and the operational know-how that isn't in the code. | Depth → Intelligence |
| **P10** | **Operational know-how is undocumented** | "How do you run this locally? How does it talk to the payment system?" lives in people's heads and stale READMEs — no human or agent can self-serve it. | Depth |
| **P6** | **Scattered & undiscoverable** | Nobody knows where the *current* truth lives — non-engineers least of all. | Reach |
| **P7** | **Knowledge is tribal** | "Ask the one engineer who knows." When they're on leave, the knowledge is gone. | Intelligence |
| **P8** | **Cross-service questions are brutal** | Real questions span services; answering means hunting across repos and people. | Intelligence |

P9 and P10 are the ones the **AI / technical tier** exists for.

---

## 4. The four-phase arc

```
  Phase 1            Phase 2                  Phase 3            Phase 4
  TRUST       →      DEPTH & AI LAYER   →     REACH       →      INTELLIGENCE
  believe it         cover it (both tiers)    find it            ask it

  P1 P2 P3           P4 P5 P9 P10             P6                 P7 P8 (+P9)
```

Every phase now carries **both tiers**. Phase 2 is the headline expansion, because that's where the AI/technical tier is born. The rest of this doc designs **Phase 1 in full** and sketches the later phases at the level needed to commit to the direction.

---

## 5. Phase 1 — Trust *(the flagship)*

> **Goal:** A doc is never silently wrong — for a human *or* an agent. The moment a code change makes a doc inaccurate, Doxie tells you and offers to fix it.

This is the highest-leverage phase, and the new vision raises its stakes: **an AI agent will act on these docs.** Wrong context isn't just unhelpful, it's actively dangerous. Trust has to come first.

Today's `/doxie:update` is reactive and manual — you must remember to run it *and* already know which docs your change affected. Phase 1 flips that: the change itself is the trigger.

### Two surfaces, one idea

**1. `doxie check` — the fast signal (new CLI command)**

Non-interactive. Answers: *"Did my changes break a doc, or leave something undocumented?"*

- **Input:** uncommitted + staged work by default; `--since <ref>` for a commit range; `--all` for a full audit.
- **Does:** reads changed files from git, compares against the doc corpus, and reports **Drift** (docs whose subject area changed) and **Gaps** (meaningful new code with no doc). Exits non-zero when found.
- **Why:** dependency-free, no AI key, milliseconds — so a team can later drop it into a pre-push hook or CI with zero new infra. It only nudges; it never writes.

**2. `/doxie:review` — the smart fix (new slash command)**

Brings Claude's judgment and drafts the edits.

- **Input:** a diff scope — uncommitted, a commit range, a PR, or "what we just discussed."
- **Flow:** gather the diff → inventory docs → for each, judge whether the change alters **the behavior the doc describes** (not just whether a related file moved) → draft edits respecting each type's rules (ADRs stay append-only) → suggest `/doxie:create` for coverage gaps → confirm each edit before writing.

**How they relate:** `doxie check` is the *detector you can automate*; `/doxie:review` is the *fixer with a brain*. Everyday loop: `doxie check` flags drift → `/doxie:review` drafts fixes → commit docs with code → `/doxie:deploy` (human tier).

### Code↔doc linkage — and why it's *natural* for the AI tier

Today a doc has no machine-readable tie to the code it describes, so v1 *infers* the link. The upgrade lets a doc declare what it covers:

```
covers:
  - src/checkout/**
  - src/payments/stripe.ts
```

This is **especially natural for the technical tier**: a Runbook or System-Interactions doc maps almost one-to-one to specific code, commands, and config — so drift detection there is precise and high-value (an out-of-date "how to run it" is exactly the kind of wrong an agent must never inherit).

**Decision:** linkage in doc front-matter (strip on deploy) vs. a sidecar `.doxie/coverage.json`. *Recommend the sidecar* — keeps published human docs clean.

### Bonus, nearly free: `doxie status`

`deploy.json` already records `content_hash` + `last_deployed_at` per doc. Combine with git + linkage for a one-glance health view per doc: **Fresh / Drifting / Orphaned / Undeployed.**

### End-to-end flow

```
   code change
        │
        ▼
   doxie check ─────────► Drift?  Gaps?  (exit ≠ 0 if so)
        │  (git diff + linkage, both tiers)
        ▼
   /doxie:review ───────► Claude drafts the doc edits
        │  (confirm each)
        ▼
   write + commit docs ──► /doxie:deploy (human tier → Drive)
                           technical tier stays in-repo for agents
```

### Phase 1 features

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| A1 | `/doxie:review` — diff-driven, drafts doc edits (both tiers) | ★★★ | M |
| A2 | `doxie check` — drift + gap report, exit code | ★★★ | M |
| A3 | Code↔doc linkage (inference v1, `covers:` upgrade) | ★★ | S–M |
| A4 | `doxie status` — doc-health view | ★★ | S |
| A5 | *(opt-in)* pre-push / CI recipe wrapping `doxie check` | ★ | S |

---

## 6. Phase 2 — Depth & the AI layer *(the headline expansion)*

> **Goal:** Doxie covers what *both* readers need — non-engineers in plain language, and AI agents + engineers in deep, current, trustworthy technical docs.

Kills **P4** (blank page), **P5** (uneven quality), **P9** (re-deriving from zero), **P10** (undocumented operational know-how).

This is where the AI/technical tier is born.

- **D1 — Technical doc tier + register.** New templates with their *own* rules (these *do* include implementation detail): **Runbook**, **System Interactions**, **Architecture**, **Dev Setup**, **Troubleshooting**. Lives in the repo, never deployed to Drive.
- **D2 — `.doxie/context.md` AI entrypoint.** Doxie generates and *maintains* a compact map of the service — what it is, how to run it, what it depends on, and links into the deep docs. The agent loads this first. AI-generated (not just heuristic), kept current by Phase 1 drift detection, optionally surfaced via `CLAUDE.md` / `AGENTS.md`.
- **D3 — AI-runbook format.** A Runbook written to be *agent-consumable*: ordered, concrete steps for running the service and exercising its integrations — something an agent can follow, not just read.
- **B2 — Auto-generated index.** A live, categorized list of every doc (per tier) with one-line summaries. Backbone for Phase 3.
- **B4 — `doxie lint`.** Enforce each tier's register rules — human docs stay high-altitude, technical docs stay complete and current, no leftover placeholders, ADR immutability respected.
- **B5 — Dynamic doc-type registry.** Register doc types + their tier/register via a manifest instead of hardcoding — this is what makes adding D1's types (and your own) clean.

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| D2 | `.doxie/context.md` AI entrypoint (generated + maintained) | ★★★ | M |
| D1 | Technical doc tier + register (runbook / system-interactions / architecture / dev-setup) | ★★★ | M |
| B2 | Auto-generated index (per tier) | ★★★ | S–M |
| D3 | AI-runbook format (agent-consumable) | ★★ | S–M |
| B4 | `doxie lint` (per-tier register enforcement) | ★★ | M |
| B5 | Dynamic doc-type registry | ★★ | S |

---

## 7. Phase 3 — Reach

> **Goal:** Anyone — engineer, agent, or non-engineer — can find the current docs for any service in one place.

Kills **P6** (scattered, undiscoverable docs).

- **C2 — Central catalog.** An org-level index of every Doxie-enabled repo and its docs (both tiers). The foundation for Phase 4.
- **C3 — Navigable publishing.** Human tier: an org root index + per-service landing page in Drive, not a flat folder. AI tier: the `.doxie/context.md` entrypoint *is* the agent's reach — and the catalog tells an agent which other services' context maps exist.

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| C2 | Central catalog / registry (both tiers) | ★★★ | M |
| C3 | Navigable publishing (Drive portal + entrypoint discovery) | ★★ | M |

---

## 8. Phase 4 — Intelligence

> **Goal:** People and agents ask in plain language and get cited answers from the whole org's docs — no repo-hopping, no shoulder-tapping. The AI tier graduates from per-repo reads to an org-wide queryable knowledge base.

Kills **P7** (tribal knowledge), **P8** (cross-service questions), and finishes **P9** (an agent never starts from zero — for *any* service).

This is the **"grow" step** of the layered consumption model you chose: in-repo reads → a queryable source.

- **C6 — Doxie MCP server.** Expose the corpus — technical docs + every service's `.doxie/context.md` — as a tool an agent can query across repos ("get the runbook for service X," "how does checkout talk to billing?"). This is what turns Doxie into the AI's cross-repo reference.
- **C1 — Cross-repo `/ask`.** Answer questions across every catalogued service.
- **C5 — Semantic search** over the aggregated corpus, powering both the MCP server and self-serve.
- **C4 — Non-engineer self-serve Q&A** (Slack / web) over the human tier.

| ID | Feature | Impact | Effort |
|----|---------|--------|--------|
| C6 | Doxie MCP server (queryable knowledge base) | ★★★ | L |
| C1 | Cross-repo `/ask` | ★★★ | L |
| C5 | Semantic search over corpus | ★★ | L |
| C4 | Non-engineer self-serve Q&A | ★★ | L |

---

## 9. Why this sequence

- **Trust before everything.** An agent acting on wrong context is worse than an agent with none. Accuracy first.
- **Depth before Reach.** The AI/technical tier and the `.doxie/context.md` map are what make Doxie worth aggregating. Build the substance, then make it discoverable.
- **Reach before Intelligence.** A cross-repo query (and the MCP server) needs a catalog to draw from. Phase 3 is literally the input to Phase 4.
- **Effort climbs.** Phases 1–2 are prompt files, small CLI commands, and templates — Doxie's existing low-infrastructure style. Phases 3–4 add shared/hosted pieces and should only start once the per-repo experience is genuinely good.

---

## 10. How we'll know it's working

| Phase | The signal that it worked |
|-------|---------------------------|
| Trust | Engineers run `/doxie:review` as part of shipping; "the doc was wrong" stops happening — for humans *and* for agents acting on the technical tier. |
| Depth & AI layer | An agent (or new hire) can run the service and understand its integrations straight from `.doxie/context.md` + the runbooks — without reverse-engineering the codebase or asking a person. |
| Reach | A non-engineer finds the right doc themselves; an agent discovers other services' context maps via the catalog. |
| Intelligence | A cross-service question gets a correct, cited answer in seconds, and onboarding stops depending on any one person. |

---

## 11. Open decisions

1. **Repo layout for the two tiers** — how the technical tier sits next to the human tier (e.g. `doxie-docs/` human vs. a separate technical folder), and how `deploy` knows which tier to publish (a tier flag in the doc-type registry, or a publish-list in `deploy.json`).
2. **What generates `.doxie/context.md`** — `doxie init` heuristic stub vs. a dedicated AI command (e.g. `/doxie:map`) vs. a mode of `/doxie:create`; and how it's kept current by drift detection.
3. **Relationship to `CLAUDE.md` / `AGENTS.md`** — is `.doxie/context.md` the canonical map that those files point to, or does Doxie write into them directly?
4. **Linkage storage** — `covers:` front-matter (strip on deploy) vs. sidecar `.doxie/coverage.json`. *(Recommend sidecar.)*
5. **`/review` vs `/update`** — keep both (review = from a code change, update = ad-hoc edit), or fold update's drift step into review?
6. **Catalog & MCP substrate (Phases 3–4)** — Drive root manifest vs. a dedicated index repo; how the MCP server is hosted. Defer until Phase 2 lands.

---

## Appendix — full feature index

| ID | Feature | Phase | Tier | Impact | Effort |
|----|---------|-------|------|--------|--------|
| A1 | `/doxie:review` (diff-driven edits) | Trust | both | ★★★ | M |
| A2 | `doxie check` (drift + gap CLI) | Trust | both | ★★★ | M |
| A3 | Code↔doc linkage | Trust | both | ★★ | S–M |
| A4 | `doxie status` (health view) | Trust | both | ★★ | S |
| A5 | Pre-push / CI recipe (opt-in) | Trust | both | ★ | S |
| D2 | `.doxie/context.md` AI entrypoint | Depth | AI/tech | ★★★ | M |
| D1 | Technical doc tier + register | Depth | AI/tech | ★★★ | M |
| B2 | Auto-generated index | Depth | both | ★★★ | S–M |
| D3 | AI-runbook format | Depth | AI/tech | ★★ | S–M |
| B4 | `doxie lint` (per-tier rules) | Depth | both | ★★ | M |
| B5 | Dynamic doc-type registry | Depth | both | ★★ | S |
| C2 | Central catalog | Reach | both | ★★★ | M |
| C3 | Navigable publishing | Reach | both | ★★ | M |
| C6 | Doxie MCP server (queryable KB) | Intelligence | AI/tech | ★★★ | L |
| C1 | Cross-repo `/ask` | Intelligence | both | ★★★ | L |
| C5 | Semantic search | Intelligence | both | ★★ | L |
| C4 | Non-engineer self-serve Q&A | Intelligence | human | ★★ | L |

*Impact: ★ low → ★★★ high. Effort: S small · M medium · L large. Tier: human · AI/tech · both.*
