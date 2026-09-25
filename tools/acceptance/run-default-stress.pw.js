async (page) => {
  // 默认主城：快速切换、网络层真实 404 / 慢速 / 中途取消、反复加载释放与资源计数（按顶层分组普查几何）
  const OUT = '/Users/tt/projects/3D-guangzhou/docs/research/p3-acceptance/default/';
  const H = '/tools/acceptance/page-harness.js';
  const ev = (fn, arg) => page.evaluate(async ([h, a, f]) => (await import(h))[f](a), [H, arg, fn]);
  const view = (id) => page.evaluate((id) => window.__gz.view(id), id);
  const waitD = (ids, st) => page.evaluate(async ([h, ids, st]) => (await import(h)).waitDetail(ids, st), [H, ids, st]);
  await page.unrouteAll({ behavior: 'ignoreErrors' }); // 清掉此前运行遗留的网络拦截
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('about:blank');
  await page.goto('http://localhost:5174/#scene=overhead', { waitUntil: 'load' });
  await ev('waitLoaded');
  const ALL = ['shamian', 'shamian-west', 'huasui', 'huaxia'];
  const far = async () => {
    await view('overhead');
    await waitD(ALL, ['idle', 'error']); // 出错的块在远处保持 error，直到再次进入范围才重试
    await page.waitForTimeout(1200);
    return { memory: await ev('memory'), census: await ev('geometryCensus') };
  };
  const details = ['detail-bank', 'detail-indochine', 'detail-indochine-east', 'detail-lourdes', 'detail-christchurch', 'detail-specie', 'detail-shamian', 'detail-shamian-west', 'detail-huasui', 'detail-huaxia'];
  for (const id of [...details, 'baietan', 'shamian']) { await view(id); await page.waitForTimeout(900); }
  const m0 = await far();
  const instant = await ev('switchStress', { ids: [...details, 'baietan', 'overhead'], cycles: 60 });
  const m1 = await far();
  const clicked = await ev('switchStress', { ids: [...details, 'baietan', 'overhead'], cycles: 20, minDwell: 250, maxDwell: 2600, click: true, seed: 23 });
  const m2 = await far();
  // 1) 真实 HTTP 404（网络层注入，页面代码不知情）
  await page.route('**/data/detail/shamian-west.json', (r) => r.fulfill({ status: 404, body: 'injected' }));
  await view('detail-specie');
  await waitD(['shamian-west'], ['error']);
  const fail404 = { snap: (await ev('detailSnapshot')).filter((d) => d.id === 'shamian-west'), problems: await ev('invariantProblems'), status: await page.evaluate(() => document.getElementById('detail-status').textContent) };
  await page.screenshot({ path: OUT + 'fault-404-specie.jpg', type: 'jpeg', quality: 78 });
  await page.unroute('**/data/detail/shamian-west.json');
  // 留在原地不会自动重试；离开并返回后重新请求
  await page.waitForTimeout(1500);
  const stillError = (await ev('detailSnapshot')).find((d) => d.id === 'shamian-west').state;
  await far();
  await view('detail-specie');
  await waitD(['shamian-west'], ['ready']);
  const recovered = (await ev('detailSnapshot')).find((d) => d.id === 'shamian-west');
  // 2) 慢速响应：加载期间基础体量必须一直可见
  await far();
  await page.route('**/data/detail/shamian-west.json', async (r) => { await page.waitForTimeout(2500); await r.continue().catch(() => {}); });
  await view('detail-specie');
  const slow = await ev('watchInvariants', 3800);
  // 3) 加载中途离开：请求取消，不留下资产
  await far();
  await view('detail-specie');
  await page.waitForTimeout(400);
  const midState = (await ev('detailSnapshot')).find((d) => d.id === 'shamian-west').state;
  const abortFar = await far();
  await page.unroute('**/data/detail/shamian-west.json');
  // 4) 反复加载 / 释放 10 次
  const cycles = [];
  for (let i = 0; i < 10; i++) {
    await view(i % 2 ? 'detail-specie' : 'detail-bank');
    await waitD(i % 2 ? ['shamian-west'] : ['shamian'], ['ready']);
    await page.waitForTimeout(300);
    const f = await far();
    cycles.push({ i, geometries: f.memory.geometries, textures: f.memory.textures, detailMeshes: f.memory.detailMeshes, cachedAssets: f.memory.cachedAssets, censusTotal: f.census.total });
  }
  const pick = (r) => ({ frames: r.frames, elapsedMs: r.elapsedMs, violations: r.violations.length, firstViolations: r.violations.slice(0, 3), stateFrames: r.stateFrames });
  const result = { m0, m1, m2, instant: pick(instant), clicked: pick(clicked), fail404, stillErrorWithoutLeaving: stillError, recovered, slow, midState, abortFar, cycles };
  await page.evaluate((r) => { window.__defaultStress = r; }, result);
  return { m: [m0, m1, m2].map((m) => [m.memory.geometries, m.memory.textures, m.memory.detailMeshes, m.census.total]), instant: pick(instant).violations, clicked: pick(clicked).violations, fail404, stillError, recovered: [recovered.state, recovered.fallbackVisible, recovered.assetVisible], slowViolations: slow.violations.length, slowStates: slow.states, midState, abortFar: [abortFar.memory.detailMeshes, abortFar.memory.cachedAssets, abortFar.memory.geometries], cycles };
}
