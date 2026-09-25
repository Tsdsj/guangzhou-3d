import { StudyViewer } from './scene.js';
const $=id=>document.getElementById(id);
const catalog={
  C02:{title:'正金银行旧址',index:'BUILDING / 07',photos:['C02-b','C02-a','C02-plaque'],description:'按2021/2023照片补齐双圆柱、双方柱和左翼窗组；三大拱与后退入口保留，侧后面仍简化。',unknowns:'高度、廊深、柱距及侧后面',caution:'总高16.4m、入口后退2.2m均为展示估计；照片未做像素配准，源轮廓对齐不等于现实1:1。',note:'沙面大街56号身份及美国领事馆旧馆别名有公开资料支持；原OSM的亚细亚火油描述未用于建模。2021照片及铭牌补充双柱、左翼与56号身份；照片年代不同，完整屋顶、隐藏面和2026现状未核。'},
  C01:{title:'基督教沙面会堂',index:'BUILDING / 06',photos:['C01-c','C01-b','C01-a','C01-d','C01-e'],description:'南侧拱门与钟塔、北侧三联彩窗分别建模；保留源轮廓的南端凸出，补入北段两侧各两个拱窗，南段仍待核。',unknowns:'绝对高度、南段窗组、屋顶和门廊尺度',caution:'照片分别摄于2009、2014、2023、2026年，不是同期完整复原。19.4m总高为展示估计；南端源轮廓与照片门廊宽度的对应仍待测绘核实。',note:'2026年三联彩窗照片位于北侧端墙，上轮称主立面不准确，已纠正。源轮廓南端凸出与2023年入口钟塔照片相对应，但未完成像素级量测。北段侧窗参考2009室内照片，位置、尺寸及外部收口待核，未扩展为整面窗组。身份由教会介绍和文物局60号地址资料交叉支持；没有加入主城替换。'},
  S1:{title:'春—夏广场连廊',index:'STRUCTURE / 05',photos:['R6'],description:'按共享建筑节点保持源线位与约44.16m端点跨度；照片支持玻璃围护、框架和实体底板。可剖开检查内部贯通。',unknowns:'桥面标高、廊宽、门洞、背面和屋顶',caution:'桥面6.5m、廊宽6m、内部高3.2m均为比例假设；照片对应尚属初步匹配，不代表1:1还原。',note:'OSM两端与春、夏广场轮廓共享节点，不证明实际门洞或室内通行。灰色地面仅示建筑轮廓片段；平地是观察基准。R6相机元数据在源线北侧，但未完成像素配准。2013年现场报道提供春端三楼的历史线索，夏端楼层与现状待核。layer=1不换算米。'},
  B1:{title:'台湾银行广州支行旧址',index:'BUILDING / 01',photos:['B1-b','B1-d','B1-c','B1-a'],description:'首层门窗、后退柱廊、凹槽柱与门头；补充首层檐带花环，纹饰排布和尺寸仍有估计。',unknowns:'背面、完整屋顶、柱距与高度',caution:'参考跨越 2012—2021 年；不可视为同期完整复原。',note:'首层檐带参考B1-b/c/d，左段可辨花环节奏；右段排布有对称推定。侧面与背面保持简化体量。'},
  B2:{title:'沙面一街 3 号',index:'BUILDING / 02',photos:['B2-c','B2-a','B2-b'],description:'新增长边中部开放柱廊与四层拱廊；短边保留五开间照片结构，檐口沿用20.6m文献约束。',unknowns:'廊深、精确方位、背面及现状改动',caution:'柱廊参考2012年照片，深度为估计；20.6m是文献檐高，不能当作总高或现状实测。',note:'长边柱廊按主入口所在沙面一街推定在东侧，转角照片补充其与五开间短边的相邻关系；F0仍保留北侧暂定标记。2012照片GPS偏离样区约1.56km，已排除作定位依据。'},
  B3:{title:'露德圣母堂',index:'BUILDING / 03',photos:['B3-a','B3-b'],description:'钟塔和侧窗的红棕百叶沿尖拱、圆窗收口；院落侧片段改为两组窗，保留未覆盖的后段。',unknowns:'塔高、百叶尺寸、背面、屋顶坡度',caution:'钟塔高度为比例估计；院落前段按整面开间间距截取，间距仍待独立核实。',note:'主面参考2026年，院落参考2025年。修正了片段压缩整面五组窗的问题；未知后段未补造窗户。P1中该源对象没有单一直接渲染记录，体量对照不可用。'},
  J1:{title:'花城大道 × 华穗路',index:'JUNCTION / 04',photos:['R3','R4','R1'],description:'保留共享路面、8条过街路径与四条禁止掉头关系；本观察框的过街way缺少标线依据，暂不生成斑马线。',unknowns:'路幅、缘石、渐变段和现状标线',caution:'没画标线不表示现实中没有标线。路幅、缘石和信号构件仍为假设；可开启节点线位检查过街路径。',note:'过街位置与信号灯标签不能单独证明标线存在。显式标线冲突或缺失时保留路线并待核；crossing:markings=yes也不能独立证明具体条纹样式。'},
};
let viewer,data,current='B1',photoIndex=0;
function viewName(v){if(v==='side')return '北段侧窗 · 位置估计';if(current==='C01'&&v==='front')return '南侧入口';if(current==='C01'&&v==='rear')return '北侧彩窗面';if(current==='S1'&&v==='front')return '北侧 · 朝向推定';if(current==='S1'&&v==='rear')return '南侧 · 未覆盖';return{front:'正面视图',corner:'转角视图',aerial:'俯视图',rear:'后侧 · 未覆盖面',detail:'细部观察',free:'自由视角'}[v];}
function updateNote(){
  $('stage-note').textContent=viewer.options.baseline?'体量对照：高度取自 P1 渲染记录，外形简化为盒体':current==='J1'?'过街路径保留；缺证标线待核，不表示现实中没有标线':viewer.view==='rear'?'未覆盖面保持简化，不代表真实背面':'照片支持可见结构；高度与细部尺寸为估计';
  if(current==='C02')$('stage-note').textContent='正面参考2021/2023照片 · 双柱有据，柱距与廊深估计';
  if(current==='C01')$('stage-note').textContent='南侧入口 / 北侧彩窗 · 高度与细部尺寸估计；北段侧窗位置估计；灰色南段待核';
  if(current==='S1')$('stage-note').textContent='独立比例假设 · 桥面高、廊宽未测；灰色区域为建筑轮廓片段';
  if(current==='B2'&&!viewer.options.baseline&&viewer.view!=='rear')$('stage-note').textContent='檐高按文献约束；基准、层高及细部尺寸仍待核';
}
function paintView(v){document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===v));$('view-label').textContent=viewName(v);updateNote();if(current==='C01'&&['front','corner','rear','detail','side'].includes(v)){photoIndex=v==='side'?3:v==='rear'?2:v==='detail'?1:0;updatePhoto();}}
function setView(v){viewer.setView(v);}
function updatePhoto(){
  const conf=catalog[current],id=conf.photos[photoIndex],p=data.photos[id];
  $('photo').src=p.path;$('photo').alt=conf.title+' · '+id+' 参考照片';$('photo-large').src=p.path;$('photo-large').alt=$('photo').alt;
  const credit=`${p.face==='north-end'?'北侧端墙 · ':p.face==='south-tower'?'南侧钟塔 · ':p.face==='interior-north-side-windows'?'室内北段侧窗 · ':''}${p.artist} · ${p.date} · ${p.license}`;
  $('photo-credit').textContent=credit;$('photo-large-credit').textContent=credit;$('photo-dialog-title').textContent=conf.title+' · '+id;
  $('photo-count').textContent=`${photoIndex+1} / ${conf.photos.length}`;$('photo-source').href=p.url;
}
function select(id){
  current=id;photoIndex=0;const c=catalog[id],road=id==='J1',bridge=id==='S1';viewer.load(id,data);
  document.querySelector('aside').scrollTop=0;
  document.querySelectorAll('[data-sample]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.sample===id));
  $('title').textContent=c.title;$('stage-index').textContent=c.index;$('description').textContent=c.description;$('unknowns').textContent=c.unknowns;$('caution').textContent=c.caution;$('source-note').textContent=c.note;
  $('baseline').disabled=road||!data.buildings[id]?.baselineHeight;$('baseline').setAttribute('aria-pressed','false');$('topology').hidden=!(road||bridge||id==='C01'||id==='C02');$('section').hidden=!bridge;$('section').setAttribute('aria-pressed','false');$('restrictions').hidden=!road;
  $('baseline').title=road?'路口请使用节点线位对照':!data.buildings[id]?.baselineHeight?'该源对象没有单一 P1 渲染记录':'对照 P1 的高度与简化外形';
  if(id==='C01'||id==='C02')$('baseline').title='本轮未建立旧体量对照';
  $('dimension-label').textContent=road?'研究范围':'OSM 外轮廓';$('height-label').textContent=road?'路幅依据':'模型最高点';
  $('dimensions').textContent=bridge?`${data.skybridge.lengthM.toFixed(2)} m · 源节点间距`:road?'约 170 × 144 m':`${data.buildings[id]?.width.toFixed(1)} × ${data.buildings[id]?.depth.toFixed(1)} m（短 / 长边）`;
  $('height').textContent=road?'车道标签与默认值 · 估计':`${viewer.sample.geometryMetrics.maxY.toFixed(1)} m · 比例估计`;
  const ref=viewer.sample.heightReference,source=ref&&data.buildings[id].controlSources?.[ref.sourceId];
  if(ref){$('height-label').textContent='文献檐高';$('height').textContent=`${ref.value.toFixed(1)} m · 文献值，非总高`;}
  $('height-source').hidden=!source;if(source){$('height-source').href=source.url;$('height-source').textContent=`檐高来源 · 竣工验收材料 PDF，第${ref.pages.join('、')}页 ↗`;}
  $('source-id').textContent=road?'osmHuacheng · 华穗路节点区':data.buildings[id]?.sourceId;
  if(bridge){$('dimension-label').textContent='OSM 端点跨度';$('height-label').textContent='断面假设';$('height').textContent='桥面 6.5 m / 廊宽 6 m / 内高 3.2 m';$('source-id').textContent=data.skybridge.sourceId;$('baseline').title='独立结构样板，无旧体量对照';}
  $('interface-fact').hidden=!bridge;$('side-view').hidden=id!=='C01';
  if(bridge){const f=data.skybridge.interfaceEvidence.springFloor;$('interface-floor').textContent=`春端${f.label} · ${f.epoch.slice(0,4)}年报道，现状待核`;$('height-source').hidden=false;$('height-source').href=data.skybridge.controlSources[f.sourceId].url;$('height-source').textContent='春端楼层来源 · 2013年新快报（转载） ↗';}
  $('restriction-list').replaceChildren();
  if(road)for(const r of data.road.restrictions){const b=document.createElement('button');b.textContent=`禁止掉头 · ${r.id}`;b.onclick=()=>{viewer.selectRestriction(r);$('restriction-list').querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',el===b));};$('restriction-list').append(b);}
  updatePhoto();setView(road?'aerial':'corner');history.replaceState(null,'','#'+id);document.title=c.title+' · 广州精细建模样板';
}
try{
  const r=await fetch('./samples.json');if(!r.ok)throw new Error('样板资料未能载入');data=await r.json();
  const sr=await fetch('./skybridge.json');if(!sr.ok)throw new Error('连廊资料未能载入');data.skybridge=await sr.json();data.photos.R6=data.skybridge.photo;
  const cr=await fetch('./c01.json');if(!cr.ok)throw new Error('沙面会堂资料未能载入');data.buildings.C01=await cr.json();Object.assign(data.photos,data.buildings.C01.photos);
  const br=await fetch('./c02.json');if(!br.ok)throw new Error('正金银行资料未能载入');data.buildings.C02=await br.json();Object.assign(data.photos,data.buildings.C02.photos);
  viewer=new StudyViewer($('viewer'),stats=>{$('render-info').textContent=`${Math.round(stats.triangles/1000)}k 三角形 · ${stats.calls} 次绘制`;});
  viewer.onViewChange=paintView;
  select(catalog[location.hash.slice(1)]?location.hash.slice(1):'B1');$('loading').hidden=true;
  document.querySelectorAll('[data-sample]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.sample)));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('reset').onclick=()=>setView(current==='J1'?'aerial':'corner');
  for(const id of['evidence','baseline','wireframe','topology','section'])$(id).onclick=()=>{
    const on=viewer.toggle(id);$(id).setAttribute('aria-pressed',on);$('legend').hidden=!viewer.options.evidence;
    updateNote();
  };
  $('photo-prev').onclick=()=>{photoIndex=(photoIndex+catalog[current].photos.length-1)%catalog[current].photos.length;updatePhoto();};
  $('photo-next').onclick=()=>{photoIndex=(photoIndex+1)%catalog[current].photos.length;updatePhoto();};
  $('photo-open').onclick=()=>$('photo-dialog').showModal();$('photo-close').onclick=()=>$('photo-dialog').close();
  $('photo-dialog').addEventListener('click',e=>{if(e.target===$('photo-dialog'))$('photo-dialog').close();});
  window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(catalog[id]&&id!==current)select(id);});
}catch(error){$('loading').hidden=false;$('loading').textContent=`样板暂时无法显示：${error.message}。请刷新页面重试，或使用支持 WebGL2 的浏览器。`;}
