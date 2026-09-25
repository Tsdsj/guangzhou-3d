import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
test('C02按56号地址厘清身份，59号油公司、三街2号新馆和北街73号不合并',()=>{
 assert.ok(fs.existsSync('data/evidence/building-identity-reviews.json'),'identity review required');
 const r=read('data/evidence/building-identity-reviews.json'),e=r.entities['osm:w352610288'];
 assert.equal(e.canonicalName,'正金银行旧址');
 assert.equal(e.address.street,'沙面大街');assert.equal(e.address.number,'56');
 assert.ok(e.historicalAliases.includes('美国领事馆旧馆'));
 assert.equal(e.identityStatus,'document-address-supported');
 assert.equal(e.excludedMatches.length,3);
 assert.ok(e.excludedMatches.some(x=>x.address==='沙面大街59号、沙面四街1、3号'));
 const source=read('docs/research/p0-2026-09-25/shamian-osm-buildings.geojson').features.find(f=>f.properties.id==='w352610288');
 assert.match(source.properties['description:en'],/Asian Oil Company/,'raw conflicting source must be preserved');
 assert.equal(createHash('sha256').update(fs.readFileSync(e.sourcePath)).digest('hex'),e.sourceSha256);
});
test('C02身份解决只进入独立正面研究，不升级高度、照片配准或生产状态',()=>{
 assert.ok(fs.existsSync('data/evidence/building-identity-reviews.json'),'identity review required');
 const e=read('data/evidence/building-identity-reviews.json').entities['osm:w352610288'];
 const c=read('docs/research/p3-building-screening/candidates.json').buildingCandidates.find(c=>c.id==='C02');
 assert.equal(c.identityStatus,e.identityStatus);assert.equal(c.name,e.canonicalName);
 assert.equal(c.productionEligible,false);assert.equal(c.measuredHeightM,null);
 assert.equal(e.photo.pixelRegistrationVerified,false);assert.equal(e.photo.currentAppearanceVerified,false);
 for(const id of e.evidenceIds)assert.ok(read('data/evidence/building-identity-reviews.json').sources[id].url.startsWith('https://'));
});
