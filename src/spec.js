// Parses handoff.md — the designer's spec.
//
// ---
// name: Sprout waitlist
// url: http://localhost:4173
// start: node server.js
// ---
// # Anything (context for the agent)
// ## Brand
// - Primary: #1F6F4A
// ## Checks
// - join-waitlist: Enter "ada@example.com" ... and verify ...
// - pricing [/pricing]: Click "Yearly" and verify ...
import fs from 'node:fs';
import path from 'node:path';

export const SPEC_FILE = 'handoff.md';

export function findSpec(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    const p = path.join(dir, SPEC_FILE);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-') || 'check';
}

function stripMd(s) {
  return s.replace(/\*\*|__/g, '').replace(/`/g, '').trim();
}

export function parseSpec(text, file = SPEC_FILE) {
  const spec = {
    file,
    name: '',
    url: '',
    start: '',
    meta: {},
    intro: '',
    brand: [],
    swatches: [],
    checks: [],
    raw: text,
  };

  let body = text.replace(/\r\n/g, '\n');
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (m) spec.meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    body = body.slice(fm[0].length);
  }
  spec.name = spec.meta.name || '';
  spec.url = spec.meta.url || '';
  spec.start = spec.meta.start || '';

  let section = 'intro';
  const introLines = [];
  const seen = new Set();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const title = h[2].toLowerCase();
      if (h[1].length === 1 && !spec.name) spec.name = stripMd(h[2]);
      if (/check|acceptance|criteria|flows?/.test(title)) section = 'checks';
      else if (/brand|style|design|visual/.test(title)) section = 'brand';
      else section = 'other';
      continue;
    }
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (section === 'checks' && li) {
      const item = stripMd(li[1]);
      // id [ /path ] : objective   |   id — objective   |   objective
      const m = item.match(/^([A-Za-z0-9][\w-]{0,40})\s*(?:\[([^\]]+)\])?\s*(?::|—|–|\s-\s)\s*(.+)$/);
      let id, route = '', objective;
      if (m) {
        id = m[1].toLowerCase();
        route = (m[2] || '').trim();
        objective = m[3].trim();
      } else {
        objective = item;
        id = slugify(item);
      }
      let unique = id, n = 2;
      while (seen.has(unique)) unique = `${id}-${n++}`;
      seen.add(unique);
      spec.checks.push({ id: unique, route, objective });
      continue;
    }
    if (section === 'brand' && li) {
      const item = stripMd(li[1]);
      spec.brand.push(item);
      const hexes = item.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
      const label = item.split(/[:—–]/)[0].trim();
      for (const hex of hexes) spec.swatches.push({ label, hex: hex.toUpperCase() });
      continue;
    }
    if (section === 'intro' && line.trim()) introLines.push(line.trim());
  }
  spec.intro = introLines.join(' ');
  return spec;
}

export function loadSpec(cwd = process.cwd()) {
  const file = findSpec(cwd);
  if (!file) {
    const err = new Error(`No ${SPEC_FILE} found. Run \`handoff init\` to create one.`);
    err.code = 'NO_SPEC';
    throw err;
  }
  const spec = parseSpec(fs.readFileSync(file, 'utf8'), file);
  spec.root = path.dirname(file);
  if (!spec.url) {
    const err = new Error(`${SPEC_FILE} needs a \`url:\` in its front matter (the page Kane should open).`);
    err.code = 'NO_URL';
    throw err;
  }
  if (!spec.checks.length) {
    const err = new Error(`${SPEC_FILE} has no checks. Add a "## Checks" list of plain-English flows.`);
    err.code = 'NO_CHECKS';
    throw err;
  }
  return spec;
}

export function checkUrl(spec, check) {
  if (!check.route) return spec.url;
  if (/^https?:\/\//i.test(check.route)) return check.route;
  try {
    return new URL(check.route, spec.url.endsWith('/') ? spec.url : spec.url + '/').toString();
  } catch {
    return spec.url;
  }
}
