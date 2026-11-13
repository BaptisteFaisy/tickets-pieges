# Tickets piégés — Trapped Tickets

> Every text that enters Jira Service Management from the outside carries its
> origin, is examined on arrival, and reaches an AI only framed as data;
> whatever an AI is about to send back out goes through a gate.

> **Live demo, no install, no account, nothing leaves your browser:**
> <https://tradoooo.github.io/tickets-pieges/> — the app's own code, compiled for
> the browser, in **12 interactive sections**: detector (38 built-in sample requests or
> your own text), what the text hides (decoding, languages, homoglyphs, PDF/OOXML
> extraction), tainted session (signed token, TTL, gesture budget, quarantine),
> outbound gate (DLP, reversible redaction, rate, red team), the ten MCP tools
> (callable in the page), hook configurations generated for five agent clients,
> campaigns & inheritance, alert exercise (canary, lure, hash-chained journal),
> exposure report and 0-100 score, rule precision & tuning, detection bench (corpus,
> per-rule metrics, fuzzing, shadow mode, Cato 2025 scenario), and field measures.
> French/English toggle. See [`docs/SITE.md`](docs/SITE.md).

Atlassian Forge app · Codegeist 2026 · category **Apps for Business Teams**
(customer support, IT). Full specification: [`docs/CAHIER-DES-CHARGES.md`](docs/CAHIER-DES-CHARGES.md)
(French, the working language of this repo). English submission notes:
[`docs/JUDGES.md`](docs/JUDGES.md).

## Why

A support portal is open by design: anyone can write into your system. That
text used to be read by humans. It is now read by AI agents acting with the
rights of whoever invoked them — and an AI cannot reliably tell the text it is
asked to read from the instruction it is asked to follow.

This is not hypothetical:

- **June 2025** — Cato Networks demonstrated the attack against Jira Service
  Management through Atlassian's MCP server: a stranger files a request, a
  support agent asks their assistant for a summary, the hidden instruction runs
  with that agent's rights, and the data comes back into the attacker's ticket.
- **June 2025** — Atlassian published a customer advisory recommending four
  mitigations (least privilege, human review, control of tool sources, logging)
  and stating they are not exhaustive.
- **August 2026** — two injection paths into Rovo were published; one was still
  open at publication time.

A support desk gathers all three ingredients of the attack: access to private
data, reading of untrusted content, and a channel to the outside.

## Three independent locks

Each lock removes one ingredient. Any single one holding is enough.

| Lock | Ingredient removed | How |
|---|---|---|
| **Entry** | untrusted content taken as an instruction | origin, framing, neutralisation |
| **Scope** | the AI reaching data unrelated to the request | tools limited to the current ticket |
| **Exit** | the AI sending data back out | internal draft, outbound gate, human review |

## What the app does

**Origin (no model involved).** Every segment — description, comment, custom
field, file name — gets a trust level from facts Jira already knows: account
type, JSM organisation, request channel, email domain, comment visibility.
`T3` internal, `T2` known partner, `T1` identified external, `T0` anonymous or
machine. External by default: anything not proven internal is treated as
external. An integration is not a trusted person.

**Detection, four layers.** `C1` concealment (invisible characters, bidi
overrides, background-coloured text, image alt text, link/label mismatch, long
encoded blocks), `C2` addressing an AI (imperative turns, role switches, fake
system markers, tool commands, exfiltration URLs — lexicons in French and
English), `C3` a hosted model reading the passage between random-id tags with a
verified answer format, `C4` context weighting. `C1`/`C2` are deterministic and
never overridden by the model.

**Framing.** `get-request-safe` returns the text as data, inside a tag whose
identifier changes on every call — an attacker cannot close a tag they cannot
guess.

**Three modes per project.** `report` (default: nothing changes in the ticket),
`label` (a visible banner is prepended), `neutralize` (the passage is replaced by
a mention; the original is kept outside the ticket, restorable in one click, both
gestures logged).

**Outbound gate.** Public replies on external requests are checked for other
customers' data, unknown URLs, over-long queries, encoded blocks, off-topic
answers. `propose-public-reply` writes an internal note that a human publishes.

**Alert exercise.** The security role plants a harmless, unique canary request.
If the label appears, an AI obeyed what it read. The report gives a number:
"two exercises out of five had an effect" — before and after enabling the locks.

**Hook.** On clients that support hooks, `PostToolUse` replaces what the
Atlassian MCP server returned with the framed version, and `PreToolUse` asks for
confirmation before a public write from a session that read untrusted content.

## What it does not promise

No detection is complete. A well-written payload, with nothing hidden, in a rare
language, will get through. That is why the product does not rest on detection:
origin, framing and the gate work even when detection sees nothing. The UI says
"reduces risk", never "protects", and every ticket shows what was analysed and
what was not.

Nothing leaves Atlassian: analysis uses the model hosted by Forge; no ticket text
is sent to any external service.

## Repository layout

```
manifest.yml            every module: triggers, consumer, actions, rovo:mcp,
                        rovo:agent, rovo:skill, screens, entity properties,
                        webtriggers, sql, llm
src/core/               pure domain — no @forge import, no I/O, fully unit-tested
src/platform/           I/O: Forge SQL, Jira/JSM REST, model, journal, HTTP types
src/jobs/               event handlers, queue consumer, scheduled tasks, hooks
src/mcp/                the ten MCP tools (§16)
src/resolvers/          screen APIs (§17)
src/ui/                 UI Kit 2 screens
src/sample/             built-in sample requests (demo + acceptance)
skills/                 rovo:skill — handle-untrusted-request
tools/                  size guard, manifest validation, replay bench
docs/                   spec, architecture, method, validations, judges, video
```

## Development

```bash
npm ci
node tools/build-site.mjs   # build the public demo site into dist/site/
npm run typecheck     # tsc --noEmit, strict
npm test              # vitest, no network, no Atlassian site needed
npm run limits        # files < 500 lines, functions < 50 lines
npm run manifest      # manifest.yml coherence (modules ↔ functions ↔ resources)
npm run lint          # forge lint   (needs the Forge CLI)
npm run build         # forge build  (needs the Forge CLI)
```

The domain is pure on purpose: the whole detection chain, the framing, the
neutralisation and the outbound gate are tested without a Jira site, using
`src/platform/memory.ts` (an in-memory `Store`) and `src/sample/` (the built-in
dataset). Acceptance script: [`docs/VALIDATIONS.md`](docs/VALIDATIONS.md).

## CI pipeline

Self-hosted runners (`r630-tickets-pieges-0N`, label `tickets-pieges-worker`),
verdict in **under 5 minutes** per job.

| Check | Role |
|---|---|
| `ci` | strict types, domain tests, size guard, manifest validation, doc sanity, CI-guard self-tests |
| `ci-budget` | no job declaring more than 5 minutes |
| `couche0` | every changed file declared in the PR body's `## Scope`, forbidden patterns rejected |

One merge driver only: the **Mergify** queue (`.mergify.yml`, squash, batches of
3). The `pr-auto-merge` sweeper handles what a queue cannot: `DIRTY` pull
requests are rebased and, on a real conflict, handed to the **conflict agent**
(`.github/fireworks/conflict_agent.py`, InferHub `combo/cheap`), with a local
ZeroClaw `hermes` agent as fallback. A red test can be handed to the test agent,
a missing scope declaration to the scope agent. Agents never merge anything:
only a green CI does. Details: [`docs/PIPELINE.md`](docs/PIPELINE.md).

## State of the build

Measured, not claimed (details and commands: [`docs/VALIDATIONS.md`](docs/VALIDATIONS.md)):

- **Deployed and installed**: `forge lint` reports no issue, `forge build` succeeds,
  `forge deploy -e development` is accepted (the platform validates the manifest, not
  just the linter), and `forge install` completed on a Jira/JSM demo site
  (`one-atlas-cndz.atlassian.net`) with all nine declared scopes.
- **572 tests green** across 46 files, offline: no network, no Atlassian site needed.
- **38 sample requests** replayed end to end by the offline bench
  (`node tools/replay.mjs`): the 19 edge cases of the spec, in French and English,
  through origin → C1 → C2 → C4 → findings → suspicion → mode → framing.
- **Every file under 500 lines, every function under 50** (`tools/check_limits.py`),
  and the manifest checked against itself (`tools/validate_manifest.mjs`: 10 MCP tools,
  1 Rovo agent, 1 skill, 4 webtriggers, 5 triggers, 1 queue, 2 scheduled tasks).
- **18 lots merged by the Mergify queue**, one pull request each, no direct push to
  `main` after bootstrap.

Still to be measured on the live site: the nine prototype points of spec §20 and the
acceptance items that need the hosted model, a screen or a Rovo agent (§23.5-23.14).

## Licence

MIT.
