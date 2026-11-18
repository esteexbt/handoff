import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadSpec, findSpec, parseSpec, SPEC_FILE } from './spec.js';
import { ensureApp, requireKane, runRound, tally, printTally, HandoffError } from './verify.js';
import { feedback, runClaude, resolveClaude } from './agent.js';
import * as store from './store.js';
import { writeProof } from './proof.js';
import { resolveKane } from './kane.js';
import { killTree, openFile, urlIsUp, launch } from './proc.js';
import { c, sym, banner, rule, truncate, fmtDuration } from './ui.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '..', 'bin', 'handoff.js');

function pickChecks(spec, only) {
  if (!only) return spec.checks;
  const ids = String(only).split(',').map((s) => s.trim().toLowerCase());
  const picked = spec.checks.filter((ch) => ids.includes(ch.id));
  if (!picked.length) throw new HandoffError(`No checks match --only ${only}. Known: ${spec.checks.map((x) => x.id).join(', ')}`, 'BAD_ONLY');
  return picked;
}

function verdictOf(results) {
  const t = tally(results);
  if (t.total && t.passed === t.total) return 'verified';
  if (t.failed) return 'failing';
  return 'unverified';
}

function proofPath(spec) {
  return path.join(spec.root, '.handoff', 'proof.html');
}

function rel(spec, p) {
  return path.relative(process.cwd(), p) || p;
}

// ─── verify ────────────────────────────────────────────────────────────────
export async function verify(opts) {
  const spec = loadSpec();
  banner(`${spec.name || 'untitled'} · ${spec.url}`);
  const kane = requireKane();
  const app = await ensureApp(spec);
  const checks = pickChecks(spec, opts.only);
  const run = { id: store.newRunId(), trigger: 'verify', startedAt: new Date().toISOString(), spec: specMeta(spec), rounds: [] };
  try {
    rule('Kane CLI · real browser');
    const round = await runRound(spec, checks, { kane, headed: opts.headed, label: 'Verify' });
    run.rounds.push(round);
    run.finishedAt = new Date().toISOString();
    run.verdict = verdictOf(round.results);
    store.saveRun(spec.root, run);
    const t = printTally(round.results);
    const out = writeProof(spec);
    console.log(`  ${sym.arrow} proof ${c.cyan(rel(spec, out))}\n`);
    if (opts.open) openFile(out);
    return t.passed === t.total ? 0 : 1;
  } finally {
    killTree(app.started);
  }
}

// ─── loop: verify → brief the agent → fix → re-verify ──────────────────────
export async function loop(opts) {
  const spec = loadSpec();
  const max = Number(opts.max || 3);
  banner(`${spec.name || 'untitled'} · closed loop · up to ${max} fix rounds`);
  const kane = requireKane();
  if (!resolveClaude()) throw new HandoffError('Claude Code (`claude`) not found. Install it, or use the Stop hook from `handoff init`.', 'NO_AGENT');
  const app = await ensureApp(spec);
  const checks = pickChecks(spec, opts.only);
  const run = { id: store.newRunId(), trigger: 'loop', startedAt: new Date().toISOString(), spec: specMeta(spec), rounds: [] };
  const save = () => { store.saveRun(spec.root, run); writeProof(spec); };

  try {
    rule('Round 1 · Kane CLI verifies the build');
    let round = await runRound(spec, checks, { kane, headed: opts.headed, label: 'Round 1' });
    run.rounds.push(round);
    printTally(round.results);
    save();

    let failing = round.results.filter((r) => r.status === 'failed' || r.status === 'timeout');
    let envErr = round.results.find((r) => r.status === 'error');
    let n = 1;
    let fixed = false;
    while (failing.length && !envErr && n <= max) {
      rule(`Agent · fixing ${failing.length} failing check${failing.length > 1 ? 's' : ''}`);
      const brief = feedback(spec, failing, { round: n, maxRounds: max });
      for (const f of failing) console.log(`      ${sym.fail} ${c.bold(f.id)} ${c.gray(truncate(f.summary || f.reason, 90))}`);
      const t0 = Date.now();
      const agent = await runClaude(brief, { cwd: spec.root, model: opts.model });
      round.agent = { brief, text: agent.text, edits: agent.edits, cost: agent.cost, ok: agent.ok, duration: (Date.now() - t0) / 1000 };
      console.log(`      ${agent.ok ? sym.agent : sym.warn} ${c.bold('agent:')} ${truncate(agent.text, 110)}`);
      save();
      if (!agent.ok) break;

      n++;
      rule(`Round ${n} · Kane CLI re-checks what failed`);
      const retry = checks.filter((ch) => failing.some((f) => f.id === ch.id));
      round = await runRound(spec, retry, { kane, headed: opts.headed, label: `Round ${n}` });
      run.rounds.push(round);
      printTally(round.results);
      save();
      failing = round.results.filter((r) => r.status === 'failed' || r.status === 'timeout');
      envErr = round.results.find((r) => r.status === 'error');
      fixed = !failing.length && !envErr;
    }

    if (fixed && opts.sweep !== false && checks.length > 1) {
      rule('Regression sweep · every check, one more time');
      round = await runRound(spec, checks, { kane, headed: opts.headed, label: 'Sweep' });
      run.rounds.push(round);
      printTally(round.results);
      failing = round.results.filter((r) => r.status === 'failed' || r.status === 'timeout');
    }

    run.finishedAt = new Date().toISOString();
    const finalRound = run.rounds.at(-1);
    envErr = finalRound.results.find((r) => r.status === 'error');
    run.verdict = envErr ? 'interrupted' : finalRound.results.length === checks.length ? verdictOf(finalRound.results) : (failing.length ? 'failing' : 'verified');
    save();
    const out = proofPath(spec);
    const fixRounds = run.rounds.filter((r) => r.agent).length;
    console.log('');
    if (run.verdict === 'interrupted') {
      console.log(`  ${sym.warn} ${c.bold(c.yellow('Paused: Kane CLI hit an environment problem.'))} Nothing was blamed on your code.`);
      console.log(`    ${c.gray(truncate(envErr.reason || envErr.stderr, 220))}`);
    } else if (run.verdict === 'verified') {
      console.log(`  ${sym.pass} ${c.bold(c.green('Verified.'))} ${checks.length}/${checks.length} checks pass in a real browser${fixRounds ? ` after ${fixRounds} agent fix round${fixRounds > 1 ? 's' : ''}` : ''}.`);
    } else {
      console.log(`  ${sym.fail} ${c.bold(c.red('Not verified.'))} ${failing.length} check${failing.length === 1 ? '' : 's'} failing after ${fixRounds} fix round${fixRounds === 1 ? '' : 's'}: ${failing.map((f) => f.id).join(', ')}.`);
    }
    console.log(`  ${sym.arrow} proof ${c.cyan(rel(spec, out))}\n`);
    if (opts.open) openFile(out);
    return run.verdict === 'verified' ? 0 : 1;
  } finally {
    killTree(app.started);
  }
}

// ─── hook: Claude Code Stop hook ───────────────────────────────────────────
// Exit 0 → let Claude finish. Exit 2 → block, stderr becomes Claude's next brief.
export async function hook() {
  const input = await readStdin(1500);
  if (process.env.HANDOFF_INSIDE_LOOP) return 0;
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch {}
  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!findSpec(cwd)) return 0;

  let spec;
  try { spec = loadSpec(cwd); } catch (e) { return say(`Handoff: ${e.message}`); }

  const state = store.loadState(spec.root);
  const fp = store.fingerprint(spec.root);
  if (state.lastGreen === fp) return 0; // nothing changed since last verified build

  const kane = resolveKane();
  if (!kane) return say('Handoff: kane-cli not found, skipping browser verification. Run: npm i -g @testmuai/kane-cli');

  let app;
  try { app = await ensureApp(spec, { quiet: true }); } catch (e) { return say(`Handoff: ${e.message}`); }

  const max = Number(process.env.HANDOFF_MAX_ATTEMPTS || 3);
  try {
    const round = await runRound(spec, spec.checks, { kane, quiet: true, live: false });
    // Group rounds from the same Claude session into one run → timeline on the proof page.
    let run = null;
    if (state.session && state.session === payload.session_id && state.runId) run = store.loadRun(spec.root, state.runId);
    if (!run) run = { id: store.newRunId(), trigger: 'hook', startedAt: round.startedAt, spec: specMeta(spec), rounds: [] };
    round.label = `Turn ${run.rounds.length + 1}`;
    run.rounds.push(round);
    run.finishedAt = round.finishedAt;
    run.verdict = verdictOf(round.results);
    store.saveRun(spec.root, run);
    writeProof(spec);

    const t = tally(round.results);
    const failing = round.results.filter((r) => r.status === 'failed' || r.status === 'timeout');
    const next = { ...state, session: payload.session_id, runId: run.id };

    if (!failing.length && !t.errors) {
      store.saveState(spec.root, { ...next, attempts: 0, lastGreen: fp });
      return say(`Handoff ✔ ${t.passed}/${t.total} checks verified in a real browser by Kane CLI — proof: .handoff/proof.html`);
    }
    if (!failing.length && t.errors) {
      store.saveState(spec.root, next);
      const e = round.results.find((r) => r.status === 'error');
      return say(`Handoff ▲ Kane CLI hit an environment problem (not your code): ${truncate(e.reason || e.stderr, 200)}`);
    }
    const attempts = (state.session === payload.session_id ? state.attempts || 0 : 0) + 1;
    if (attempts > max) {
      store.saveState(spec.root, { ...next, attempts: 0 });
      return say(`Handoff ✖ ${failing.length} check(s) still failing after ${max} attempts: ${failing.map((f) => f.id).join(', ')}. Handing back to you — see .handoff/proof.html`);
    }
    store.saveState(spec.root, { ...next, attempts });
    process.stderr.write(feedback(spec, failing, { round: attempts, maxRounds: max }) + '\n');
    return 2;
  } finally {
    killTree(app?.started);
  }
}

function say(msg) {
  process.stdout.write(JSON.stringify({ systemMessage: msg }) + '\n');
  return 0;
}

function readStdin(ms) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const t = setTimeout(() => resolve(data), ms);
    process.stdin.on('data', (d) => (data += d));
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

// ─── init ──────────────────────────────────────────────────────────────────
export async function init(opts) {
  banner('setting up this project');
  const root = process.cwd();
  const specFile = path.join(root, SPEC_FILE);
  if (fs.existsSync(specFile)) {
    console.log(`  ${sym.dot} ${SPEC_FILE} already exists — leaving it alone`);
  } else {
    const tpl = fs.readFileSync(path.resolve(here, '..', 'templates', 'handoff.md'), 'utf8')
      .replace('{{name}}', path.basename(root))
      .replace('{{url}}', opts.url || 'http://localhost:3000');
    fs.writeFileSync(specFile, tpl);
    console.log(`  ${sym.pass} created ${c.bold(SPEC_FILE)} ${c.gray('— write your checks in plain English')}`);
  }

  if (opts.hook !== false) {
    const settingsFile = path.join(root, '.claude', 'settings.json');
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
    settings.hooks ||= {};
    settings.hooks.Stop ||= [];
    const command = `node "${BIN.replace(/\\/g, '/')}" hook`;
    const already = JSON.stringify(settings.hooks.Stop).includes('handoff');
    if (!already) {
      settings.hooks.Stop.push({ hooks: [{ type: 'command', command, timeout: 900, statusMessage: 'Handoff: verifying the spec in a real browser (Kane CLI)' }] });
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      console.log(`  ${sym.pass} added Claude Code ${c.bold('Stop hook')} ${c.gray('→ .claude/settings.json')}`);
    } else {
      console.log(`  ${sym.dot} Stop hook already installed`);
    }
  }

  const gi = path.join(root, '.gitignore');
  const want = ['.handoff/state.json'];
  let cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const missing = want.filter((w) => !cur.split(/\r?\n/).includes(w));
  if (missing.length) {
    fs.writeFileSync(gi, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  }

  console.log(`
  ${c.bold('Next')}
    1. Edit ${c.cyan(SPEC_FILE)} — the url, your brand rules, and the flows that must work
    2. ${c.cyan('handoff verify')}     run every check in a real browser
    3. ${c.cyan('handoff loop')}       let Claude Code fix what Kane catches, until green
    ${c.gray('or just work in Claude Code — the Stop hook verifies every turn')}
`);
  return 0;
}

// ─── proof ─────────────────────────────────────────────────────────────────
export async function proof(opts) {
  const spec = loadSpec();
  const out = writeProof(spec);
  console.log(`\n  ${sym.arrow} proof ${c.cyan(rel(spec, out))}\n`);
  if (opts.open !== false) openFile(out);
  return 0;
}

// ─── brief: show what the agent would be told ─────────────────────────────
export async function brief() {
  const spec = loadSpec();
  const runs = store.loadRuns(spec.root, 1);
  const last = runs.at(-1)?.rounds.at(-1);
  const failing = (last?.results || []).filter((r) => r.status === 'failed' || r.status === 'timeout');
  if (!failing.length) { console.log('\n  No failing checks in the last run — nothing to brief.\n'); return 0; }
  console.log('\n' + feedback(spec, failing) + '\n');
  return 0;
}

// ─── doctor ────────────────────────────────────────────────────────────────
export async function doctor() {
  banner('doctor');
  let ok = true;
  const line = (good, label, detail = '') => {
    if (!good) ok = false;
    console.log(`  ${good ? sym.pass : sym.fail} ${label}${detail ? '  ' + c.gray(detail) : ''}`);
  };
  const major = Number(process.versions.node.split('.')[0]);
  line(major >= 18, 'Node.js', process.versions.node);

  const kane = resolveKane();
  line(!!kane, 'kane-cli', kane ? kane.display : 'npm install -g @testmuai/kane-cli');
  if (kane) {
    const v = await capture(kane, ['--version']);
    console.log(`      ${c.gray(truncate(v || 'version unknown', 80))}`);
  }
  const claude = resolveClaude();
  console.log(`  ${claude ? sym.pass : sym.warn} Claude Code${claude ? '  ' + c.gray(claude.display) : '  ' + c.gray('optional for `handoff loop`')}`);

  const specFile = findSpec();
  line(!!specFile, SPEC_FILE, specFile ? path.relative(process.cwd(), specFile) || specFile : 'run `handoff init`');
  if (specFile) {
    const spec = parseSpec(fs.readFileSync(specFile, 'utf8'), specFile);
    spec.root = path.dirname(specFile);
    line(spec.checks.length > 0, 'checks', `${spec.checks.length} found: ${spec.checks.map((x) => x.id).join(', ')}`);
    if (spec.url) {
      const up = await urlIsUp(spec.url);
      console.log(`  ${up ? sym.pass : sym.warn} app at ${spec.url}  ${c.gray(up ? 'responding' : spec.start ? `down — will start with \`${spec.start}\`` : 'down — start it first')}`);
    } else line(false, 'url', 'missing in front matter');
    const settings = path.join(spec.root, '.claude', 'settings.json');
    const hooked = fs.existsSync(settings) && fs.readFileSync(settings, 'utf8').includes('handoff');
    console.log(`  ${hooked ? sym.pass : sym.dot} Claude Code Stop hook  ${c.gray(hooked ? 'installed' : 'not installed (handoff init)')}`);
  }
  console.log('');
  return ok ? 0 : 1;
}

function capture(resolved, args) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = launch(resolved, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return resolve(''); }
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve(out.trim()); }, 15000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => { clearTimeout(t); resolve(''); });
    child.on('close', () => { clearTimeout(t); resolve(out.trim()); });
  });
}

function specMeta(spec) {
  return { name: spec.name, url: spec.url, checks: spec.checks.length };
}
