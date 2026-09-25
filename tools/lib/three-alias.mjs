// node --import ./tools/lib/three-alias.mjs <script>：让离线工具直接运行浏览器端模块，
// 按 index.html 的 import map 把 'three' 与 'three/addons/' 解析到 vendor/，不安装任何包。
import { register } from 'node:module';
register('./three-hooks.mjs', import.meta.url);
