# Submission note — Codegeist 2026

> Working document for the Devpost form. Everything in English below is meant to
> be pasted as-is. Status line kept honest: what is measured is measured, what
> is in progress is said to be in progress (`docs/VALIDATIONS.md`).

## Title

**Trapped Tickets** (*Tickets piégés*) — origin, framing and a gate for every
text that enters Jira Service Management.

## Category

**Apps for Business Teams** (customer support, IT).

Bonuses targeted: **Rovo Agents** (primary), **MCP**, **Marketplace**.
Teamwork Graph: not targeted.

## Summary (200 words)

A support portal is open by design: anyone can write into your system. That
text used to be read by humans. It is now read by AI agents acting with the
invoker's rights — and an AI cannot reliably tell the text it is asked to read
from the instruction it is asked to follow. In June 2025 this attack was
demonstrated against Jira Service Management through Atlassian's own MCP
server; in August 2026 two injection paths into Rovo were published. Trapped
Tickets is a Forge app for Jira and Jira Service Management that removes the
attack's three ingredients with three independent locks. Entry:
every segment gets an origin (T0–T3) computed without any model, is examined by
four detection layers, and reaches an AI only framed as data inside random-id
tags. Scope: the app's ten MCP tools and its Careful Reader Rovo agent never
leave the current ticket. Exit: public replies are drafted as internal notes,
checked for other customers' data, and published by a human. An alert exercise
measures what still gets through, before and after. The app reduces risk; it
never promises protection, and every ticket shows what was analysed and what
was not. Nothing leaves Atlassian.

## Long description

### The problem

Support desks gather all three ingredients of a prompt-injection attack: access
to private data, reading of untrusted content, and a channel to the outside.
The attack is documented, not hypothetical: Cato Networks demonstrated it
against Jira Service Management via Atlassian's MCP server (June 2025);
Atlassian published a customer advisory the same month, recommending four
mitigations and stating they are not exhaustive; the Cloud Security Alliance
published two injection paths into Rovo (August 2026), one still open at
publication. Today nothing in a ticket tells the support agent "be careful
before asking for a summary", nothing tells the AI "this is data", and the text
travels: copied into a bug, it will be read tomorrow by a coding agent with a
terminal.

### The approach: three independent locks

Each lock removes one ingredient; any single one holding is enough.

- **Entry.** Every segment (description, comment, field, file name) receives a
  trust level T0–T3 computed without any model, from facts Jira already knows:
  account type, JSM organisation, request channel, email domain, comment
  visibility. External by default; an integration is not a trusted person.
  Four detection layers then examine the text: C1 concealment (invisible
  characters, bidi overrides, background-coloured text, alt text, link/label
  mismatch, encoded blocks — deterministic), C2 addressing an AI (lexicons in
  French and English — deterministic), C3 a hosted model reading the passage
  between random-id tags with a verified answer format (a malformed answer
  means "suspect", never "clean"), C4 context weighting. External text reaches
  an AI only framed as data: `get-request-safe` returns it inside a tag whose
  identifier changes on every call — an attacker cannot close a tag they cannot
  guess. Three modes per project: `report` (default, nothing changes), `label`
  (visible notice prepended), `neutralize` (passage replaced by a mention;
  original kept outside the ticket, security-role only, restorable in one
  click, both gestures logged).
- **Scope.** The app's tools only read the requested ticket — no cross-ticket
  search, no public write. The **Careful Reader** Rovo agent ships with those
  tools alone, plus the `handle-untrusted-request` skill any Rovo agent on the
  site can reuse. A tainted-session mechanism (stretch) marks agent sessions
  that read untrusted content and demands human confirmation for data-exit
  tools until the session ends. On clients with hooks, a generated hooks file
  rewrites what the Atlassian MCP server returned (framed content) and asks for
  confirmation before public writes — covering coding agents that read Jira
  outside the app. Origin is inherited: a bug cloned from a trapped request
  carries its trust level and findings.
- **Exit.** `propose-public-reply` writes an internal note; a human publishes.
  The gate checks replies for other customers' data, unknown URLs, over-long
  queries, encoded blocks, off-topic answers. Replies posted through other
  paths are checked within seconds, after the fact — and the app says plainly
  that the notification email may already be out.

### What is new

- **Origin before detection.** Trust levels need no model and no training: the
  app works even when detection sees nothing, which no text-scanner approach
  can claim.
- **Random-id framing** makes tag-closing forgery useless by construction.
- **The detector is treated as exposed**: no tools, random-id tags, verified
  answer format, malformed = suspect, and C3 can never lift a deterministic
  finding.
- **The alert exercise** turns an unknown ("do our AIs obey what they read?")
  into a measured number, per actor type, before and after — the phishing-drill
  pattern applied to prompt injection, with canary tickets that close
  themselves.
- **Agents as sensors**: `report-suspicion` lets any agent flag an instruction
  it noticed in data instead of silently ignoring it.
- **Honesty as a feature**: every ticket shows what was analysed and what was
  not; the UI says "reduces risk", never "protects".

### Measured results (as of November 11, 2026)

- `forge lint` clean; `forge build` succeeds (build tag
  `1f423769-0297-4bad-ac3f-6b108fb758ca`); app registered
  (`ari:cloud:ecosystem::app/6fb8fafb-3d45-4a47-bcac-f5d1cffe4902`).
- Manifest coherence verified: 23 functions, 10 actions, 1 `rovo:mcp`, 1
  `rovo:agent`, 1 `rovo:skill`, 4 screens, indexed entity property, 4
  webtriggers, SQL, LLM.
- Strict TypeScript, 22 unit tests green without network, size guard (< 500
  lines/file, < 50 lines/function), CI green in under 5 minutes per job on four
  self-hosted workers.
- The pure-domain / platform split means the whole detection chain, framing,
  neutralisation and gate are unit-testable without an Atlassian site.
- In progress: the functional lots (detection layers, modes, gate, exercise,
  screens, MCP implementations) per `docs/LOTS.md`; the nine prototype
  validations of §20 are tracked one by one in `docs/VALIDATIONS.md` and are
  all `to do` until measured on the demo site. The acceptance script (§23, 15
  points) will be run in full before submission.

## Bonuses and proof

| Bonus | Proof in the repository |
|---|---|
| **Rovo Agents** (primary) | `manifest.yml`: `rovo:agent pieges-lecteur-prudent` (system prompt, 4 conversation starters, bound to the 10 actions) and `rovo:skill handle-untrusted-request` (`skills/handle-untrusted-request/SKILL.md`), reusable by any Rovo agent on the site |
| **MCP** | `manifest.yml`: `rovo:mcp pieges-mcp` exposing the ten tools; every read tool is a `GET` action so automation-triggered agents can call it; uniform `{ ok, data \| error, warnings }` envelope (`src/mcp/result.ts`); the hook path additionally covers third-party MCP clients (`src/jobs/webhook.ts`, §11) |
| **Marketplace** | app registered under the ecosystem id above; listing prepared during the final week (December 16–22, 2026, plan §26): scopes limited to the manifest's list, no external service, privacy answer "nothing leaves Atlassian" |

## Links

- Repository: <https://github.com/BaptisteFaisy/tickets-pieges>
- Video (script: `docs/VIDEO.md`; URL added here once the cut is final):
  *to be added*
- Demo site (JSM + Rovo, sample dataset pre-loaded; URL announced at the top of
  `docs/JUDGES.md`): *to be added*
- Judges' guide: `docs/JUDGES.md` (five gestures, under ten minutes)

## What remains before December 22, 2026 (plan §26)

| Week | Objective | Status |
|---|---|---|
| November 11–17 | the nine §20 validations; origin computed at creation; `get-request-safe` | in progress |
| November 18–24 | layers C1, C2, C3; findings; banner; indexed property; sample dataset | planned |
| November 25 – December 1 | `label` and `neutralize` modes; kept originals; suspects queue; verdicts | planned |
| December 2–8 | Careful Reader agent; skill wiring; reply drafts; outbound gate | planned |
| December 9–15 | alert exercise; exposure report; MCP tools; stretch lot if time allows; **feature freeze December 15** | planned |
| December 16–22 | full acceptance run (§23, 15 points); video; judges' instructions finalised; submission; Marketplace filing | planned |

Hard gates before submitting: every §20 validation measured and written in
`docs/VALIDATIONS.md`; the 15-point acceptance run green on a fresh install;
the demo site reachable with the sample dataset loaded; the video under 5:00
with only measured numbers on screen.
