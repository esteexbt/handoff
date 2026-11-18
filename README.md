<p align="center"><img src="docs/proof.png" alt="Handoff proof page" width="820"></p>

# Handoff

**Design handoff your coding agent has to prove.**

A designer writes what must be true in plain English. A coding agent builds it. Then the agent says "done", and someone has to click through and find the email field that accepts `ada@example` or the yearly price that forgot the discount.

Handoff removes that someone. Every check in `handoff.md` is run in a real Chrome browser by [Kane CLI](https://www.testmuai.com/kane-cli/). When Kane catches a failure, Handoff turns what Kane saw into a precise brief, hands it back to the agent, and makes Kane check again, until the spec is green. Then it publishes a **proof page** a designer, PM or client can actually read.

```
handoff.md  ──▶  Claude Code builds  ──▶  Kane CLI checks in a real browser
     ▲                                              │
     └────────── fix brief (what Kane saw) ◀────────┘  until every check passes
```

## Why it's different

- **The spec is the designer's, not the test engineer's.** Checks read like acceptance criteria: *Click "Yearly" and verify the Grow plan shows "$48" per year.* No selectors, no test code.
- **Kane's verdict closes the loop, not a human.** Two ways in:
  - **Claude Code Stop hook.** Every time Claude says it's done, Kane verifies. A failure blocks the stop (exit 2), and Kane's findings become Claude's next instruction. Unchanged builds are skipped, so you don't burn credits.
  - **`handoff loop`.** Headless: verify, brief Claude Code (`claude -p`), re-verify the failures, then a final regression sweep of every check.
- **"Fix the app, not the check."** The brief carries the brand rules from the spec and forbids weakening checks. Kane environment errors (exit 2) are never blamed on the code.
- **Proof, not logs.** `.handoff/proof.html`: the designer's words, Kane's evidence, the loop round by round, the brand, and a run history. Plus `badge.svg` for your README.

## Quick start

```bash
npm install -g @testmuai/kane-cli && kane-cli login
npm install -g github:esteexbt/handoff      # or: git clone … && npm link

cd your-app
handoff init --url http://localhost:3000    # creates handoff.md + installs the Claude Code Stop hook
handoff verify                              # every check, real browser
handoff loop                                # let Claude Code fix what Kane catches
```

Try the demo. Its first-pass build has two realistic bugs planted in it, the kind agents leave every day: email validation that only checks for `@`, and a yearly price that forgot the discount.

```bash
cd examples/sprout
handoff verify      # Kane catches 2 of 5 failing
handoff loop --open # Claude Code fixes them, Kane proves it, the proof page opens
```

## handoff.md

```markdown
---
name: Sprout
url: http://localhost:4173
start: node server.js          # optional, Handoff starts the app if it's down
---

# Sprout
Context for the agent: what this is, who it's for.

## Brand
- Sprout green: #1F6F4A
- Voice: calm and short. No exclamation marks.

## Checks
- join-waitlist: Enter "ada@example.com" in the email field, click "Join the waitlist", and verify the page shows "You're on the list"
- yearly-pricing [/pricing]: Click "Yearly" and verify the Grow plan shows "$48" per year
```

Each check becomes one `kane-cli run --agent --headless "<check>" --url <url>`. `[/path]` starts a check on another page.

## Commands

| Command | What it does |
|---|---|
| `handoff init` | Creates `handoff.md`, adds the Stop hook to `.claude/settings.json` |
| `handoff verify [--only a,b] [--headed]` | Runs checks through Kane CLI. Exits non-zero on failure (CI-friendly) |
| `handoff loop [--max 3] [--open]` | Verify, brief the agent, fix, re-verify, until green |
| `handoff proof` | Rebuild and open the proof page |
| `handoff brief` | Print the exact brief the agent receives for the last failures |
| `handoff doctor` | Checks kane-cli, Claude Code, the spec and the app |

`--headed` shows the real browser, which is great for demos.

## How the loop talks

| Kane CLI exit | Meaning | Handoff does |
|---|---|---|
| `0` | passed | records evidence |
| `1` | assertion failed | briefs the agent with Kane's summary, final page state and last steps |
| `2` | environment error | reports it, never asks the agent to "fix" code that isn't broken |
| `3` | timeout | treated as a failure to fix |

The Stop hook allows 3 attempts per Claude session (`HANDOFF_MAX_ATTEMPTS`) and then hands control back to you, so it never loops forever.

## Under the hood

Zero dependencies, Node 18+, works on Windows, macOS and Linux. On Windows, npm's `.cmd` shims are resolved to their real entry points, so plain-English checks full of quotes reach Kane intact. `npm test` runs the full loop against test doubles.

---

Built for the [Kane CLI Hackathon](https://kaneclihack.sh) with Claude Code. Design by Estee ([@esteexbt](https://x.com/esteexbt)). MIT.
