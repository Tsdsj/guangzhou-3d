// 浏览器内验收工具：由 Playwright 以 import('/tools/acceptance/page-harness.js') 载入，读取 window.__gz。
// 只读取与切换已有功能（场景、时间天气、精细块开关、故障注入），不修改城市数据或模型。
// 结果是本机浏览器的实测记录，不代表手机或其他 GPU 的性能。
const gz = () => {
  if (!window.__gz) throw new Error('window.__gz unavailable');
  return window.__gz;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const log = (window.__acceptanceLog ||= []);

export async function waitLoaded(timeout = 90000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const loader = document.getElementById('loader');
    const g = window.__gz;
    if (loader?.classList.contains('done') && g?.world?.treeBB?.length > 0 && g.world.details !== undefined) return Math.round(performance.now() - t0);
    await sleep(100);
  }
  throw new Error('city did not finish loading');
}

// 每个精细块：状态、资产是否存在 / 可见、基础回退组是否可见
export function detailSnapshot() {
  const w = gz().world;
  if (!w.details) return [];
  return w.details.status().map((s) => {
    const e = w.details.entries.find((x) => x.tile.id === s.id);
    const fb = w.detailFallbacks.get(s.id);
    return {
      ...s,
      kind: e.tile.kind,
      assetPresent: !!e.asset,
      assetVisible: !!(e.asset && e.asset.visible && e.asset.parent),
      fallbackVisible: fb ? fb.visible : null,
    };
  });
}

// 建筑块必须“恰好一种表示可见”：同时可见=重复叠加，都不可见=空洞
export function invariantProblems() {
  const problems = [];
  for (const s of detailSnapshot()) {
    if (s.kind === 'buildings') {
      if (s.assetVisible && s.fallbackVisible) problems.push(`${s.id}:both-visible`);
      if (!s.assetVisible && !s.fallbackVisible) problems.push(`${s.id}:hole`);
    }
    if (s.active !== s.assetVisible) problems.push(`${s.id}:active-mismatch`);
    if (s.state === 'ready' && !s.assetPresent) problems.push(`${s.id}:ready-without-asset`);
  }
  return problems;
}

export function memory() {
  const g = gz();
  const r = g.renderer.info;
  const hd = g.world.root.getObjectByName('high-detail');
  let detailMeshes = 0;
  hd?.traverse((o) => {
    if (o.isMesh) detailMeshes++;
  });
  return {
    geometries: r.memory.geometries,
    textures: r.memory.textures,
    programs: r.programs?.length ?? null,
    detailRootChildren: hd ? hd.children.length : null,
    detailMeshes,
    cachedAssets: g.world.details ? g.world.details.entries.filter((e) => e.asset).length : 0,
    heapUsed: performance.memory?.usedJSHeapSize ?? null,
  };
}

export async function waitDetail(ids, states = ['ready'], timeout = 20000) {
  const t0 = performance.now();
  for (;;) {
    const snap = detailSnapshot();
    const ok = ids.every((id) => states.includes(snap.find((s) => s.id === id)?.state));
    if (ok) return Math.round(performance.now() - t0);
    if (performance.now() - t0 > timeout) throw new Error(`detail tiles not ${states}: ${JSON.stringify(snap.filter((s) => ids.includes(s.id)))}`);
    await frame();
  }
}

// 等到没有精细块处于加载中（任何场景通用）
export async function waitNoLoading(timeout = 20000) {
  const t0 = performance.now();
  while (detailSnapshot().some((s) => s.state === 'loading')) {
    if (performance.now() - t0 > timeout) throw new Error('detail tiles still loading');
    await frame();
  }
  return Math.round(performance.now() - t0);
}

export function resources(filter = '/data/') {
  return performance
    .getEntriesByType('resource')
    .filter((e) => e.name.includes(filter))
    .map((e) => ({
      name: new URL(e.name).pathname,
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      decodedBodySize: e.decodedBodySize,
      durationMs: Math.round(e.duration),
    }));
}

// 固定机位测帧：先切场景与时间天气，等精细块就绪，再用 __gz.bench 取样（bench 期间暂停自动画质调整）
export async function shot({ label, scene, atmos = null, waitIds = [], waitStates = ['ready'], frames = 150, settle = 1500, tier = 0 }) {
  const g = gz();
  g.setTier(tier);
  g.view(scene);
  while (g.rig.busy) await frame();
  if (atmos) for (const [k, v] of Object.entries(atmos)) g.set(k, v);
  const waitMs = waitIds.length ? await waitDetail(waitIds, waitStates) : await waitNoLoading();
  await sleep(settle);
  const [row] = await g.bench({ ids: [scene], frames, settle: 600, atmos });
  const result = {
    label,
    scene,
    atmos: { ...g.params },
    waitDetailMs: waitMs,
    bench: row,
    viewport: [innerWidth, innerHeight, devicePixelRatio, g.renderer.getPixelRatio()],
    detail: detailSnapshot(),
    problems: invariantProblems(),
    memory: memory(),
    status: document.getElementById('detail-status')?.textContent ?? null,
  };
  log.push({ kind: 'shot', ...result });
  return result;
}

// 快速切换：随机短停留在若干场景之间跳转，每帧检查“恰好一种表示可见”
export async function switchStress({ ids, cycles = 30, minDwell = 60, maxDwell = 450, seed = 7, click = false }) {
  const g = gz();
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const violations = [];
  let frames = 0;
  const states = new Map();
  let running = true;
  const watch = (async () => {
    while (running) {
      await frame();
      frames++;
      const p = invariantProblems();
      if (p.length && violations.length < 50) violations.push({ frame: frames, p });
      for (const d of detailSnapshot()) {
        const k = `${d.id}:${d.state}`;
        states.set(k, (states.get(k) || 0) + 1);
      }
    }
  })();
  const t0 = performance.now();
  for (let i = 0; i < cycles; i++) {
    const id = ids[Math.floor(rnd() * ids.length)];
    // click=true 走面板按钮（带飞行过渡，与用户操作一致）；否则立即落位
    if (click) document.querySelector(`button.scene[data-id="${id}"]`).click();
    else g.view(id);
    await sleep(minDwell + rnd() * (maxDwell - minDwell));
  }
  running = false;
  await watch;
  const result = { kind: 'switchStress', click, ids, cycles, frames, elapsedMs: Math.round(performance.now() - t0), violations, stateFrames: Object.fromEntries(states) };
  log.push(result);
  return result;
}

// 反复“故障—恢复”“基础—精细”循环（仅隔离试验入口可用），检查资源计数是否回到原值
export async function trialCycles({ cycles = 8, ids = null }) {
  const root = document.getElementById('detail-trial-controls');
  if (!root) throw new Error('trial controls absent');
  const click = (name) => root.querySelector(`[data-trial="${name}"]`).click();
  const g = gz();
  // Default: every building tile that is currently wanted at this camera.
  ids ||= detailSnapshot().filter((d) => d.kind === 'buildings' && d.desired).map((d) => d.id);
  const rows = [];
  for (let i = 0; i < cycles; i++) {
    click('fail');
    await waitDetail(ids, ['error']);
    const failSnap = detailSnapshot().filter((d) => ids.includes(d.id));
    const failProblems = invariantProblems();
    click('retry');
    await waitDetail(ids, ['ready']);
    click('base');
    await waitDetail(ids, ['cached']);
    const baseProblems = invariantProblems();
    click('new');
    await waitDetail(ids, ['ready']);
    rows.push({ i, failStates: failSnap.map((d) => [d.id, d.state, d.fallbackVisible, d.assetPresent]), failProblems, baseProblems, readyProblems: invariantProblems(), memory: memory() });
  }
  const result = { kind: 'trialCycles', cycles, rows, finalStatus: g.world.details.status() };
  log.push(result);
  return result;
}

// 在给定时长内逐帧检查“恰好一种表示可见”，并记录各块出现过的状态
export async function watchInvariants(ms = 3000) {
  const t0 = performance.now();
  const violations = [];
  const states = new Map();
  let frames = 0;
  while (performance.now() - t0 < ms) {
    await frame();
    frames++;
    const p = invariantProblems();
    if (p.length && violations.length < 50) violations.push({ frame: frames, p });
    for (const d of detailSnapshot()) {
      const k = `${d.id}:${d.state}:${d.assetVisible ? 'detail' : d.fallbackVisible ? 'base' : 'none'}`;
      states.set(k, (states.get(k) || 0) + 1);
    }
  }
  return { frames, violations, states: Object.fromEntries(states) };
}

// 场景图中仍被引用的几何按顶层分组计数，用于判断资源计数的增长来自哪一部分（树木 LOD、车流、精细块…）
export function geometryCensus() {
  const g = gz();
  const out = {};
  const seen = new Set();
  for (const [i, top] of g.world.root.children.entries()) {
    const key = `${i}:${top.name || top.type}`;
    top.traverse((o) => {
      if ((o.isMesh || o.isLine || o.isPoints) && o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        out[key] = (out[key] || 0) + 1;
      }
    });
  }
  return { total: seen.size, byGroup: out };
}

export function takeLog() {
  return log.splice(0);
}
