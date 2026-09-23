# 环境备忘

## firecrawl CLI

- 安装方式：npm 全局安装，包名 `firecrawl-cli@1.16.2`
- 安装位置：`C:\Users\Samuel\AppData\Roaming\npm\firecrawl`（同目录下还有 `firecrawl.cmd` 和 `firecrawl.ps1`）
- 认证状态：已通过存储凭据完成登录，可直接使用
- 调用方式：直接运行 `firecrawl <命令>`；若沙箱拦截报"拒绝访问"，改用完整路径 `C:\Users\Samuel\AppData\Roaming\npm\firecrawl.cmd <命令>`，或按权限规则申请放行
- 使用说明：`C:\Users\Samuel\.codex\skills\firecrawl-cli\SKILL.md`

## git 操作（沙箱限制）

- **推送必须走 `bash scripts/api-push.sh`，不要用 `git push`。** 本机 git-over-HTTPS 通道已废：直连 `github.com:443` 不通，配置代理 `127.0.0.1:7897` 是死端口，环境变量代理 `127.0.0.1:14829` 只扛得住 `ls-remote`（小请求 200 / 0.6s），push 几 MB 会 `schannel: server closed abruptly` 或 `CONNECT tunnel failed, response 502`。`api.github.com` 直连稳定，故改用 Git Data API。
  - 用法：`bash scripts/api-push.sh --dry-run` 校验条件，`bash scripts/api-push.sh` 实推。**约 3 分 40 秒**（逐个探测约 213 个 blob 的存在性），必须用后台方式跑，前台会超时。
  - 脚本保证远端 commit sha 与本地**逐字节一致**，不做本地改写；推前会校验「远端顶点 == 本地 HEAD 的 parent」，不一致就拒绝（防误覆盖）。
  - **坑 1 · 根树要显式补**：`git ls-tree -r -t HEAD` 不列根树（它没有 path），漏掉就 `422 Tree SHA does not exist`。
  - **坑 2 · tree 条目顺序**：git 按路径**原始字节**升序写 tree，且子树按「路径 + `/`」参与比较（`build/` 与 `build.sh` 的先后由此决定）。顺序错 → sha 不符。
  - **坑 3 · 中文路径**：不加 `-z` 时 git 会把含非 ASCII 的路径 C 风格引用（实际得到 `"ChatGPT Image 2026\345\271\2648..."`）。必须 `git ls-tree -r -t -z` 取原样字节。
  - **坑 4 · message 尾部换行**：`$(git log --format=%B)` 吃掉全部行尾换行，而 commit 对象要求末尾恰有一个 `\n`（本地 3487 B vs 远端 3486 B）。改走 base64 传递。
  - **坑 5 · author/committer**：API 默认用 token 持有者 + 当前时间，sha 必不同。要显式传 `{name, email, date}` 复刻本地身份（当前提交者是 `Codex <codex@local>`）。
  - **沙箱拦子进程**：Node 里 `execFileSync('git', …)` 报 `EBUSY (-4082)`，绝对路径也一样。所以 git 操作全在 `.sh` 侧完成，结果经环境变量传给 `.mjs`。
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
- **写作陷阱（一族的三个实例，改样式前先查这三条）**：
  1. 作者样式里的 `display: flex` 会盖掉 UA 样式表的 `[hidden] { display: none }`。凡是用 `hidden` 属性做显示/隐藏的组件，都要显式补 `[hidden] { display: none }`，否则属性写了等于没写（`.preset-list` 的折叠按钮曾因此整体失效）。
  2. 单类选择器同权重时**源序在后者胜出**。写给通用类（`.icon-btn`、`.mobile-only` 等）加覆盖的规则时，必须提权到 `.父类 .目标类`，否则被文件后半段的通用类盖掉（`.goal-more { display: none }` 曾被 `theme.css:357` 的 `.icon-btn { display: inline-flex }` 盖掉，桌面端误显示「…」按钮）。**别只看选择器名字像不像覆盖，要 `grep -n` 确认两条规则的先后。**
  3. **flex 子项默认 `align-items: stretch`，会被拉伸到容器的"内容盒高度"（可视高 − padding），而不是内容自身高度。** 同一行里若有兄弟项带确定高度（能溢出滚动），就会出现"兄弟跑到很下面、这一项提前断掉"的错位。`.day-gutter`（时间轴左侧标尺）曾因此丢底色：桌面 1440×900 少 25px、手机 390×844 少 180px，缺口大小 = 内容高 − 可视内容盒高，所以两端不一样。修法是给该子项 `align-self: flex-start`，让它回到内容高度。
- 改完布局后用 `--shots` 存几张截图目视一遍：数值全对但版式崩掉（按钮被挤到换行、文字被 sticky 元素裁掉）只有截图看得见，本项目已三次靠截图发现纯读数看不见的问题。

## 轴系几何探针（时间轴"对不对齐"用像素说话）

```
node scripts/axis-geometry-probe.mjs --viewports 1440x900,390x844 --out docs/probes/axis-geometry.md --shots docs/probes/axis-shots
```

把每个元素换算到 `.day-scroll` 的**内容坐标系**，再用 `内容坐标 → 分钟` 的逆映射把像素翻译成时刻，于是"标尺底色覆盖到几点""事件块底部差几分钟"都是可读数字。

- 播种的事件刻意贴三个边界：7:00（贴 DAY_START）、15:00 与 15:30（整点与非整点）、23:00-24:00（贴 DAY_END）；对照表按 `data-event-id` 反查，不依赖 `.day-event-time` 是否渲染（时长 < 45 分钟时 EventBlock 不渲染 meta）。
- 量小时标签要用 **Range 取文字行盒**，不能拿 `.day-hour-label` 的盒子中心当"数字中心"——label 高 48px 且 `align-items: flex-start`，文字只占顶部十几像素，用盒中心会算出 +18px 的假偏差。

## 动效探针（区分"看着像在动"与"真的在动"）

```
node scripts/motion-probe.mjs --viewports 1440x900,390x844 --out docs/probes/motion.md --shots docs/probes/motion-shots
```

- **点击与采样必须在同一次 `page.evaluate` 里**，用 `requestAnimationFrame` 连续记录尺寸序列。分成"先点、再量"两次往返会丢掉整个过渡，只看到终态，也就分不清瞬变和渐变。判据是**不同高度值的个数 ≥ 3**（去掉起点与终点两个必然值）。
- 同时验证：指示块中心与激活项中心的偏差（应为 0）、抽屉收起后是否真的归零、收起后列表是否脱离焦点序列（`visibility: hidden`）、卡片与操作按钮是否被裁掉。
- 卡片尺寸必须在**展开态**量：收起时列表高 0，卡片会被一起压扁，那时读到的是它的外边距。
- 桌面端"抽屉是否压住底栏"这类判据要么不适用、要么必须同时要求横向重叠：桌面端面板与左侧栏是**并排**的，纵向区间天然完全重叠（同 2026-09-17 那次"时间轴被遮 803px"的荒唐结论）。

### 改这块代码时的两个必知陷阱

1. **`grid-template-rows: 0fr` 压不掉 padding。** 用 grid 行做高度过渡时，内层元素若带纵向 padding，收起后会长出与 padding 等高的残留（本项目实测 22px）。padding 属于元素自身盒子，border-box 下即使高度被压成 0，它仍是硬性最小外尺寸，`min-height: 0` 和父级 `overflow: hidden` 都救不了。**留白要改用伪元素 + 子元素 margin**（它们属于内容，会被一起裁掉）。相关实现见 `theme.css` 的 `.preset-collapse` / `.preset-list::before` / `.preset-card`。
2. **探针播种数据少一个字段，整份数据会被静默丢弃**：`platformApi.ts` 的归一化要求 `Number.isFinite(weekCounterOffset)`，缺了它 `AppData` 直接回退默认值，症状是「localStorage 里有数据、DOM 里一个事件都没有」。写 seed 时照 `src/shared/types.ts` 的 `AppData` 逐字段对齐。

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

## PWA / iOS 全屏（网页端）

网页端支持「添加到主屏幕」后以 standalone 全屏打开。三处关键配置：

- `src/renderer/public/manifest.webmanifest` —— 图标、`start_url`、`scope` 均为 `./` 相对路径。**manifest 内的相对路径以 manifest 自身的 URL 为基准**（不是页面 URL），所以部署在 `/Quadrant-app/` 子路径下依然正确解析。
- `src/renderer/index.html` —— `viewport-fit=cover` 是 iOS 全屏的硬性前提（不加则内容停在安全区边界、Safari 渲染一条实心色条）；`apple-touch-icon` 优先级高于 manifest 图标，**缺失时 iOS 会用页面截图当图标**；`apple-mobile-web-app-capable` 仅为兼容 iOS 26 之前的旧系统，26+ 已默认全屏。
- `src/renderer/src/main.tsx` —— 在 React 挂载前同步打 `html[data-standalone]`。

### 视口高度：`--app-height` 变量

`.app` 的高度统一走 `var(--app-height)`，**不要再写死 `100dvh`**。

原因是 PWA standalone 下 `100dvh` 是错的：iOS 在冷启动时把 `env(safe-area-inset-top)` 从 dvh/svh 里减掉了（实测 iPhone 14 Pro 报 793px、真实屏高 852px、差 59px = 灵动岛高度），布局比屏幕矮一截、底部露缝；而 standalone 下没有地址栏，`100lvh`（「大视口」）才等于全屏。覆盖规则在 `theme.css` 末尾，用 `@media (display-mode: standalone)` 与 `html[data-standalone='true']` **双判据取或**（WebKit 对 `display-mode` 的支持历史上与实际状态不一致过，`navigator.standalone` 更可靠）。

iOS 另有个未公开的「docking」行为——滚动/旋转/切后台后会自行重算成正确值，所以该缺陷表现为**「老安装正常、新安装露缝」**，靠现象几乎无法复现。

### 安全区只避让一次（曾踩坑）

`.sidebar` 一度写成 `bottom: max(10px, env(safe-area-inset-bottom))` **同时**在 `padding-bottom` 里再叠一次 `env(safe-area-inset-bottom)`，属双重计算。Safari 标签页下 `inset-bottom ≈ 8px` 不易察觉，但 **standalone 下是 34px**：固定高 58 减去 padding 后内容只剩 12px，而按钮实需 44px，会被压到几乎看不见。

规则：**定位（`bottom`/`top`）负责避让安全区，padding 就不要再叠一次**。其余用到 `env(safe-area-inset-bottom)` 的地方都是与 `--mobile-nav-height` 相加（把浮层抬到导航条之上），语义正确，不要一并乱改。

### 探针 `scripts/pwa-height-probe.mjs` 的两条验证边界

```
node scripts/pwa-height-probe.mjs --out docs/probes/pwa-height.md
```

必须知道它**测不出什么**，否则会把「全绿」误当成「验证过」：

1. **桌面 `env(safe-area-inset-*)` 恒为 0**，无法通过 viewport 设置模拟 iOS 安全区。探针靠注入样式伪造（否则「导航条是否被挤扁」在 PC 上永远假通过）。
2. **高度修正本身无法被它证伪**。把 `theme.css` 还原到修复前（`.app` 为 `height: 100dvh`、无 `--app-height`），探针照样报全绿——因为 PC 上 `100dvh` 就等于视口高。iOS 少算 `safe-area-inset-top` 是 WebKit 特有行为，桌面 Chromium 不重现。

所以判定 1 只能证明「变量被正确应用且等于全屏高」，**真机验收不可替代**。

### 探测页入口

探针须走 `/probe.html?page=weekly&sidebar=1`，**不要用 `/`**：`/` 是登录页（`.app` 与 `.sidebar` 都不存在，测量会拿到 null），而探测页会直接挂载真实组件并绕开登录门禁。另外探测页要先 `await init()`，`waitForSelector('.app')` 等到才说明挂载完成（期间渲染的是 `loading…`）。

