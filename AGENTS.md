# 环境备忘

## firecrawl CLI

- 安装方式：npm 全局安装，包名 `firecrawl-cli@1.16.2`
- 安装位置：`C:\Users\Samuel\AppData\Roaming\npm\firecrawl`（同目录下还有 `firecrawl.cmd` 和 `firecrawl.ps1`）
- 认证状态：已通过存储凭据完成登录，可直接使用
- 调用方式：直接运行 `firecrawl <命令>`；若沙箱拦截报"拒绝访问"，改用完整路径 `C:\Users\Samuel\AppData\Roaming\npm\firecrawl.cmd <命令>`，或按权限规则申请放行
- 使用说明：`C:\Users\Samuel\.codex\skills\firecrawl-cli\SKILL.md`

## git 操作（沙箱限制）

- **带斜杠的标签名会静默失败**：`git tag -a "archive/xxx" ...` 返回退出码 0，但不会在 `.git/refs/tags/` 下创建子目录，标签实际不存在。改用扁平命名（如 `archive-xxx`），或先创建再 `git verify-tag` 确认。
- 验收标签必须按 ref 全路径查询：`git rev-parse refs/tags/<name>`，`git tag -l` 的输出偶尔滞后。
- **切换分支后必须核验工作区完整性**：曾出现 `git checkout -b` 只更新索引、约 30 个文件未写入磁盘的情况（`git status` 显示大批 ` D`）。核验方法：`git diff HEAD --stat` 应为空；修复用 `git restore --worktree --source=HEAD .`。
- 还原后可能出现「内容一致但状态显示 M」的假象（索引 stat 缓存未刷新），用 `git add -u -- .` 刷新，并以 `git write-tree` 与 `git rev-parse HEAD^{tree}` 对比树哈希做最终判定。

## 工程命令

- 本终端执行 `npm run <script>` 会报 `/usr/bin/env: bash` 找不到，须直接调用：`./node_modules/.bin/tsc --noEmit -p tsconfig.node.json`、`./node_modules/.bin/vitest run`、`./node_modules/.bin/electron-vite build`。

## 界面交互探针（定位"只在真实事件时序下暴露"的缺陷）

只用读代码推断交互缺陷在本项目已多次得出错误结论（例如误判"四象限 `touch-action:none` 与页面滚动冲突"、误判"长按完全没实现"）。涉及指针/触摸/焦点的改动，先用探针取真实证据再改代码。

1. 另开终端起开发服务器：`./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort`
2. 驱动真实浏览器：
   - `node scripts/ui-probe.mjs --mode touch --action dbl-tap --page quadrant`
   - `node scripts/ui-probe.mjs --mode touch --action long-press --at 0.5,0.5`
   - `node scripts/ui-probe.mjs --mode touch --action drag --from 0.3,0.3 --to 0.7,0.7`
   - `node scripts/ui-probe.mjs --mode mouse --action dbl-tap --page weekly`
3. 参数与更多场景见 `scripts/ui-probe.mjs` 头部注释。

要点与坑：

- 探测页 `src/renderer/probe.html`（源码在 `src/renderer/probe/main.tsx`）直接挂载真实页面组件并绕开网页端登录门禁，`?page=quadrant|weekly|goals|review[&strict=0][&sidebar=1]`。**不进入构建产物**（Vite 只以 `index.html` 为入口）。
- 本机无 Chrome、无 `ms-playwright` 浏览器缓存；直接复用系统 Edge + `playwright-core`（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`），无需下载二进制。可用 `UI_PROBE_BROWSER` 覆盖。
- **两次独立的 `page.mouse.click` 不会让浏览器合成 `dblclick`**（clickCount 各为 1）；鼠标双击用 `page.mouse.dblclick`，触摸双击用两次 `page.touchscreen.tap`。触摸长按/拖动需走 CDP `Input.dispatchTouchEvent`。
- `addInitScript` 执行时 `document.documentElement` 可能尚未创建，MutationObserver 要轮询挂载，否则整段注入脚本会因抛错而失效。
- 已知时序陷阱：触屏轻触后浏览器会在 `pointerup` **之后**补发 `mousedown`（其默认动作会抢走焦点，曾导致"输入框闪现即消失"）。
