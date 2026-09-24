// 场景面板：只保留预设场景（机位 + 时间 + 天气），以及截图 / 隐藏界面两个操作。

import { SCENES, SCENE_KEYS } from '../core/scenes.js';

const I = {
  hero: '<svg viewBox="0 0 24 24"><path d="M3 20l6-9 4 5 3-4 5 8z"/><circle cx="16" cy="6" r="2"/></svg>',
  river: '<svg viewBox="0 0 24 24"><path d="M3 15c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/><path d="M6 11l3-5h6l3 5"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M9 21l2-9-1-6 2-4 2 4-1 6 2 9z"/></svg>',
  axis: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M6 21V11h3v10M15 21V8h3v13"/></svg>',
  street: '<svg viewBox="0 0 24 24"><path d="M4 20V9l4-3 4 3v11M12 20V9l4-3 4 3v11"/><path d="M6 20v-4a2 2 0 0 1 4 0v4M14 20v-4a2 2 0 0 1 4 0v4"/></svg>',
  old: '<svg viewBox="0 0 24 24"><path d="M3 12c2 0 3-2 4-5h10c1 3 2 5 4 5"/><path d="M5 12v8h14v-8"/></svg>',
  night: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  rain: '<svg viewBox="0 0 24 24"><path d="M7 15a5 5 0 1 1 9.6-2H18a3.5 3.5 0 0 1 0 7H8"/><path d="M8 21l1-2M12 21l1-2M16 21l1-2"/></svg>',
  fog: '<svg viewBox="0 0 24 24"><path d="M4 9h16M3 13h18M5 17h14"/></svg>',
  top: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>',
  shot: '<svg viewBox="0 0 24 24"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><circle cx="12" cy="12" r="3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
};
const WX = { clear: '晴朗', humid: '湿润薄雾', rain: '阵雨', huinan: '回南天' };
const fmtTime = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;

// 缩略色带：按时间与天气给出天空渐变
function swatch(a) {
  const t = a.timeOfDay;
  if (a.weather === 'rain') return 'linear-gradient(160deg,#5b6570,#2b3138)';
  if (a.weather === 'huinan') return 'linear-gradient(160deg,#b9bcb8,#7d8580)';
  if (t < 6.5 || t > 19.6) return 'linear-gradient(160deg,#1c2238,#3a2233 60%,#e0864a)';
  if (t > 17.3) return 'linear-gradient(160deg,#6d7fb0,#e9a066 65%,#f5c07a)';
  if (t < 9) return 'linear-gradient(160deg,#9fb6d6,#f0cf9f)';
  return 'linear-gradient(160deg,#5f8fc9,#b9d3ea)';
}

export class Panel {
  constructor(opts) {
    this.o = opts;
    const body = document.getElementById('panel-body');
    body.innerHTML = SCENES.map(
      (s, i) => `${s.group === 'street' && SCENES[i - 1]?.group !== 'street' ? '<div class="scene-group">街景漫步 · 人眼高度</div>' : ''}
      <button type="button" class="scene" data-id="${s.id}">
        <span class="thumb" style="background:${swatch(s.atmos)}">${I[s.icon] || ''}<em>${SCENE_KEYS[i] || ''}</em></span>
        <span class="txt"><b>${s.name}</b><small>${s.sub}</small><i>${fmtTime(s.atmos.timeOfDay)} · ${WX[s.atmos.weather]}</i></span>
      </button>`,
    ).join('');
    this.btns = [...body.querySelectorAll('.scene')];
    this.btns.forEach((b) => (b.onclick = () => opts.onScene(b.dataset.id)));
    document.getElementById('btn-shot').onclick = () => opts.onAction('shot');
    document.getElementById('btn-hide').onclick = () => opts.onAction('hide');
    document.getElementById('btn-show').onclick = () => opts.onAction('hide');
    document.getElementById('btn-collapse').onclick = () => document.getElementById('panel').classList.toggle('collapsed');
  }
  setScene(id) {
    this.btns.forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  }
}
