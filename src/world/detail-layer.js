import * as THREE from 'three';
import {resolveDetailAsset} from './detail-trial.js';
import { DetailStream } from './detail-stream.js';
import { U,patchMaterial } from '../scene/atmosphere.js';

export function createDetailLayer(world,D){
  const manifest=D.detailManifest;if(!manifest)return null;
  const root=new THREE.Group();root.name='high-detail';world.root.add(root);
  const tiles=new Map(manifest.tiles.map(t=>[t.id,t]));
  const dispose=asset=>{
    asset.parent?.remove(asset);
    asset.traverse(o=>{if(o.isMesh||o.isLine){o.geometry.dispose();o.material.map?.dispose();o.material.dispose();}});
  };
  const stream=new DetailStream(manifest.tiles,{
    async load(tile,signal){
      const spec=resolveDetailAsset(tile,D.detailTrial);
      const [response,module,labelModule]=await Promise.all([fetch(spec.url,{signal}),spec.prototype?import('../../prototypes/p2/models.js'):import('../models/detail-models.js'),import('../models/sample-labels.js')]);
      if(!response.ok)throw new Error(`Detail ${tile.id}: HTTP ${response.status}`);
      const payload=await response.json();if(payload.version!==1)throw new Error('Unsupported detail payload');
      if(spec.prototype&&payload.trialOnly!==true)throw new Error('Trial payload marker missing');
      const group=new THREE.Group();group.name=`detail-${tile.id}`;
      try{
        if(tile.kind==='buildings')for(const placement of tile.buildings){
          if(signal.aborted)throw new DOMException('Aborted','AbortError');
          if(payload.samples?.buildings?.[placement.sampleId]?.sourceId!==placement.sourceId)throw new Error('Detail source identity mismatch');
          const sample=module.buildSample(placement.sampleId,payload.samples);const g=sample.group;
          group.add(g);
          for(const label of sample.labels||[])g.add(labelModule.createSampleLabel(label,{lit:true}));
          g.position.set(...placement.position);g.position.y=D.geo.height(g.position.x,g.position.z);
          g.rotation.y=placement.rotationY;g.scale.set(...placement.scale);g.userData.sourceId=placement.sourceId;
          await new Promise(resolve=>requestAnimationFrame(resolve));
        }else{
          if(payload.samples?.road?.production!==true)throw new Error('Road payload is not a production tile');
          const sample=module.buildSample('J1',payload.samples);group.add(sample.group);group.position.set(...tile.position);
        }
        group.traverse(o=>{if(o.isMesh){
          patchMaterial(o.material,{key:'detail-standard'});o.material.envMapIntensity=.8;
          if(tile.kind==='roads'&&o.userData.materialTag==='paving')o.material.color.multiplyScalar(.55);
          if(o.userData.evidence==='unknown')o.material.color.multiplyScalar(.65);
          if(tile.kind==='roads'){o.layers.set(1);o.renderOrder=o.userData.materialTag==='paint'?4:3;}
        }});
        return group;
      }catch(e){dispose(group);throw e;}
    },
    activate(id,asset){
      const tile=tiles.get(id);if(!asset.parent)root.add(asset);asset.visible=true;
      const fallback=world.detailFallbacks.get(id);if(fallback)fallback.visible=false;
      if(tile.kind==='roads'){U.uDetailRoadBoxes.value[tile.slot].set(...tile.bounds);U.uDetailRoadActive.value.setComponent(tile.slot,1);}
      world.detailRoadPaint.visible=U.uDetailRoadActive.value.x>0||U.uDetailRoadActive.value.y>0;
      world.detailDirty=true;
    },
    deactivate(id,asset){
      asset.visible=false;const fallback=world.detailFallbacks.get(id);if(fallback)fallback.visible=true;
      const tile=tiles.get(id);if(tile.kind==='roads')U.uDetailRoadActive.value.setComponent(tile.slot,0);
      world.detailRoadPaint.visible=U.uDetailRoadActive.value.x>0||U.uDetailRoadActive.value.y>0;
      world.detailDirty=true;
    },dispose,
    change(status){
      D.onDetailStatus?.(status);
      const activeKey=status.filter(s=>s.active).map(s=>s.id).join('|');
      if(activeKey!==D.detailActiveKey){D.detailActiveKey=activeKey;D.onDetailActive?.(new Set(status.filter(s=>s.active).map(s=>s.id)));}
      const el=document.getElementById('detail-status');if(!el)return;
      const encoded=JSON.stringify(status);if(el.dataset.state===encoded)return;el.dataset.state=encoded;
      const active=status.filter(s=>s.active),loading=status.some(s=>s.state==='loading'),error=status.some(s=>s.desired&&s.state==='error');
      el.textContent=loading?'精细片区加载中 · 基础场景仍可浏览':error?'精细片区未能载入 · 已保留基础模型':active.length?`精细片区 ${active.length} / ${status.length} · 外观参考，尺寸估计`:'精细片区按位置加载 · 尺寸估计';
      el.title=JSON.stringify({status,groupedBuildingRecords:D.buildingSourceIds.filter(id=>D.detailGroups.sourceTiles.has(id)).length,groupedFillRecords:D.detailGroups.fillTiles.size});
    },
  });
  return stream;
}
