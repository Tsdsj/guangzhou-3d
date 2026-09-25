import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCity } from '../src/world/data.js';

function localFetch(t, failEvidence = false, transformMeta = null) {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (failEvidence && String(url).includes('evidence')) return new Response('missing', { status: 404 });
    const bytes = fs.readFileSync(String(url).replace(/^\.\//, ''));
    return new Response(transformMeta && String(url).endsWith('guangzhou.json') ? JSON.stringify(transformMeta(JSON.parse(bytes))) : bytes);
  });
}

test('运行端可通过稳定ID查询三栋立面及样区拓扑，候选不会变成建筑', async (t) => {
  localFetch(t);
  const data = await loadCity();
  assert.equal(typeof data.loadEvidence, 'function');
  assert.equal(data.detailManifest?.tiles.length,3,'valid detail registry must be usable');
  await data.vegReady;
  assert.equal(data.evidenceStatus, 'idle', 'ordinary city loading must not fetch the evidence sidecar');
  const index = await data.evidenceReady;
  assert.equal(data.evidenceStatus, 'ready');
  assert.equal(index.getEntity('osm:w352610322').facades.length, 5);
  assert.equal(index.getNetwork('osmHuacheng').restrictions.length, 11);
  assert.equal(index.data.candidates.length, 63);
  assert.equal(data.nBuildings, 19823);
  assert.equal(data.buildingSourceIds.length, data.nBuildings);
  assert.ok(data.roads.every((r) => r.sourceId && index.getEntity(r.sourceId)));
  assert.equal(await data.loadEvidence(), index);
});

test('旧版城市数据仍可加载，不虚构源ID或请求不存在的证据包', async (t) => {
  localFetch(t, false, (meta) => {
    meta.version = 1; delete meta.renderSchemaVersion; delete meta.evidence; delete meta.sections.renderIdentity;
    return meta;
  });
  const data = await loadCity();
  await data.vegReady;
  assert.equal(data.evidenceStatus, 'unavailable');
  assert.equal(await data.evidenceReady, null);
  assert.deepEqual(data.buildingSourceIds, []);
  assert.ok(data.roads.every((r) => r.sourceId === null));
});

test('不认识的几何版本必须拒绝，不能按旧布局错误解码', async (t) => {
  localFetch(t, false, (meta) => ({ ...meta, renderSchemaVersion: 999 }));
  await assert.rejects(loadCity(), /Unsupported render schema/);
});

test('证据包加载失败不阻断原有场景和植被，失败原因可检查', async (t) => {
  localFetch(t, true);
  const data = await loadCity();
  assert.equal(typeof data.loadEvidence, 'function');
  await data.vegReady;
  const evidence = await data.evidenceReady;
  assert.equal(evidence, null);
  assert.equal(data.evidenceStatus, 'error');
  assert.match(data.evidenceError, /404/);
  assert.ok(data.trees && data.nBuildings > 0 && data.roads.length > 0);
});

test('精细片区清单缺失时基础城市仍完整加载',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url)=>String(url).includes('detail/manifest')?new Response('missing',{status:404}):new Response(fs.readFileSync(String(url).replace(/^\.\//,''))));
  const data=await loadCity();await data.vegReady;
  assert.equal(data.detailManifest,null);assert.match(data.detailManifestError,/404/);assert.equal(data.nBuildings,19823);assert.ok(data.trees);
});

test('坐标原点不匹配的精细清单不会接入错误位置',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url)=>{
    const bytes=fs.readFileSync(String(url).replace(/^\.\//,''));
    if(String(url).includes('detail/manifest')){const m=JSON.parse(bytes);m.coordinateSystem.origin.lon=0;return new Response(JSON.stringify(m));}
    return new Response(bytes);
  });
  const data=await loadCity();await data.vegReady;assert.equal(data.detailManifest,null);assert.equal(data.roads.length,12714);
});
test('基础快照变化后不会继续套用旧的精细落位清单',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url)=>{
    const bytes=fs.readFileSync(String(url).replace(/^\.\//,''));
    if(String(url).includes('detail/manifest')){const m=JSON.parse(bytes);m.baseOsmTimestamp='old-snapshot';return new Response(JSON.stringify(m));}
    return new Response(bytes);
  });
  const data=await loadCity();await data.vegReady;assert.equal(data.detailManifest,null);
});
test('不完整的精细块定义会回退，不在组装基础城市时崩溃',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url)=>{
    const bytes=fs.readFileSync(String(url).replace(/^\.\//,''));
    if(String(url).includes('detail/manifest')){const m=JSON.parse(bytes);delete m.tiles[0].buildings[0].replaceIds;return new Response(JSON.stringify(m));}
    return new Response(bytes);
  });
  const data=await loadCity();await data.vegReady;assert.equal(data.detailManifest,null);assert.ok(data.nBuildings>0);
});
