async (page) => {
  // 默认主城验收（C01/C02 纳入后）：精细场景 × 昼 / 夜 / 雨，1440×900、画质档 0、固定机位。
  const OUT = '/Users/tt/projects/3D-guangzhou/docs/research/p3-acceptance/default/';
  const H = '/tools/acceptance/page-harness.js';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('about:blank');
  const t0 = Date.now();
  await page.goto('http://localhost:5174/#scene=overhead', { waitUntil: 'load' });
  const loadWait = await page.evaluate(async (h) => (await import(h)).waitLoaded(), H);
  const pageLoadMs = Date.now() - t0;
  const east = ['shamian'], west = ['shamian-west'];
  const scenes = [
    ['detail-bank', east], ['detail-indochine', east], ['detail-indochine-east', east], ['detail-lourdes', east],
    ['detail-christchurch', west], ['detail-specie', west], ['detail-shamian', east], ['detail-shamian-west', west],
    ['detail-huasui', ['huasui']], ['detail-huaxia', ['huaxia']],
  ];
  const variants = [['day', null], ['night', { timeOfDay: 21 }], ['rain', { timeOfDay: 15.2, weather: 'rain' }]];
  const results = [];
  for (const [scene, waitIds] of scenes) {
    for (const [v, atmos] of variants) {
      const label = `${scene}-${v}`;
      const r = await page.evaluate(async ([h, cfg]) => (await import(h)).shot(cfg), [H, { label, scene, atmos, waitIds, frames: 150 }]);
      await page.screenshot({ path: OUT + label + '.jpg', type: 'jpeg', quality: 78 });
      results.push({ label, h: r.bench.h, fps: r.bench.fps, p50: r.bench.p50, p95: r.bench.p95, calls: r.bench.calls, tris: r.bench.tris, geo: r.memory.geometries, tex: r.memory.textures, tier: r.bench.tier, problems: r.problems, active: r.detail.filter((d) => d.active).map((d) => d.id) });
    }
  }
  const res = await page.evaluate(async (h) => (await import(h)).resources('/data/'), H);
  return { pageLoadMs, loadWait, results, res };
}
