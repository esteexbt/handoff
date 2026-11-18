// Generates .handoff/proof.html — a single self-contained page that shows,
// check by check, what the designer asked for and what Kane CLI proved.
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { meaningfulEvidence, isAutomationSlip, isInfraFailure } from './kane.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function shorten(t, n) {
  t = String(t || '').replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(': '));
  return (end > n * 0.5 ? cut.slice(0, end + 1) : cut.trimEnd() + '…');
}
function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function dur(sec) {
  if (sec == null) return '—';
  return sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}
const genuine = (h) => h.status === 'failed' && !isInfraFailure(h) && !(isAutomationSlip(h) && !meaningfulEvidence(h.evidence).length);
const LABEL = { passed: 'Passed', failed: 'Failed', timeout: 'Timed out', error: 'Env error', pending: 'Not run' };

export function buildProof(spec, runs) {
  const byCheck = store.latestByCheck(runs);
  const checks = spec.checks.map((ch) => {
    const hist = byCheck.get(ch.id) || [];
    // An environment error says nothing about the app: show the latest real verdict.
    const real = hist.filter((h) => h.status !== 'error' && !isInfraFailure(h));
    const last = real.at(-1) || hist.at(-1) || null;
    return { ...ch, last, hist: real.slice(-14), status: last?.status || 'pending' };
  });
  const passed = checks.filter((x) => x.status === 'passed').length;
  const total = checks.length;
  const verified = total > 0 && passed === total;
  const anyRun = checks.some((x) => x.last);
  const verdict = !anyRun ? 'pending' : verified ? 'verified' : 'failing';

  // The run that best tells the story: the latest with an agent fix in it, else the latest.
  const story = [...runs].reverse().find((r) => (r.rounds || []).some((x) => x.agent) || (r.rounds || []).length > 1) || runs.at(-1);
  const fixRounds = story ? story.rounds.filter((r) => r.agent).length : 0;
  const browserSecs = runs.flatMap((r) => r.rounds.flatMap((x) => x.results)).reduce((a, r) => a + (r.kaneDuration ?? r.duration ?? 0), 0);
  const kaneRuns = runs.flatMap((r) => r.rounds.flatMap((x) => x.results)).length;
  const catches = checks.filter((ch) => (byCheck.get(ch.id) || []).some(genuine)).length;
  const lastAt = runs.at(-1)?.finishedAt;
  const credits = runs.flatMap((r) => r.rounds.flatMap((x) => x.results)).reduce((a, r) => a + (r.credits || 0), 0);

  const stamp = verdict === 'verified'
    ? `<div class="stamp ok"><svg class="stamp-mark" width="30" height="23" viewBox="2 4.6 22 16.8" aria-hidden="true"><path d="M12 5L12 9L2 9L2 5Z" fill="currentColor"/><path d="M10.172 17L14.311 21.139L23.664 7.109L20.336 4.891L13.689 14.861L11.828 13L2 13L2 17Z" fill="currentColor"/></svg><span>Verified</span><b>${passed}/${total}</b><i>Kane CLI · real browser</i></div>`
    : verdict === 'failing'
      ? `<div class="stamp bad"><span>Not yet</span><b>${passed}/${total}</b><i>checks passing</i></div>`
      : `<div class="stamp idle"><span>Unverified</span><b>0/${total}</b><i>run handoff verify</i></div>`;

  const timeline = story ? story.rounds.map((round, i) => {
    const dots = spec.checks.map((ch) => {
      const r = round.results.find((x) => x.id === ch.id);
      const s = r ? (isInfraFailure(r) && r.status !== 'passed' ? 'error' : r.status) : 'skip';
      return `<li class="dot ${s}" title="${esc(ch.id)}: ${esc(r ? LABEL[s] : 'already passing')}"><span>${esc(ch.id)}</span></li>`;
    }).join('');
    const t = round.results;
    const p = t.filter((x) => x.status === 'passed').length;
    const realT = t.filter((x) => !(isInfraFailure(x) && x.status !== 'passed'));
    const agent = round.agent ? `
      <div class="fix">
        <div class="fix-head"><span class="glyph">◆</span> Coding agent briefed with Kane's findings</div>
        ${round.agent.edits?.length ? `<div class="edits">${round.agent.edits.map((e) => `<code>${esc(e)}</code>`).join('')}</div>` : ''}
        ${round.agent.text ? `<p>${esc(shorten(round.agent.text, 260))}</p>` : ''}
      </div>` : '';
    return `
      <div class="round ${p === realT.length ? 'green' : 'red'}">
        <div class="round-head"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="lbl">${esc(round.label || `Round ${i + 1}`)}</span><span class="score">${p}/${t.length}${realT.length < t.length ? ' <small title="Kane platform error">· ' + (t.length - realT.length) + ' env</small>' : ''}</span></div>
        <ul class="dots">${dots}</ul>
        <div class="round-time">${when(round.finishedAt)}</div>
      </div>${agent}`;
  }).join('') : '<p class="empty">No runs yet. Run <code>handoff verify</code> or <code>handoff loop</code>.</p>';

  const cards = checks.map((ch, i) => {
    const l = ch.last;
    const strip = ch.hist.map((h) => `<i class="${h.status}" title="${esc(LABEL[h.status] || h.status)} · ${esc(when(h.at))}"></i>`).join('');
    // The most telling catch: a genuine failure, preferring one with a hard readout.
    const fails = ch.hist.filter(genuine);
    const firstFail = [...fails].reverse().find((h) => meaningfulEvidence(h.evidence).length) || fails.at(-1);
    const caught = firstFail && ch.status === 'passed'
      ? `<div class="caught"><b>Caught, then fixed.</b> ${esc(shorten(firstFail.oneLiner || firstFail.summary || firstFail.reason || 'Kane CLI failed this check on an earlier build.', 200))}${meaningfulEvidence(firstFail.evidence).map((e) => ` Kane read <b>${esc(e.read)}</b> where the spec expects <b>${esc(e.expected)}</b>.`).join('')}${firstFail.reportUrl ? ` <a href="${esc(firstFail.reportUrl)}" target="_blank" rel="noopener">Failing run ↗</a>` : ''}</div>` : '';
    const steps = (l?.steps || []).filter((s) => s.text);
    return `
    <article class="check ${ch.status}">
      <div class="check-top">
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <code class="cid">${esc(ch.id)}</code>
        ${ch.route ? `<code class="route">${esc(ch.route)}</code>` : ''}
        <span class="pill ${ch.status}">${LABEL[ch.status] || esc(ch.status)}</span>
      </div>
      <blockquote>${esc(ch.objective)}</blockquote>
      ${l ? `
      <div class="evidence">
        <div class="ev-label">Kane CLI saw</div>
        <p>${esc(l.oneLiner || l.summary || l.reason || 'No summary returned.')}</p>
        ${(l.status !== 'passed' ? meaningfulEvidence(l.evidence) : []).map((e) => `<div class="readout"><span>${esc(e.what)}</span><b class="got">${esc(e.read)}</b><i>expected</i><b class="want">${esc(e.expected)}</b></div>`).join('')}
        ${l.retriedAfterSlip ? `<div class="slip">Kane flagged its own automation on the first attempt (${esc(l.retriedAfterSlip.verdict?.category || 'misstep')}), so Handoff re-ran it before involving the agent.</div>` : ''}
        <dl>
          ${l.finalState?.url ? `<div><dt>Ended on</dt><dd><code>${esc(l.finalState.url)}</code></dd></div>` : ''}
          <div><dt>Browser time</dt><dd>${dur(l.kaneDuration ?? l.duration)}</dd></div>
          <div><dt>Exit</dt><dd><code>${esc(l.exitCode)}</code></dd></div>
          <div><dt>Checked</dt><dd>${when(l.at)}</dd></div>
          ${l.credits != null ? `<div><dt>Kane credits</dt><dd>${l.credits.toFixed(1)}</dd></div>` : ''}
          ${l.reportUrl ? `<div><dt>Kane report</dt><dd><a href="${esc(l.reportUrl)}" target="_blank" rel="noopener">Open run ↗</a></dd></div>` : ''}
        </dl>
        ${caught}
        ${steps.length ? `<details><summary>${steps.length} browser step${steps.length > 1 ? 's' : ''}</summary><ol>${steps.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol></details>` : ''}
      </div>` : '<div class="evidence muted"><p>Not run yet.</p></div>'}
      <div class="strip" aria-label="history">${strip}</div>
    </article>`;
  }).join('');

  const swatches = spec.swatches.map((s) => `<figure><div class="sw" style="background:${esc(s.hex)}"></div><figcaption><b>${esc(s.label)}</b><code>${esc(s.hex)}</code></figcaption></figure>`).join('');
  const brandRules = spec.brand.filter((b) => !/#[0-9a-f]{3,6}\b/i.test(b)).map((b) => `<li>${esc(b)}</li>`).join('');

  const log = [...runs].reverse().slice(0, 12).map((r) => {
    const f = r.rounds.at(-1);
    const p = f?.results.filter((x) => x.status === 'passed').length || 0;
    return `<tr><td>${when(r.finishedAt || r.startedAt)}</td><td><code>${esc(r.trigger)}</code></td><td>${r.rounds.length}</td><td>${r.rounds.filter((x) => x.agent).length}</td><td><span class="pill sm ${r.verdict === 'verified' ? 'passed' : 'failed'}">${p}/${f?.results.length || 0}</span></td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proof · ${esc(spec.name || 'Handoff')}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cstyle%3E.a%7Bfill:%23141412%7D.b%7Bfill:%230F8A4F%7D%40media%20%28prefers-color-scheme:dark%29%7B.a%7Bfill:%23F3EFE6%7D.b%7Bfill:%2316A862%7D%7D%3C/style%3E%3Cpath%20class='a'%20d='M8%203L8%206L1%206L1%203Z'/%3E%3Cpath%20class='b'%20d='M6.379%2012L9.785%2015.406L15.679%205.783L13.121%204.217L9.215%2010.594L7.621%209L1%209L1%2012Z'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--paper:#F3EFE6;--card:#FBF9F4;--ink:#141412;--soft:#6B675E;--line:#DDD6C8;--ok:#0F8A4F;--okbg:#DDF3E6;--bad:#D1432F;--badbg:#FBE3DE;--warn:#B7791F;--warnbg:#FBF0D9;--accent:#2C2BE0;
--serif:"Instrument Serif",Georgia,serif;--sans:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}html{-webkit-font-smoothing:antialiased}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 var(--sans)}
code{font-family:var(--mono);font-size:.86em}
.wrap{max-width:1120px;margin:0 auto;padding:0 28px}
header.top{border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
.mark{display:flex;align-items:center;gap:9px;font-weight:600;font-size:17px;letter-spacing:-.02em}
.mark svg{display:block}
.top small{color:var(--soft);font-family:var(--mono);font-size:12px}
.hero{display:grid;grid-template-columns:1fr auto;gap:40px;align-items:end;padding:56px 0 36px;border-bottom:1px solid var(--line)}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft)}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(48px,7vw,88px);line-height:.95;letter-spacing:-.02em;margin:12px 0 18px}
h1 em{color:var(--soft)}
.lede{max-width:600px;color:#3B3934;font-size:16px;margin:0}
.lede a{color:inherit}
.stamp{width:188px;height:188px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px solid currentColor;position:relative;transform:rotate(-8deg)}
.stamp::before{content:"";position:absolute;inset:7px;border-radius:50%;border:1px dashed currentColor;opacity:.6}
.stamp-mark{margin-bottom:4px}
.stamp span{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase}
.stamp b{font-family:var(--serif);font-weight:400;font-size:64px;line-height:1}
.stamp i{font-style:normal;font-size:11px;opacity:.8}
.stamp.ok{color:var(--ok);background:var(--okbg)}.stamp.bad{color:var(--bad);background:var(--badbg)}.stamp.idle{color:var(--soft)}
.stats{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid var(--line)}
.stat{padding:22px 0}.stat+.stat{padding-left:22px;border-left:1px solid var(--line)}
.stat b{display:block;font-family:var(--serif);font-weight:400;font-size:40px;line-height:1.1}
.stat span{font-size:12px;color:var(--soft)}
section{padding:48px 0;border-bottom:1px solid var(--line)}
h2{font-family:var(--serif);font-weight:400;font-size:36px;margin:0 0 6px;letter-spacing:-.01em}
.sub{color:var(--soft);margin:0 0 28px;max-width:620px}
.loop{display:flex;gap:14px;overflow-x:auto;padding-bottom:6px;align-items:stretch}
.round{min-width:220px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
.round.green{border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}
.round.red{border-color:color-mix(in srgb,var(--bad) 40%,var(--line))}
.round-head{display:flex;align-items:baseline;gap:8px}
.round-head .n{font-family:var(--mono);font-size:11px;color:var(--soft)}
.round-head .lbl{font-weight:600}
.round-head .score{margin-left:auto;font-family:var(--mono);font-size:13px}
.round.green .score{color:var(--ok)}.round.red .score{color:var(--bad)}
.dots{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dot{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;color:var(--soft)}
.dot::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--line);flex:none}
.dot.passed::before{background:var(--ok)}.dot.failed::before,.dot.timeout::before{background:var(--bad)}.dot.error::before{background:var(--warn)}
.dot.skip{opacity:.45}.dot.skip::before{background:transparent;border:1px solid var(--line)}
.dot.failed span{color:var(--bad)}
.round-time{font-size:11px;color:var(--soft);margin-top:auto;font-family:var(--mono)}
.fix{min-width:250px;max-width:300px;align-self:center;background:var(--ink);color:#EDEAE2;border-radius:14px;padding:16px;font-size:13px;position:relative}
.fix::before,.fix::after{content:"";position:absolute;top:50%;width:14px;height:1px;background:var(--ink)}
.fix::before{left:-14px}.fix::after{right:-14px}
.fix-head{font-weight:600;margin-bottom:8px;font-size:12px}
.glyph{color:#B9A6FF}
.fix p{margin:8px 0 0;color:#BDB8AD;font-size:12.5px}
.edits{display:flex;flex-wrap:wrap;gap:6px}
.edits code{background:#2A2925;border-radius:6px;padding:2px 7px;font-size:11px;color:#EDEAE2}
.checks{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.check{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:14px}
.check-top{display:flex;align-items:center;gap:8px}
.idx{font-family:var(--mono);font-size:11px;color:var(--soft)}
.cid{font-weight:500}
.route{color:var(--soft)}
.pill{margin-left:auto;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:99px;background:var(--line);color:var(--soft)}
.pill.sm{margin:0;padding:2px 8px}
.pill.passed{background:var(--okbg);color:var(--ok)}.pill.failed,.pill.timeout{background:var(--badbg);color:var(--bad)}.pill.error{background:var(--warnbg);color:var(--warn)}
blockquote{margin:0;font-family:var(--serif);font-size:22px;line-height:1.25;letter-spacing:-.005em}
blockquote::before{content:"“";color:var(--soft)}blockquote::after{content:"”";color:var(--soft)}
.evidence{border-top:1px dashed var(--line);padding-top:14px}
.evidence.muted p{color:var(--soft);margin:0}
.ev-label{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--soft)}
.evidence>p{margin:6px 0 12px}
dl{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px;margin:0;font-size:12.5px}
dt{color:var(--soft);font-size:11px}dd{margin:0;word-break:break-all}
dd a,.caught a{color:var(--accent)}
.readout{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:10px 12px;border-radius:10px;background:var(--badbg);font-size:13px}
.readout span{color:#6B3A32;flex-basis:100%;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-family:var(--mono)}
.readout b{font-family:var(--serif);font-weight:400;font-size:26px;line-height:1}.readout .got{color:var(--bad);text-decoration:line-through}.readout .want{color:var(--ok)}.readout i{font-style:normal;color:var(--soft)}
.slip{margin:0 0 12px;font-size:12.5px;background:var(--warnbg);color:#6B4A12;border-radius:10px;padding:8px 12px}
.caught{margin-top:12px;font-size:13px;background:var(--okbg);border-radius:10px;padding:10px 12px;color:#1F4D35}
details{margin-top:12px;font-size:13px}summary{cursor:pointer;color:var(--accent)}
details ol{margin:8px 0 0;padding-left:20px;color:#3B3934}details li{margin:3px 0}
.strip{display:flex;gap:3px;margin-top:auto}
.strip i{width:10px;height:18px;border-radius:3px;background:var(--line)}
.strip i.passed{background:var(--ok)}.strip i.failed,.strip i.timeout{background:var(--bad)}.strip i.error{background:var(--warn)}
.brand{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.swatches{display:flex;flex-wrap:wrap;gap:14px}
figure{margin:0;width:130px}
.sw{height:84px;border-radius:12px;border:1px solid rgba(0,0,0,.08)}
figcaption{font-size:12px;margin-top:8px;display:flex;flex-direction:column}
figcaption code{color:var(--soft)}
.rules{margin:0;padding-left:18px}.rules li{margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;color:var(--soft);font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--line);padding:8px 0}
td{padding:10px 0;border-bottom:1px solid var(--line)}
footer{padding:36px 0 60px;display:flex;align-items:center;justify-content:space-between;color:var(--soft);font-size:12px}
.badge{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ink);color:var(--ink);border-radius:99px;padding:6px 12px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.badge svg{display:block}
.empty{color:var(--soft)}
@media (max-width:820px){.hero{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.stat+.stat{padding-left:0;border-left:0}.checks,.brand{grid-template-columns:1fr}.stamp{width:150px;height:150px}.stamp b{font-size:48px}}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="mark"><svg width="26" height="20" viewBox="2 4.6 22 16.8" aria-hidden="true"><path d="M12 5L12 9L2 9L2 5Z" fill="#141412"/><path d="M10.172 17L14.311 21.139L23.664 7.109L20.336 4.891L13.689 14.861L11.828 13L2 13L2 17Z" fill="#0F8A4F"/></svg>handoff</div>
  <small>proof of handoff · ${esc(when(lastAt))}</small>
</div></header>
<main class="wrap">
  <div class="hero">
    <div>
      <div class="eyebrow">${esc(spec.url)}</div>
      <h1>${esc(spec.name || 'Untitled')}<br><em>as specified.</em></h1>
      <p class="lede">Every check below was written in plain English in <code>handoff.md</code> and run in a real Chrome browser by Kane CLI. When a check failed, Handoff briefed the coding agent with what Kane saw, the agent fixed the app, and Kane checked again.</p>
    </div>
    ${stamp}
  </div>
  <div class="stats">
    <div class="stat"><b>${passed}/${total}</b><span>checks passing</span></div>
    <div class="stat"><b>${catches}</b><span>bugs Kane caught</span></div>
    <div class="stat"><b>${fixRounds}</b><span>agent fix rounds</span></div>
    <div class="stat"><b>${kaneRuns}</b><span>browser runs</span></div>
    <div class="stat"><b>${dur(browserSecs)}</b><span>in a real browser</span></div>
  </div>

  <section>
    <h2>The loop</h2>
    <p class="sub">The latest run, round by round. Red dots are failures Kane CLI caught; dark cards are the agent acting on them.</p>
    <div class="loop">${timeline}</div>
  </section>

  <section>
    <h2>Checks</h2>
    <p class="sub">The designer's words on top, Kane's evidence underneath. The strip shows each check's recent history.</p>
    <div class="checks">${cards}</div>
  </section>

  ${spec.brand.length ? `<section>
    <h2>Brand</h2>
    <p class="sub">The rules the agent was told to respect while fixing.</p>
    <div class="brand"><div class="swatches">${swatches}</div><ul class="rules">${brandRules}</ul></div>
  </section>` : ''}

  ${runs.length ? `<section>
    <h2>Run log</h2>
    <table><thead><tr><th>When</th><th>Trigger</th><th>Rounds</th><th>Agent fixes</th><th>Result</th></tr></thead><tbody>${log}</tbody></table>
  </section>` : ''}
</main>
<footer class="wrap"><span class="badge"><svg width="15" height="12" viewBox="2 4.6 22 16.8" aria-hidden="true"><path d="M12 5L12 9L2 9L2 5Z" fill="#141412"/><path d="M10.172 17L14.311 21.139L23.664 7.109L20.336 4.891L13.689 14.861L11.828 13L2 13L2 17Z" fill="#0F8A4F"/></svg>Verified with Kane CLI</span><span>${credits ? `${credits.toFixed(0)} Kane credits · ` : ''}Generated by Handoff · ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC</span></footer>
</body>
</html>`;
}

export function badgeSvg(passed, total) {
  const ok = total > 0 && passed === total;
  const right = ok ? `verified ${passed}/${total}` : `${passed}/${total} passing`;
  const color = ok ? '#0F8A4F' : '#D1432F';
  const lw = 62, rw = 10 + right.length * 6.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="22" role="img" aria-label="handoff: ${right}"><rect width="${lw + rw}" height="22" rx="11" fill="#141412"/><rect x="${lw}" width="${rw}" height="22" rx="11" fill="${color}"/><rect x="${lw}" width="12" height="22" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="10" y="15">handoff</text><text x="${lw + 7}" y="15">${right}</text></g></svg>`;
}

export function writeProof(spec) {
  const runs = store.loadRuns(spec.root, 50);
  const html = buildProof(spec, runs);
  const d = store.ensure(spec.root);
  const out = path.join(d.base, 'proof.html');
  fs.writeFileSync(out, html);
  const latest = store.latestByCheck(runs);
  const passed = spec.checks.filter((ch) => latest.get(ch.id)?.at(-1)?.status === 'passed').length;
  fs.writeFileSync(path.join(d.base, 'badge.svg'), badgeSvg(passed, spec.checks.length));
  return out;
}
