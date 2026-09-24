// 数据构建快照测试：build-city.mjs 是确定性的，同样的 data/raw/ 必须产出逐字节相同的结果。
// 有意修改构建逻辑后，用 UPDATE_SNAPSHOT=1 npm test 更新快照，并在提交说明里写明输出为何变化。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

const SNAP = new URL('./build.snapshot.json', import.meta.url);
const hasRaw = fs.existsSync('data/raw/roads.json');
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// 构建产物：元数据与各 gzip 数据文件
const OUTPUTS = (meta) => ['guangzhou.json', ...meta.files.map((f) => f.name)];

test('数据构建输出与快照一致', { skip: !hasRaw && '缺少 data/raw/（先运行 npm run fetch:osm）' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-build-'));
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', 'tools/build-city.mjs', '--out', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'guangzhou.json'), 'utf8'));
  const bins = meta.files.map((f) => zlib.gunzipSync(fs.readFileSync(path.join(dir, f.name))));
  meta.files.forEach((f, i) => assert.equal(bins[i].length, f.raw, `${f.name} 解压后大小不符`));
  // 结构检查：每个分段都落在所属数据文件范围内，关键统计量在合理区间
  for (const [name, s] of Object.entries(meta.sections)) {
    const bytes = globalThis[s.type].BYTES_PER_ELEMENT * s.length;
    assert.ok(s.offset % 4 === 0 && s.offset + bytes <= bins[s.file || 0].length, `分段 ${name} 越界`);
  }
  const st = meta.stats;
  assert.ok(st.buildings > 15000 && st.fill > 50000 && st.roads > 10000 && st.trees > 100000, JSON.stringify(st));
  assert.ok(meta.bridges.length >= 20 && meta.landmarks.length >= 10);

  const outputs = OUTPUTS(meta);
  const got = { stats: st, files: Object.fromEntries(outputs.map((f) => [f, sha(path.join(dir, f))])) };
  if (process.env.UPDATE_SNAPSHOT || !fs.existsSync(SNAP)) {
    fs.writeFileSync(SNAP, JSON.stringify(got, null, 2) + '\n');
    return;
  }
  const want = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  assert.deepEqual(got.stats, want.stats);
  for (const f of outputs) assert.equal(got.files[f], want.files[f], `${f} 与快照不同`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('仓库里的 data/ 与当前构建一致', { skip: !hasRaw && '缺少 data/raw/' }, () => {
  const want = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  for (const [f, h] of Object.entries(want.files)) assert.equal(sha(path.join('data', f)), h, `data/${f} 过期，运行 npm run build:data`);
});
