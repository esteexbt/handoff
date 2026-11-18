// Runs one plain-English check through Kane CLI in agent mode and turns its
// NDJSON stream into a verdict.
//
// Kane CLI exit codes: 0 passed · 1 assertion failed · 2 environment error · 3 timeout
import { resolveCli, launch, killTree } from './proc.js';
import { c, sym, truncate } from './ui.js';

export function resolveKane() {
  return resolveCli({ envVar: 'HANDOFF_KANE_BIN', binName: 'kane-cli', pkgName: '@testmuai/kane-cli' });
}

const TEXT_KEYS = ['step', 'action', 'description', 'message', 'text', 'thought', 'instruction', 'title', 'summary', 'detail'];

export function eventText(ev) {
  if (!ev || typeof ev !== 'object') return '';
  // Kane 0.10 step events: { step, status: running|done|failed, remark }
  if (typeof ev.remark === 'string') {
    if (ev.status === 'running' || /^Step \d+$/.test(ev.remark)) return '';
    return (ev.status === 'failed' ? '✖ ' : '') + ev.remark;
  }
  if (/^(stream_start|recording_state|skill_update_available|bifurcation)$/.test(ev.type || '')) return '';
  for (const k of TEXT_KEYS) {
    const v = ev[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object') {
      for (const k2 of TEXT_KEYS) if (typeof v[k2] === 'string' && v[k2].trim()) return v[k2];
    }
  }
  return '';
}

const STATUS_BY_EXIT = { 0: 'passed', 1: 'failed', 2: 'error', 3: 'timeout' };

export function runCheck(kane, { objective, url, headed = false, timeoutSec = 300, onEvent } = {}) {
  return new Promise((resolve) => {
    const args = ['run', '--agent'];
    if (!headed) args.push('--headless');
    args.push(objective, '--url', url);

    const started = Date.now();
    const events = [];
    const steps = [];
    const rawSample = [];
    let stdoutBuf = '';
    let stderr = '';
    let timedOut = false;

    let child;
    try {
      child = launch(kane, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } catch (e) {
      return resolve(result({ status: 'error', exitCode: -1, reason: `Could not start kane-cli: ${e.message}` }));
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutSec * 1000);

    const handleLine = (line) => {
      line = line.trim();
      if (!line) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      events.push(ev);
      if (rawSample.length < 60) rawSample.push(JSON.stringify(ev).slice(0, 700));
      const text = eventText(ev);
      if (ev.type !== 'run_end' && text) steps.push({ type: ev.type || 'event', text });
      onEvent?.(ev, text);
    };

    child.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      let i;
      while ((i = stdoutBuf.indexOf('\n')) >= 0) {
        handleLine(stdoutBuf.slice(0, i));
        stdoutBuf = stdoutBuf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(result({ status: 'error', exitCode: -1, reason: `kane-cli failed to launch: ${e.message}` }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      const end = [...events].reverse().find((e) => e.type === 'run_end') || null;
      let status = STATUS_BY_EXIT[code] ?? (code === 0 ? 'passed' : 'failed');
      if (timedOut) status = 'timeout';
      // Trust Kane's own verdict when exit code is ambiguous.
      if (end?.status && code !== 2 && !timedOut) {
        const s = String(end.status).toLowerCase();
        if (s.startsWith('pass')) status = 'passed';
        else if (s.startsWith('fail')) status = 'failed';
      }
      resolve(result({
        status,
        exitCode: timedOut ? 3 : code,
        summary: end?.summary || '',
        oneLiner: end?.one_liner || '',
        reason: end?.reason || (status === 'error' ? cleanStderr(stderr) : ''),
        finalState: end?.final_state || null,
        kaneDuration: typeof end?.duration === 'number' ? end.duration : null,
        credits: typeof end?.credits_consumed === 'number' ? end.credits_consumed : null,
        reportUrl: end?.test_url || '',
        resultCode: end?.result_code ?? null,
        reasonCode: end?.reason_code || '',
        verdict: pickVerdict(end?.verdict),
        evidence: extractEvidence(end),
        runEnd: end,
      }));
    });

    function result(r) {
      return {
        ...r,
        objective,
        url,
        steps: steps.slice(-40),
        rawSample,
        eventCount: events.length,
        stderr: r.status === 'error' ? truncate(cleanStderr(stderr), 1200) : '',
        duration: (Date.now() - started) / 1000,
      };
    }
  });
}

// Live, compact rendering of Kane's stream for the terminal.
export function makeLivePrinter(indent = '      ') {
  let last = '';
  return (ev, text) => {
    if (!text || ev.type === 'run_end') return;
    const t = truncate(text, 96);
    if (t === last) return;
    last = t;
    console.log(`${indent}${sym.kane} ${c.gray(t)}`);
  };
}

// Kane's own judgement of a failure: was it the app, or Kane's automation?
function pickVerdict(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    status: v.status || '',
    family: v.family || '',
    category: v.category || '',
    severity: v.severity || '',
    rootCause: v.root_cause || '',
    confirmed: v.confirmed ?? null,
  };
}

// Pull "Kane read X, expected Y" out of the run's memory, when present.
function extractEvidence(end) {
  const mem = end?.context?.memory;
  if (!mem || typeof mem !== 'object') return [];
  const out = [];
  for (const [key, m] of Object.entries(mem)) {
    if (!m || typeof m !== 'object') continue;
    if (m.extracted_value === undefined && m.expected_value === undefined) continue;
    out.push({
      key,
      what: m.human_description || m.query || key,
      condition: m.condition || '',
      read: m.extracted_value ?? null,
      expected: m.expected_value ?? null,
    });
  }
  return out.slice(0, 6);
}

// True when Kane itself says the failure came from its own automation, not the app.
export function isAutomationSlip(r) {
  const f = (r.verdict?.family || '').toLowerCase();
  const cat = (r.verdict?.category || '').toLowerCase();
  return /automation|tooling|flak|infra/.test(f) || /agent_misstep|misclick|flak/.test(cat) || /^agent_error/.test(r.reasonCode || '');
}

// Drop Kane's informational banners so the real error is what people read.
export function cleanStderr(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^Skill update available|^Running on:/i.test(l.trim()))
    .join(' ')
    .replace(/Skill update available:.*?kane-cli install skill`\s*/i, '')
    .replace(/Running on: [^·]*· Chrome\s*/i, '')
    .trim();
}

// Only readouts that actually disagree and carry a human-meaningful value.
export function meaningfulEvidence(list) {
  return (list || []).filter((e) => {
    if (e.read == null || e.expected == null) return false;
    const a = String(e.read).trim(), b = String(e.expected).trim();
    if (a === b) return false;
    if (/^(true|false)$/i.test(a) && /^(true|false)$/i.test(b)) return false;
    return true;
  });
}

// True when Kane says the run broke for platform/infra reasons (screenshot
// timeouts, browser crashes): says nothing about the app either way.
export function isInfraFailure(r) {
  const f = (r.verdict?.family || '').toLowerCase();
  const cat = (r.verdict?.category || '').toLowerCase();
  return /environment|infra|platform/.test(f) || /platform|infra|environment/.test(cat) || /^infra_error/.test(r.reasonCode || '');
}
