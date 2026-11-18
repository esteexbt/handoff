<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/handoff-brand/01-logo/horizontal/png/handoff-horizontal-color-dark-1200w.png">
    <img src="docs/handoff-brand/01-logo/horizontal/png/handoff-horizontal-color-1200w.png" alt="handoff" width="300">
  </picture>
</p>

<p align="center"><b>Your AI agent says "done". Handoff makes it prove it.</b></p>

<p align="center"><a href="https://handoffcli.vercel.app">Website</a> · <a href="https://handoffcli.vercel.app/proof/">Live proof page</a> · <a href="#quick-start">Quick start</a></p>

<p align="center"><img src="docs/proof.png" alt="Handoff proof page: Sprout verified 6/6 by Kane CLI" width="860"></p>


A designer writes what must be true in plain English. A coding agent builds it and says "done". Then someone has to click through it and find that the email field accepts `ada@example`, or that the yearly price forgot the discount.

Handoff removes that someone. Every check in `handoff.md` runs in a real Chrome browser through [Kane CLI](https://www.testmuai.com/kane-cli/). When Kane catches a failure, Handoff turns what Kane saw into a precise brief and hands it back to the coding agent. Then it makes Kane check again, until the spec is green. Finally it publishes a **proof page** that a designer, PM or client can actually read.

```
handoff.md ──▶ Claude Code builds ──▶ Kane CLI checks in a real browser
     ▲                                          │
     └──── fix brief: what Kane saw ◀───────────┘   until every check passes
```

## What a real run looks like

Straight from the recorded demo run in `examples/sprout`: real Kane CLI, real Claude Code, on Windows. The full run log is committed in [`examples/sprout/.handoff/runs/`](examples/sprout/.handoff/runs/).

```
── Round 1 · Kane CLI verifies the build ─────────────────────────────
  [2/6] reject-bad-email Enter "ada@example" in the email field, click "Join the waitlist", and verify a…
      ✖ FAIL 1m 31s  The waitlist accepted the malformed address ada@example and displayed a success message…
  [3/6] yearly-pricing Scroll to the "Simple pricing" section, click the button labelled "Yearly", the…
      ◉ scroll: Scrolling to the Simple pricing section
      ◉ click: Clicking the Yearly button in the Simple pricing billing period section
      ✖ FAIL 1m 32s  The Grow plan shows $60 per year after Yearly is selected, not the required $48.
── Agent · fixing 3 failing checks ───────────────────────────────────
      ◆ read public/app.js
      ◆ edit public/app.js
      ◆ agent: I made the email check stricter and set the Grow plan's yearly price to $48;
               I left the FAQ alone because the student-discount question already works…
── Round 2 · Kane CLI re-checks what failed ──────────────────────────
      ✔ PASS 1m 40s  submitted an invalid email to the waitlist on localhost
      ✔ PASS 1m 16s  selected yearly pricing on the Simple pricing page
      ✔ PASS 1m 0s   revealed the student discount answer on the site
── Regression sweep · every check, one more time ─────────────────────
  6 passed of 6

  ✔ Verified. 6/6 checks pass in a real browser after 1 agent fix round.
```

The third failure, `student-faq`, was Kane failing to click the question (`agent_error`), not a bug. Claude Code checked the code, said so, and left it alone, and Kane's re-check confirmed it.

And inside an interactive Claude Code session, Claude isn't allowed to finish until Kane agrees:

```
Stop says: Handoff ✔ 6/6 checks verified in a real browser by Kane CLI — proof: .handoff/proof.html
```

## Why it's different

- **The spec belongs to the designer, not the test engineer.** Checks read like acceptance criteria: *Click "Yearly" and verify the Grow plan shows "$48" per year.* There are no selectors and no test code.
- **Kane's verdict closes the loop, not a human.** There are two ways in:
  - **Claude Code Stop hook.** Every time Claude says it's done, Kane verifies. A failure blocks the stop (exit 2), and Kane's findings become Claude's next instruction. Fail-fast: new and failing checks run first. Builds that haven't changed are skipped, so no credits are wasted.
  - **`handoff loop`.** This runs headless: verify, brief Claude Code (`claude -p`), re-verify what failed, then do a regression sweep of every check.
- **Handoff reads Kane's own judgement before blaming anyone.** Kane reports *why* a run failed, and Handoff acts on it:

  | Kane says | Handoff does |
  |---|---|
  | The app is wrong (`objective_contradiction`, a value mismatch) | Briefs the agent with the evidence: *Kane read "$60", the spec expects "$48"* |
  | Its own automation slipped (`automation_bug · agent_misstep`, or `agent_error` when it couldn't act) | Re-runs the check before anyone touches the code |
  | The platform failed (`environment_issue · infra_error.screenshot_failed`) | Re-runs, then reports it as an environment problem and **never** asks the agent to "fix" working code |

- **Fix the app, not the check.** The brief carries the spec's brand rules and forbids weakening checks.
- **Proof, not logs.** `.handoff/proof.html` shows the designer's words, Kane's evidence and readouts, a link to every Kane run report, the loop round by round, the brand, and the run history. You also get a `badge.svg` for your README.

## Requirements

- **Node.js 18+**
- **Kane CLI** and a free [TestMu AI](https://www.testmuai.com/kane-cli/) account: `npm install -g @testmuai/kane-cli`, then `kane-cli login`
- **Google Chrome**, because Kane drives a real Chrome browser
- **Claude Code** (`claude`) for `handoff loop` and the Stop hook: `npm install -g @anthropic-ai/claude-code`

## Quick start

```bash
npm install -g @testmuai/kane-cli && kane-cli login
npm install -g github:esteexbt/handoff        # or: git clone … && npm link

cd your-app
handoff init --url http://localhost:3000      # creates handoff.md + installs the Claude Code Stop hook
handoff verify                                # every check, real browser
handoff loop --open                           # let Claude Code fix what Kane catches
```

The Stop hook calls the global `handoff` command, so install Handoff globally (or `npm link` a clone) before you use it.

### Try the demo

`examples/sprout` is a small launch page whose first-pass build has two realistic bugs planted in it, the kind agents leave every day: email validation that only checks for `@`, and a yearly price that forgot the discount.

```bash
git clone https://github.com/esteexbt/handoff && cd handoff && npm link
cd examples/sprout
handoff doctor                 # checks kane-cli, Claude Code, the spec and the app
handoff verify                 # Kane catches the 2 bugs
handoff loop --headed --open   # watch Kane in Chrome, Claude Code fixes, the proof page opens
```

`handoff loop` edits `public/app.js`. To replay the demo from the start: `git checkout -- public/app.js`.

## handoff.md

```markdown
---
name: Sprout
url: http://localhost:4173
start: node server.js          # optional: Handoff starts the app if it's down
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

Each check becomes one `kane-cli run --agent --headless "<check>" --url <url>`, and Handoff parses Kane's NDJSON stream. `[/path]` starts a check on another page.

## Commands

| Command | What it does |
|---|---|
| `handoff init` | Creates `handoff.md` and adds the Stop hook to `.claude/settings.json` |
| `handoff verify [--only a,b] [--headed]` | Runs checks through Kane CLI. Exits non-zero on failure, so it works in CI |
| `handoff loop [--max 3] [--headed] [--open]` | Verify, brief the agent, fix, re-verify, until green |
| `handoff proof` | Rebuilds and opens the proof page |
| `handoff brief` | Prints the exact brief the agent receives for the last failures |
| `handoff doctor` | Checks kane-cli, Claude Code, the spec and the app |

`--headed` shows the real browser, which is great for demos.

## How the loop talks

| Kane CLI exit | Meaning | Handoff does |
|---|---|---|
| `0` | passed | Records the evidence and the Kane report link |
| `1` | assertion failed | Reads Kane's verdict, then either briefs the agent or re-runs if Kane blames itself |
| `2` | environment error | Reports it and never asks the agent to fix code that isn't broken |
| `3` | timeout | Re-runs if Kane marks it as infra, otherwise treats it as a failure |

The Stop hook allows 3 attempts per Claude session (`HANDOFF_MAX_ATTEMPTS`), then hands control back to you, so it never loops forever.

## Troubleshooting

| You see | Fix |
|---|---|
| `kane-cli` (or `handoff`) "is not recognized" on Windows | npm's global folder isn't on your PATH. Add the folder printed by `npm prefix -g` to your user PATH and open a new terminal. |
| `ENV` results: "Google Chrome is required but was not found" | Install Chrome from google.com/chrome, or set `KANE_CLI_CHROME_PATH` to your Chrome executable. |
| `ENV` results: "Project and folder must be configured" | Run `kane-cli login` again and pick your project and folder. |
| `handoff loop` says Claude Code wasn't found | `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in. |
| An app at `url` isn't responding | Start your app, or add `start: <command>` to `handoff.md` so Handoff starts it for you. |

Handoff marks environment problems as `ENV` and never hands them to the agent as bugs.

## Repository

| Path | What's there |
|---|---|
| `bin/`, `src/` | The CLI: spec parser, Kane runner and triage, agent brief, Stop hook, proof page |
| `examples/sprout/` | The demo app, its `handoff.md`, and the real committed run history in `.handoff/` |
| `templates/handoff.md` | The spec `handoff init` creates |
| `test/` | `npm test`: the full loop against test doubles for Kane and Claude |
| `docs/` | The website ([handoffcli.vercel.app](https://handoffcli.vercel.app)), the hosted proof page, and the brand kit |

## Under the hood

Zero dependencies, Node 18+. Built and tested on Windows, and also runs on macOS and Linux. On Windows, npm's `.cmd` shims are resolved to their real entry points, so plain-English checks full of quotes reach Kane intact. `npm test` runs the full loop against test doubles, and the real runs behind the proof page are committed in `examples/sprout/.handoff/runs/`.

---

Built for the [Kane CLI Hackathon](https://kaneclihack.sh). Design by Estee ([@esteexbt](https://x.com/esteexbt)). MIT.
