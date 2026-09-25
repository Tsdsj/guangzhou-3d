export const TRIAL_TILE_IDS=['trial-c01','trial-c02'];
export function isDetailTrial(search){return new URLSearchParams(search).get('detailTrial')==='c01c02';}
export function resolveDetailAsset(tile,trial){
 if(!tile.trialOnly)return{url:tile.url,prototype:false};
 if(!trial?.enabled||!TRIAL_TILE_IDS.includes(tile.id)||!tile.buildings?.every(b=>['C01','C02'].includes(b.sampleId)))throw new Error('Trial asset requires explicit opt-in');
 return{url:trial.failLoads?'./data/detail/trial-missing.json':tile.url,prototype:true};
}
export const TRIAL_SCENES=[
 {id:'trial-c01',group:'detail',name:'试落位 · 沙面会堂',sub:'隔离试验 · 高度与细部尺寸估计',icon:'street',atmos:{timeOfDay:12.4,weather:'clear',haze:20,lightIntensity:100,exposure:100},cam:[113.23655,23.10912,24],tgt:[113.23628,23.10962,8]},
 {id:'trial-c02',group:'detail',name:'试落位 · 正金银行',sub:'隔离试验 · 高度与细部尺寸估计',icon:'street',atmos:{timeOfDay:12.4,weather:'clear',haze:20,lightIntensity:100,exposure:100},cam:[113.23805,23.10953,25],tgt:[113.23780,23.11016,8]},
 {id:'trial-far',group:'detail',name:'试落位 · 远离释放',sub:'高空释放精细样件，恢复基础体量',icon:'top',atmos:{timeOfDay:12.4,weather:'clear',haze:20,lightIntensity:100,exposure:100},cam:[113.2372,23.108,2400],tgt:[113.2372,23.110,0]},
];
