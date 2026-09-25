// Opt-in detail inspection and candidate staging. The default city never reads the staging manifest.
// ?detailTrial=inspect (legacy alias: c01c02, the pre-integration C01/C02 trial) loads
// data/detail/trial-manifest.json = default tiles + staged candidate tiles (trialOnly) and mounts
// controls for base/detail switching, injected load failure, retry and far release.
export function isDetailTrial(search){const v=new URLSearchParams(search).get('detailTrial');return v==='inspect'||v==='c01c02';}
export function resolveDetailAsset(tile,trial){
 if(tile.trialOnly&&(!trial?.enabled||!tile.buildings?.length||!tile.buildings.every(b=>typeof b.sampleId==='string')))throw new Error('Trial asset requires explicit opt-in');
 // Failure injection only exists in the opt-in mode and only for building tiles (fallback = base massing).
 const fail=!!(trial?.enabled&&trial.failLoads&&tile.kind==='buildings');
 return{url:fail?'./data/detail/trial-missing.json':tile.url,prototype:!!tile.trialOnly};
}
export const TRIAL_SCENES=[
 {id:'trial-far',group:'detail',name:'检查 · 远离释放',sub:'高空释放精细块，恢复基础体量',icon:'top',atmos:{timeOfDay:12.4,weather:'clear',haze:20,lightIntensity:100,exposure:100},cam:[113.2372,23.108,2400],tgt:[113.2372,23.110,0]},
];
