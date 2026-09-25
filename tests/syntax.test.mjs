import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Browser-only modules (bare 'three' imports, DOM) are not all imported by other tests;
// parse every one so an early error cannot reach the page unnoticed.
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.m?js$/.test(e.name)) files.push(p);
  }
};
for (const dir of ['src', 'prototypes', 'tools/acceptance']) walk(dir);
test('浏览器端与验收脚本全部可解析，不带语法级错误进入页面', () => {
  assert.ok(files.length > 30);
  const bad = [];
  for (const f of files) {
    if (f.endsWith('.pw.js')) continue; // Playwright function bodies, checked by wrapping below
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
  }
  for (const f of files.filter((f) => f.endsWith('.pw.js'))) {
    try { new Function(`return (${fs.readFileSync(f, 'utf8')})`); } catch (e) { bad.push(`${f}: ${e.message}`); }
  }
  assert.deepEqual(bad, []);
});
