#!/usr/bin/env node
// Test double for `claude -p --output-format stream-json` (tests only).
// Reads the brief on stdin and applies the fixes a real agent would make.
import fs from 'node:fs';
import path from 'node:path';
let brief = '';
process.stdin.on('data', (d) => (brief += d));
process.stdin.on('end', () => {
  const file = path.join(process.cwd(), 'public', 'app.js');
  let src = fs.readFileSync(file, 'utf8');
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: 'system', subtype: 'init' });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: file } }] } });
  if (brief.includes('reject-bad-email')) src = src.replace("return value.includes('@');", 'return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(value);');
  if (brief.includes('yearly-pricing')) src = src.replace('`$${MONTHLY * 12}`', '`$${MONTHLY * 12 * 0.8}`');
  fs.writeFileSync(file, src);
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } });
  out({ type: 'result', result: 'Tightened email validation to require a domain and applied the 20% yearly discount ($48).', total_cost_usd: 0.04 });
});
