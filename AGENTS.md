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

## 布局密度探针（量化"可操作面积"，同一个开发服务器）

讨论移动端空间不足时不要靠读 CSS 估数，直接取实测像素：

```
node scripts/mobile-density-probe.mjs --presets 0,12 --out docs/probes/mobile-density.md
```

- 在 375×667 / 390×844 / 430×932 三种手机视口下，播种数据后逐页量出：四象限画布像素、周视图单屏可见天数、日视图时间轴可见小时数与预设面板占位、目标卡单屏可见张数与标题实际可用宽度、复盘各区块高度、底部导航条高。
- 报告含「强制收起」「预设抽屉化」两个反事实场景，用于量化某次改动的收益上限。
- `--dump-goal-card` 打印目标卡子元素明细（排查"标题被挤成竖排"这类压缩问题）。
- `--shots <目录>` 每页存一张截图（`day-drawer-*` 含抽屉收起/展开两态），用于目视核对版式。
- 无需真实云凭据：直接往 `localStorage['quadrant-web-data-v2']` 播种，`AppData` 形状见 `src/shared/types.ts`。
- **写作陷阱（一族的两个实例，改样式前先查这两条）**：
  1. 作者样式里的 `display: flex` 会盖掉 UA 样式表的 `[hidden] { display: none }`。凡是用 `hidden` 属性做显示/隐藏的组件，都要显式补 `[hidden] { display: none }`，否则属性写了等于没写（`.preset-list` 的折叠按钮曾因此整体失效）。
  2. 单类选择器同权重时**源序在后者胜出**。写给通用类（`.icon-btn`、`.mobile-only` 等）加覆盖的规则时，必须提权到 `.父类 .目标类`，否则被文件后半段的通用类盖掉（`.goal-more { display: none }` 曾被 `theme.css:357` 的 `.icon-btn { display: inline-flex }` 盖掉，桌面端误显示「…」按钮）。**别只看选择器名字像不像覆盖，要 `grep -n` 确认两条规则的先后。**
- 改完布局后用 `--shots` 存几张截图目视一遍：数值全对但版式崩掉（按钮被挤到换行、文字被 sticky 元素裁掉）只有截图看得见，本项目已两次靠截图发现纯读数看不见的问题。

## CI 排障（「本机绿、CI 红」的成因与复现）

CI 里 `node-version` **刻意锁 20**——与 Electron 31 内置的 Node 同代；本机开发跑的是 Node 22+。两代之间的差异会以「本机永远绿、CI 恒红」的形式出现，所以别急着把 CI 的 Node 往上抬，先复现。

2026-09-17 定位到的真实案例：`cloudSync2.ts` 在**顶层**执行 `createClient(...)`，而 supabase 的 realtime 层要求运行环境提供原生 `WebSocket` 全局（浏览器 / Node 22+）。Node 20 没有这个全局，于是 `createClient` 在**模块加载期**抛 `Node.js detected but native WebSocket not found`；`tests/cloudSync.test.ts` 当时只为测两个纯函数却 import 了这个模块，整个套件因此加载失败、3 秒退出（表现为「单元测试」步骤 3 秒内失败，且日志里只有一句 `stderr | tests/cloudSync.test.ts`）。

- **规则**：纯逻辑不要和「顶层有副作用」的模块同住一个文件。已拆出 `src/renderer/src/lib/cloudValidation.ts`。
- **本机复现**（不用等 CI）：Node 20 便携版在 `C:/Users/Samuel/.workbuddy/binaries/node/versions/node-v20.20.2-win-x64/`，
  ```
  .../node-v20.20.2-win-x64/node.exe node_modules/vitest/vitest.mjs run
  ```
  判据很直观：`node -e "console.log(typeof WebSocket)"` 在 Node 20 是 `undefined`、Node 22 是 `function`。
- **跨平台文件名**：`node scripts/case-audit.mjs` 按 Linux 规则检查测试与源码引用的每个路径（大小写、是否存在），专治「Windows 不区分大小写所以本机过、Linux 上 ENOENT」。
- **读 CI 日志**：Actions 步骤日志匿名拉取会 403，但 **check-run 注解匿名可读**。入口在 `/actions/runs/<run_id>/jobs` 返回的 `check_run_url` 上追加 `/annotations`。`.github/ci-annotate.mjs` 会在测试失败时把日志揉成注解（优先 stderr/stdout 区块——vitest 把测试里的 console 输出攒到最后统一打印，未捕获的异步异常就在那里），不看网页也能定位。

