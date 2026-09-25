import {TRIAL_TILE_IDS} from '../world/detail-trial.js';
export function mountDetailTrial(world,D,view){
 const root=document.createElement('section');root.id='detail-trial-controls';root.setAttribute('aria-label','隔离试落位验证');
 root.innerHTML='<strong>隔离试落位 · 尺寸估计</strong><p>仅本入口加载 C01/C02，未纳入默认主城。</p><div class="trial-buttons"><button class="act" data-trial="c01">C01 会堂</button><button class="act" data-trial="c02">C02 银行</button><button class="act" data-trial="far">远离释放</button><button class="act" data-trial="base">基础体量</button><button class="act" data-trial="new">精细样件</button><button class="act" data-trial="fail">模拟载入失败</button><button class="act" data-trial="retry">恢复并重载</button><a class="act" href="./#scene=detail-shamian">退出试验</a></div><output id="trial-evidence" aria-live="polite">等待场景进入…</output>';
 document.querySelector('.panel-head').after(root);
 const style=document.createElement('style');style.textContent='#detail-trial-controls{padding:12px 18px;border-bottom:1px solid var(--border);font-size:12px}#detail-trial-controls strong{color:var(--accent-2)}#detail-trial-controls p{color:var(--muted);margin:6px 0 10px;line-height:1.5}.trial-buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.trial-buttons .act{font-size:11px;height:31px;text-decoration:none;color:var(--text)}#trial-evidence{display:block;margin-top:8px;line-height:1.7;white-space:pre-line;font-size:11px;color:var(--text)}';document.head.append(style);
 const output=root.querySelector('output');let previous='';
 D.onDetailStatus=status=>{
  const entries=status.filter(e=>TRIAL_TILE_IDS.includes(e.id)).map(e=>({...e,fallbackVisible:world.detailFallbacks.get(e.id)?.visible??null,assetPresent:!!world.details?.entries.find(x=>x.tile.id===e.id)?.asset}));
  const encoded=JSON.stringify(entries);if(encoded===previous)return;previous=encoded;output.dataset.evidence=encoded;
  const stateName={idle:'未载入',loading:'载入中',ready:'就绪',cached:'已缓存',error:'载入失败'};
  if(!entries.length){output.textContent='试验清单不可用；基础城市保留。';return;}
  output.textContent=entries.map(e=>`${e.id==='trial-c01'?'C01':'C02'}：${stateName[e.state]} · ${e.active?'精细显示':'基础显示'} · 旧对象${e.fallbackVisible?'保留':'隐藏'}${e.error?'（'+e.error+'）':''}`).join('\n');
 };
 const setMode=mode=>{
  if(!world.details){output.textContent='试验清单不可用；基础城市保留。';return;}
  D.detailTrial.failLoads=mode==='fail';
  for(const id of TRIAL_TILE_IDS){
   if(mode==='base')world.details.setEnabled(id,false);
   else{if(mode==='fail'||mode==='retry')world.details.invalidate(id);world.details.setEnabled(id,true);}
  }
 };
 root.addEventListener('click',e=>{
  const action=e.target.closest('[data-trial]')?.dataset.trial;if(!action)return;
  if(['c01','c02','far'].includes(action))view('trial-'+action,true);else setMode(action);
 });
 D.onDetailStatus(world.details?.status()||[]);
}
