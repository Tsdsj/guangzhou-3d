async (page) => {
  // 暂存外立面研究样件：检查入口加载、树木暂隐（画面标注）的正面近景，另存一张保留树木的同机位画面。
  const OUT = '/Users/tt/projects/3D-guangzhou/docs/research/p3-building-expansion/renders/';
  const H = '/tools/acceptance/page-harness.js';
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('about:blank');
  await page.goto('http://localhost:5174/?detailTrial=inspect#scene=detail-specie', { waitUntil: 'load' });
  await page.evaluate(async (h) => (await import(h)).waitLoaded(), H);
  const payload = await page.evaluate(async () => (await fetch('./data/detail/trial-shamian-dajie.json')).json());
  const tile = await page.evaluate(() => window.__gz.D.detailManifest.tiles.find((t) => t.id === 'trial-shamian-dajie'));
  const shots = [];
  await page.click('#btn-collapse'); // 收起场景面板，保留树木暂隐提示
  for (const b of tile.buildings) {
    const s = payload.samples.buildings[b.sampleId];
    const zf = Math.max(...s.plan.map((p) => p[1]));
    b.width = s.width; b.midY = s.model.storeys.reduce((a, v) => a + v, 0) / 2;
    const r = await page.evaluate(async ([h, b, zf]) => {
      const m = await import(h); const g = window.__gz;
      const n = [Math.sin(b.rotationY), Math.cos(b.rotationY)];
      const fx = b.position[0] + n[0] * zf, fz = b.position[2] + n[1] * zf;
      g.setTier(0);
      g.view('detail-specie');
      while (g.rig.busy) await new Promise((r) => requestAnimationFrame(r));
      const gy = g.D.geo.height(fx, fz);
      const dist = Math.max(20, b.width * 1.15);
      g.camera.position.set(fx + n[0] * dist, gy + 6.5, fz + n[1] * dist);
      g.rig.controls.target.set(fx, gy + b.midY, fz);
      g.rig.controls.update();
      await m.waitDetail(['trial-shamian-dajie'], ['ready']);
      await m.sleep(1200);
      return { problems: m.invariantProblems(), snap: m.detailSnapshot().find((d) => d.id === 'trial-shamian-dajie') };
    }, [H, b, zf]);
    await page.evaluate(() => { window.__gz.world.setTreesHidden(true); document.getElementById('tree-inspection-note').hidden = false; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${b.sampleId}-trees-hidden.jpg`, type: 'jpeg', quality: 80 });
    await page.evaluate(() => { window.__gz.world.setTreesHidden(false); document.getElementById('tree-inspection-note').hidden = true; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${b.sampleId}-with-trees.jpg`, type: 'jpeg', quality: 80 });
    shots.push({ id: b.sampleId, ...r });
  }
  return { shots, errors };
}
