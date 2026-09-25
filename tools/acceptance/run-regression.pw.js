async (page) => {
  // 全部预设场景回归：加载、截图（隐藏界面）、帧时与绘制量；1440×900、画质档 0。电影漫游为动态路径，不计入。
  const OUT = '/Users/tt/projects/3D-guangzhou/docs/research/p3-acceptance/regression/';
  const H = '/tools/acceptance/page-harness.js';
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('about:blank');
  const t0 = Date.now();
  await page.goto('http://localhost:5174/', { waitUntil: 'load' });
  const loadWait = await page.evaluate(async (h) => (await import(h)).waitLoaded(), H);
  const firstLoadMs = Date.now() - t0;
  const ids = await page.evaluate(() => window.__gz.SCENES.filter((s) => !s.cinematic).map((s) => s.id));
  await page.keyboard.press('h');
  const rows = [];
  for (const [i, id] of ids.entries()) {
    const r = await page.evaluate(async ([h, cfg]) => (await import(h)).shot(cfg), [H, { label: id, scene: id, frames: 120, settle: 1500 }]);
    await page.screenshot({ path: `${OUT}${String(i + 1).padStart(2, '0')}-${id}.jpg`, type: 'jpeg', quality: 78 });
    rows.push({ id, h: r.bench.h, fps: r.bench.fps, p50: r.bench.p50, p95: r.bench.p95, calls: r.bench.calls, trisM: r.bench.tris, auxCalls: r.bench.auxCalls, tier: r.bench.tier, active: r.detail.filter((d) => d.active).map((d) => d.id), problems: r.problems });
  }
  await page.keyboard.press('h');
  const log = await page.evaluate(async (h) => (await import(h)).takeLog(), H);
  await page.evaluate((x) => { window.__regression = x; }, { firstLoadMs, loadWait, rows, errors, log });
  return { firstLoadMs, loadWait, rows, errors };
}
