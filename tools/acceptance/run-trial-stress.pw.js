async (page) => {
  // 快速切换、反复加载/故障回退与资源计数；以及同机位“基础体量 vs 精细样件”的帧时对照
  const H = '/tools/acceptance/page-harness.js';
  const ev = (fn, arg) => page.evaluate(async ([h, a, f]) => { const m = await import(h); return m[f](a); }, [H, arg, fn]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('about:blank');
  await page.goto('http://localhost:5174/?detailTrial=c01c02#scene=trial-far', { waitUntil: 'load' });
  await ev('waitLoaded');
  const T = ['trial-c01', 'trial-c02'];
  const far = async () => {
    await page.evaluate(() => window.__gz.view('trial-far'));
    await page.evaluate(async ([h, ids]) => (await import(h)).waitDetail(ids, ['idle']), [H, [...T, 'shamian']]);
    await page.waitForTimeout(1500);
    return ev('memory');
  };
  // 预热：各机位走一遍，让树木 / 车流等其他按距离缓存稳定
  for (const s of ['trial-c01', 'trial-c02', 'trial-overview', 'detail-shamian']) {
    await page.evaluate((id) => window.__gz.view(id), s);
    await page.waitForTimeout(1200);
  }
  const m0 = await far();
  const instant = await ev('switchStress', { ids: ['trial-c01', 'trial-c02', 'trial-overview', 'trial-far', 'detail-shamian'], cycles: 40 });
  const m1 = await far();
  const clicked = await ev('switchStress', { ids: ['trial-c01', 'trial-c02', 'trial-overview', 'trial-far', 'detail-shamian'], cycles: 16, minDwell: 200, maxDwell: 2600, click: true, seed: 11 });
  const m2 = await far();
  await page.evaluate(() => window.__gz.view('trial-c02'));
  await page.evaluate(async ([h, ids]) => (await import(h)).waitDetail(ids, ['ready']), [H, T]);
  const cycles = await ev('trialCycles', { cycles: 6 });
  const m3 = await far();
  // 同机位 A/B：基础体量（旧对象）与精细样件
  const ab = [];
  for (const scene of ['trial-c01', 'trial-c02', 'trial-overview']) {
    for (const mode of ['base', 'new']) {
      await page.evaluate((id) => window.__gz.view(id), scene);
      await page.click(`[data-trial="${mode}"]`);
      await page.evaluate(async ([h, ids, st]) => (await import(h)).waitDetail(ids, st), [H, T, mode === 'base' ? ['cached', 'idle'] : ['ready']]);
      await page.waitForTimeout(1200);
      const [row] = await page.evaluate(async (id) => window.__gz.bench({ ids: [id], frames: 150, settle: 800 }), scene);
      ab.push({ scene, mode, fps: row.fps, p50: row.p50, p95: row.p95, calls: row.calls, tris: row.tris });
    }
  }
  const m4 = await far();
  const pick = (r) => ({ frames: r.frames, elapsedMs: r.elapsedMs, violations: r.violations.length, firstViolations: r.violations.slice(0, 3), stateFrames: r.stateFrames });
  return { memory: { m0, m1, m2, m3, m4 }, instant: pick(instant), clicked: pick(clicked), cycles: cycles.rows.map((r) => ({ i: r.i, fail: r.failStates, p: [...r.failProblems, ...r.baseProblems, ...r.readyProblems], geo: r.memory.geometries, tex: r.memory.textures, meshes: r.memory.detailMeshes })), ab };
}
