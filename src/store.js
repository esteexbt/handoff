// .handoff/ — run history, hook state and the generated proof page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function dirs(root) {
  const base = path.join(root, '.handoff');
  return { base, runs: path.join(base, 'runs') };
}

export function ensure(root) {
  const d = dirs(root);
  fs.mkdirSync(d.runs, { recursive: true });
  return d;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`;
}

export function saveRun(root, run) {
  const d = ensure(root);
  writeJson(path.join(d.runs, `${run.id}.json`), run);
  const history = readJson(path.join(d.base, 'history.json'), []);
  const idx = history.findIndex((h) => h.id === run.id);
  const entry = summarize(run);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  writeJson(path.join(d.base, 'history.json'), history.slice(-200));
}

export function summarize(run) {
  const rounds = run.rounds || [];
  const final = rounds.at(-1);
  return {
    id: run.id,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    rounds: rounds.length,
    total: final?.results.length || 0,
    passed: final?.results.filter((r) => r.status === 'passed').length || 0,
    verdict: run.verdict,
  };
}

export function loadHistory(root) {
  return readJson(path.join(dirs(root).base, 'history.json'), []);
}

export function loadRun(root, id) {
  return readJson(path.join(dirs(root).runs, `${id}.json`), null);
}

export function loadRuns(root, limit = 30) {
  return loadHistory(root).slice(-limit).map((h) => loadRun(root, h.id)).filter(Boolean);
}

export function loadState(root) {
  return readJson(path.join(dirs(root).base, 'state.json'), {});
}
export function saveState(root, state) {
  writeJson(path.join(dirs(root).base, 'state.json'), state);
}

// Latest known verdict per check, across all runs, for the proof page.
export function latestByCheck(runs) {
  const map = new Map();
  for (const run of runs) {
    for (const round of run.rounds || []) {
      for (const r of round.results) {
        const list = map.get(r.id) || [];
        list.push({ ...r, runId: run.id, at: round.finishedAt || run.finishedAt });
        map.set(r.id, list);
      }
    }
  }
  return map;
}

// Cheap fingerprint of the project's source so the Stop hook can skip
// re-verifying when nothing changed since the last green run.
const IGNORE = new Set(['.git', '.handoff', 'node_modules', '.next', 'dist', 'build', '.claude', '.vercel', '.cache', 'coverage']);
export function fingerprint(root, maxFiles = 4000) {
  const h = crypto.createHash('sha1');
  let count = 0;
  const walk = (dir, depth) => {
    if (depth > 6 || count > maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(p);
          h.update(`${path.relative(root, p)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
          count++;
        } catch {}
      }
    }
  };
  walk(root, 0);
  return h.digest('hex');
}
