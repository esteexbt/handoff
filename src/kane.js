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
        reason: end?.reason || (status === 'error' ? truncate(stderr, 400) : ''),
        finalState: end?.final_state || null,
        kaneDuration: typeof end?.duration === 'number' ? end.duration : null,
        runEnd: end,
      }));
    });

    function result(r) {
      return {
        ...r,
        objective,
        url,
        steps: steps.slice(-40),
        eventCount: events.length,
        stderr: r.status === 'error' ? truncate(stderr, 1200) : '',
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
