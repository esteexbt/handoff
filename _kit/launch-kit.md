# Handoff: launch kit (private, git-ignored)

**Deadline: Thursday 19 Nov, 11:59 PM IST = 7:29 PM Lagos.** Aim to submit by **5 PM** so there's a buffer.

## Checklist

- [x] Public repo, started after 12 Nov: github.com/esteexbt/handoff
- [x] Registered on TestMu, ran Kane CLI, claimed credits
- [x] Clears all three bars: works end to end · Kane caught something ($60 vs $48, bad email) · agent and Kane talk (loop + Stop hook)
- [ ] Demo video (3–5 min) on YouTube, Unlisted or Public
- [ ] Launch post 1 (X)
- [ ] Launch post 2 (LinkedIn)
- [ ] Optional post 3 (Reddit r/ClaudeAI or r/webdev, or Hacker News "Show HN"). Extra posts earn bonus points
- [ ] Submission form: GitHub URL, About, video URL, post links

---

## Demo video script (~4 min)

**Before recording**
- Record the screen with OBS Studio ("Display Capture", so the Chrome windows Kane opens get captured too). Xbox Game Bar only records one window, so don't use it.
- Big terminal font (Ctrl + scroll). Close other tabs and notifications.
- In `examples\sprout`, make sure the bugs are in: `git checkout -- public/app.js`
- The loop takes about 25 minutes for real. Record all of it, then **speed up the waiting parts (8–16x)** in DaVinci. Say "sped up" on screen once. Honesty matters to the judges.
- Record the voiceover separately over the edit. It's easier than talking live.

**0:00 – 0:20 · The problem** (face cam or just the Sprout page)
> "AI coding agents always say 'done'. Then I, the designer, open the page and find the yearly price is wrong, or the form accepts a broken email. Someone always has to check. Handoff makes the agent prove it instead."

**0:20 – 0:50 · The spec** (open `handoff.md` in VS Code)
> "This is the handoff. It's plain English, the way I'd write acceptance criteria for a developer. Brand rules on top, then checks. No selectors, no test code. Kane CLI can run every line in a real browser."

Scroll slowly past the Checks list. Point at the yearly-pricing line.

**0:50 – 2:30 · The loop** (terminal + Chrome)
Run `handoff loop --headed --open`.
> "Round one: Kane opens Chrome and works through each check like a person would. You can see its steps here."

When yearly-pricing fails, pause or zoom on the line **Kane read "$60" · expected "$48"**.
> "There it is. The agent forgot the 20% discount. Kane read $60 off the page, the spec says $48. And the email form accepted 'ada@example' with no domain."

Agent section (◆ lines):
> "Now Handoff writes Kane's findings into a brief and hands it to Claude Code: what Kane saw, the exact values, the brand rules, and 'fix the app, not the check'. Claude reads app.js and edits it."

Round 2:
> "Kane checks only what failed. Both pass. Then a regression sweep runs every check again, so the fix didn't break anything else."

**2:30 – 3:15 · The proof page**
> "This is what I'd send a client or a PM instead of 'trust me'. Verified 6 of 6. The loop round by round. Every check shows my words on top and Kane's evidence underneath."

Click **"Caught, then fixed"** on yearly-pricing, then click **Open run ↗** to show Kane's own report.
> "Every result links to Kane's own run report, so the proof checks out."

**3:15 – 3:50 · Kane's verdict decides who fixes it**
Show the README table, or a proof card with the amber note.
> "Kane doesn't just say pass or fail. It says why. If Kane says its own click slipped, or the browser crashed taking a screenshot, Handoff re-runs instead of sending the agent to 'fix' code that works. Only real app bugs reach the agent."

**3:50 – 4:20 · Inside Claude Code** (the Stop hook)
Show Claude Code with the line **"Stop says: Handoff ✔ 6/6 checks verified in a real browser by Kane CLI"**.
> "And if you live in Claude Code, `handoff init` adds a Stop hook. Every time Claude says it's done, Kane verifies first. If something fails, Claude can't stop. Kane's findings become its next instruction."

**4:20 – 4:40 · Close**
> "Handoff. Plain-English spec, Kane proves it, the agent fixes it. It's open source, link below. Built by a designer, for anyone tired of checking 'done'."

Show: `npm install -g github:esteexbt/handoff` and the repo URL.

---

## Post 1 · X (post as soon as the video is up)

**Option A (main):**

> AI agents always say "done".
>
> Then I open the page and the yearly price is $60 instead of $48.
>
> So I built Handoff: write the spec in plain English, Kane CLI checks every line in a real browser, and Claude Code isn't allowed to stop until it passes.
>
> [video]

**Reply to your own post** (the link goes in the reply, not the main post):

> How it works:
> - handoff.md: checks a designer would write
> - Kane CLI runs each one in real Chrome
> - fails go back to Claude Code with what Kane saw ("read $60, expected $48")
> - repeat until green, then a proof page you can send a client
>
> Open source: github.com/esteexbt/handoff
>
> Built for #KaneCLIHackathon @TestMuAI

Then ask a question to get replies, e.g. *"Designers: what's the bug you're most tired of catching after 'done'?"*

**Post 2 on X later** (at least an hour after, if you want a third post): a 20-second clip of the moment Kane reads $60, with a caption like *"watching Kane catch the bug my agent swore wasn't there"*.

## Post 2 · LinkedIn

> I'm a designer, and every AI coding agent I've used has the same habit: it says "done" before it's done.
>
> The yearly price that forgot the discount. The form that accepts "ada@example" as an email. Someone always has to click through and catch it, and that someone is usually me.
>
> So for the Kane CLI Hackathon I built Handoff.
>
> You write the handoff in plain English, the way you'd write acceptance criteria. Kane CLI runs every check in a real Chrome browser. When something fails, Handoff hands the coding agent (Claude Code) exactly what Kane saw, like "read $60, expected $48", and Kane checks again until everything passes.
>
> At the end you get a proof page you can send a client or PM: the original words, the evidence, and a link to every browser run.
>
> One detail I'm proud of: Kane reports *why* a run failed. If the problem was Kane's own click or the browser crashing, Handoff re-runs instead of making the agent "fix" code that works.
>
> Demo and code: github.com/esteexbt/handoff
>
> #KaneCLIHackathon #AI #DesignEngineering #ClaudeCode

## Optional post 3 · Reddit (r/ClaudeAI) or Show HN

**Title:** Show HN: Handoff – plain-English design specs your coding agent has to prove in a real browser

> Handoff is a small CLI (zero deps) that closes the loop between a coding agent and browser verification. You write checks in plain English in handoff.md. Kane CLI runs each one in real Chrome and returns a verdict. Failures go back to Claude Code as a brief, either via a Stop hook (Claude can't end its turn until checks pass) or a headless loop. The part I found most interesting is triage: Kane classifies failures as app bugs, its own automation slips, or platform issues, so the agent only gets sent after real bugs. Repo + demo: github.com/esteexbt/handoff

---

## Submission form

**GitHub URL:** https://github.com/esteexbt/handoff

**About your app**

> **Handoff: design handoff your coding agent has to prove.**
>
> A designer writes acceptance checks in plain English in `handoff.md`, with no selectors or test code. A coding agent builds the app. Handoff runs every check in a real Chrome browser with Kane CLI (`kane-cli run --agent`, parsing the NDJSON stream). When a check fails, Handoff turns Kane's findings (its verdict, the summary, and readouts like "read $60, expected $48") into a brief for the agent. The agent fixes the app, and Kane re-verifies until every check passes. Then Handoff publishes a proof page with the designer's words, Kane's evidence and a link to each Kane run report.
>
> **Agent used:** Claude Code. It's wired in two ways: (1) a Claude Code **Stop hook**, so Claude cannot end its turn until Kane verifies, and failures come back to it via exit code 2; (2) `handoff loop`, which runs Claude Code headless (`claude -p`) in a verify → brief → fix → re-verify loop with a regression sweep.
>
> **What Kane does:** Kane is the source of truth. In the demo, Kane caught two real bugs in the agent's first build: the Grow plan showed $60/year instead of $48 (Kane read the value off the page), and the waitlist accepted "ada@example". Kane then confirmed both fixes and a full regression sweep (6/6). Handoff also reads Kane's own failure classification. Automation slips (`agent_misstep`) and platform failures (`infra_error.screenshot_failed`) are re-run, never sent to the agent as bugs, so the agent doesn't "fix" working code.
>
> Built and tested on Windows with real Kane CLI 0.10.6 and Claude Code. Zero dependencies.

**Demo video:** (YouTube link)

**Live URL:** (optional; leave blank or add later)

**Launch posts:** (X link) · (LinkedIn link)
