// 2026-09-26：C01/C02 已通过隔离试落位验收并纳入默认清单的 shamian-west 块，试验参数包随之退役。
// 历史试落位记录 docs/research/p3-placement-trial/geometry.json 保持冻结（可在提交 de2dc1a 复现）。
// 本入口改为调用通用落位核查：默认建筑块 + 暂存候选块。
import { register } from 'node:module';
register('./lib/three-hooks.mjs', import.meta.url);
await import('./verify-detail-placement.mjs');
