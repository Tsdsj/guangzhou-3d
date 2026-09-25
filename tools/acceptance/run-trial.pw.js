async (page) => {
  // C01/C02 隔离试落位验收：固定 1440×900、画质档 0、固定机位；昼 / 夜 / 雨 × 近景 / 俯视 + 远离释放
  const OUT = '/Users/tt/projects/3D-guangzhou/docs/research/p3-acceptance/trial/';
  const H = '/tools/acceptance/page-harness.js';
  await page.setViewportSize({ width: 1440, height: 900 });
  const t0 = Date.now();
  // 先离开再进入，保证整页重新加载（仅改 hash 不会重新加载模块与数据）
  await page.goto('about:blank');
  await page.goto('http://localhost:5174/?detailTrial=c01c02#scene=trial-far', { waitUntil: 'load' });
  const loadWait = await page.evaluate(async (h) => (await import(h)).waitLoaded(), H);
  const pageLoadMs = Date.now() - t0;
  const T = ['trial-c01', 'trial-c02'];
  const night = { timeOfDay: 21 };
  const rain = { timeOfDay: 15.2, weather: 'rain' };
  const shots = [];
  for (const [view, scene] of [['c01', 'trial-c01'], ['c02', 'trial-c02'], ['overview', 'trial-overview']]) {
    shots.push({ label: `${view}-day`, scene, waitIds: T });
    shots.push({ label: `${view}-night`, scene, atmos: night, waitIds: T });
    shots.push({ label: `${view}-rain`, scene, atmos: rain, waitIds: T });
  }
  shots.push({ label: 'far-release', scene: 'trial-far', waitIds: T, waitStates: ['idle'] });
  const results = [];
  for (const s of shots) {
    const r = await page.evaluate(async ([h, cfg]) => (await import(h)).shot(cfg), [H, s]);
    await page.screenshot({ path: OUT + s.label + '.jpg', type: 'jpeg', quality: 80 });
    results.push({ label: r.label, h: r.bench.h, fps: r.bench.fps, p50: r.bench.p50, p95: r.bench.p95, calls: r.bench.calls, tris: r.bench.tris, geo: r.memory.geometries, tex: r.memory.textures, tier: r.bench.tier, problems: r.problems, states: r.detail.filter((d) => T.includes(d.id)).map((d) => d.state) });
  }
  const res = await page.evaluate(async (h) => (await import(h)).resources('/data/'), H);
  return { pageLoadMs, loadWait, results, res };
}
