# P2 独立质量样板

从项目根目录启动 `node serve.mjs 5174`，打开 <http://localhost:5174/prototypes/p2/>。

这是一份等待设计确认的可浏览原型，包含三栋建筑和花城大道×华穗路节点区。正式城市场景未使用这些模型。

说明及验证边界见 [P2交付记录](../../docs/P2-可浏览质量样板-2026-09-25.md)，结构化验证记录见 `validation.json`。

如需重新生成裁剪后的固定数据，可使用P0的隔离GIS环境：

```bash
.research/p0-2026-09-25/.venv/bin/python tools/build-p2-samples.py
```

运行查看器不需要Python，也不需要安装额外前端依赖。代码沿用项目许可；参考照片的作者、日期及独立许可记录在 `samples.json` 并在页面显示，不能将参考图片统一视为代码许可资产。
