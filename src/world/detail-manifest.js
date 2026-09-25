// Validate the optional layer before any base-geometry partitioning occurs.
export function validateDetailManifest(manifest,meta){
  const origin=manifest?.coordinateSystem?.origin;
  if(manifest?.version!==1||!Array.isArray(manifest.tiles)||!['lon','lat','kx','kz'].every(k=>origin?.[k]===meta.origin[k]))throw new Error('Detail manifest version/origin mismatch');
  if(manifest.baseOsmTimestamp!==meta.osmTimestamp)throw new Error('Detail manifest snapshot mismatch');
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
  const ids=new Set(),slots=new Set();
  for(const tile of manifest.tiles){
    if(!tile.id||ids.has(tile.id)||!vector(tile.bounds,4)||tile.bounds[0]>=tile.bounds[2]||tile.bounds[1]>=tile.bounds[3]||!/^\.\/data\/detail\/[a-z0-9-]+\.json$/.test(tile.url))throw new Error('Invalid detail tile');
    ids.add(tile.id);
    if(tile.kind==='roads'){
      if(![0,1].includes(tile.slot)||slots.has(tile.slot)||!vector(tile.position,3))throw new Error('Invalid road detail slot');
      slots.add(tile.slot);
    }else if(tile.kind==='buildings'){
      if(!Array.isArray(tile.buildings))throw new Error('Invalid building detail list');
      for(const b of tile.buildings)if(!b.sourceId||!b.sampleId||!vector(b.position,3)||!vector(b.scale,3)||b.scale.some(s=>s<=0)||!Number.isFinite(b.rotationY)||!Array.isArray(b.replaceIds)||!b.replaceIds.length||!b.replaceIds.every(id=>typeof id==='string')||!Array.isArray(b.footprint)||b.footprint.length<3||!b.footprint.every(p=>vector(p,2)))throw new Error('Invalid building detail definition');
    }else throw new Error('Unknown detail tile kind');
  }
  return manifest;
}
