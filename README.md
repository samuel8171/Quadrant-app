# 象限

面向大学生的时间管理桌面软件（Electron + React + TypeScript）。

## 功能

- 目标：长期/短期目标、子目标顺序/并列关系
- 四象限：可平移缩放的事件坐标系、事件管理
- 周计划：周视图总览（自适应、只读）、单日时间轴（上下滚动、整点吸附）、全局事件预设（8 色 + 四象限 + 时长自定义 ≤10 小时）、事件可选同步到四象限（不重叠、每象限上限 30）
- 周日复盘：计划完成度/计划完成质量/压力指数三档滑动条 + 复盘文字，草稿保存（会话内保留），输出 Word（年+月+日+周几+复盘），复盘记录子页（内容视图，双击用默认程序打开）

## 开发

```bash
npm install
npm run dev
```

## 测试

```bash
npm test
```

## 打包

```bash
npm run package
```

产物在 `dist/` 下，为便携单文件 exe。

## 数据

数据保存在 `%APPDATA%/象限/plan.json`，写入前自动备份为 `plan.backup.json`。

## Web 版

桌面 Electron + 手机竖屏 Web 时间管理应用。桌面端保留左侧导航；屏幕宽度不超过 767px 时切换为底部毛玻璃 Tab Bar。

```bash
npm install
npm run dev:web
npm run build:web
```

`build:web` 输出静态文件到 `dist-web/`，可将该目录部署到 GitHub Pages（例如使用 Actions 上传 Pages artifact）。不会自动创建仓库、推送或发布。

响应式断点：`<=767px` 手机底部导航，`768–1023px` 紧凑桌面/平板，`>=1024px` 桌面左侧栏。移动端按 Apple HIG 使用 44px 触控热区、动态视口高度和安全区内边距。

四象限位置和语义沿用原程序：Q1 右上橙色 `#FF8C00`（重要紧急），Q2 左上黄色 `#FFA500`（重要不紧急），Q3 左下青色 `#008B8B`（不重要不紧急），Q4 右下紫色 `#483D8B`（不重要紧急）。移动适配不会调换象限。

## 生图自检

脚本只从环境变量读取密钥：

```powershell
$env:RIGHTAPI_API_KEY = "<your-key>"
node scripts/visual-self-check.mjs --prompt-file docs/visual-self-check/quadrant-prompt.txt --output docs/visual-self-check/quadrant.png
```

默认接口为 `https://www.rightapi.ai/draw`，模型为 `gpt-image-2`；可用 `--endpoint`、`--model`、`--timeout` 覆盖。不要把密钥写入仓库、脚本、`.env` 或构建产物。
