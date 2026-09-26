# 环境备忘

## firecrawl CLI

- 安装方式：npm 全局安装，包名 `firecrawl-cli@1.16.2`
- 安装位置：`C:\Users\Samuel\AppData\Roaming\npm\firecrawl`（同目录下还有 `firecrawl.cmd` 和 `firecrawl.ps1`）
- 认证状态：已通过存储凭据完成登录，可直接使用
- 调用方式：直接运行 `firecrawl <命令>`；若沙箱拦截报"拒绝访问"，改用完整路径 `C:\Users\Samuel\AppData\Roaming\npm\firecrawl.cmd <命令>`，或按权限规则申请放行
- 使用说明：`C:\Users\Samuel\.codex\skills\firecrawl-cli\SKILL.md`

## git 操作（沙箱限制）

- **推送必须走 `bash scripts/api-push.sh`，不要用 `git push`。** 本机 git-over-HTTPS 通道已废：直连 `github.com:443` 不通，配置代理 `127.0.0.1:7897` 是死端口，环境变量代理 `127.0.0.1:14829` 只扛得住 `ls-remote`（小请求 200 / 0.6s），push 几 MB 会 `schannel: server closed abruptly` 或 `CONNECT tunnel failed, response 502`。`api.github.com` 直连稳定，故改用 Git Data API。

  > ⚠️ **2026-09-26 第十四轮订正：`scripts/api-push.sh` 不可靠，实战走下面这套两步。**
  >
  > api-push.sh / api-push.mjs 的"自底向上补对象"迭代器会卡在子树上传停滞
  > （`src` 与根树 POST 422，报错只给状态码、看不出成因）。**可靠的两步是**：
  >
  > ```bash
  > # ① 补 blob（差异集＝"树等价的本地基准"..HEAD）
  > bash scripts/api-push-blobs.sh          # 内部：git diff-tree → base64 → POST /git/blobs
  > # ② 补树 + 建提交 + 更新 ref
  > bash scripts/api-push-trees.sh          # 内部：POST /git/trees（每建一棵立刻用孤儿提交让它
  >                                          # reachable）+ POST /git/commits + PATCH /git/refs
  > ```
  >
  > 各约 1 分 40 秒，都要后台跑。两条只有这两条是**新踩**的：
  >
  > * **中间提交的树也要在远端存在**：`api-push-trees.py` 只走 HEAD 那棵树，
  >   所以要推的提交链里每个提交的树都得先建 —— 最省事的做法是
  >   **`git reset --soft <基准> && 重新提交成一个**（本地少几个提交，内容逐字节不变）。
  >   2026-09-26 就是这么过的：三个提交合并成一个，`POST /git/commits` 立刻 201。
  > * **远端顶点不在本地仓库里时，`git rev-list <remote>..HEAD` 会报 unknown revision**
  >   （API 建的提交从来没被 fetch 下来过）。改用"树等价的本地基准"来枚举提交：
  >   `LOCAL_BASE=<本地那个树与远端顶点相同的提交> bash scripts/api-push-trees.sh`
  >   （`remote.txt` 仍取 API 的真实顶点，作为第一个提交的 parent）。
  >
  > 结果预期：远端 sha 与本地**不同**（parent 不同），但**树逐字节相同** ——
  > 用 `GET /git/trees/<sha>?recursive=1` 比对几个 blob 的 sha 即可确认
  > （2026-09-26 实测 `theme.css` 7871882303、`GlassSurface.tsx` b2a7de823a 两边一致）。
  > 代价是本地/远端历史持续分叉（`api-push.sh` 的祖先检查会拒推），这是已知代价。
  - 用法：`bash scripts/api-push.sh --dry-run` 校验条件，`bash scripts/api-push.sh` 实推。**约 3 分 40 秒**（逐个探测约 213 个 blob 的存在性），必须用后台方式跑，前台会超时。
  - 脚本保证远端 commit sha 与本地**逐字节一致**，不做本地改写；推前会校验「远端顶点 == 本地 HEAD 的 parent」，不一致就拒绝（防误覆盖）。
  - **坑 1 · 根树要显式补**：`git ls-tree -r -t HEAD` 不列根树（它没有 path），漏掉就 `422 Tree SHA does not exist`。
  - **坑 2 · tree 条目顺序**：git 按路径**原始字节**升序写 tree，且子树按「路径 + `/`」参与比较（`build/` 与 `build.sh` 的先后由此决定）。顺序错 → sha 不符。
  - **坑 3 · 中文路径**：不加 `-z` 时 git 会把含非 ASCII 的路径 C 风格引用（实际得到 `"ChatGPT Image 2026\345\271\2648..."`）。必须 `git ls-tree -r -t -z` 取原样字节。
  - **坑 4 · message 尾部换行**：`$(git log --format=%B)` 吃掉全部行尾换行，而 commit 对象要求末尾恰有一个 `\n`（本地 3487 B vs 远端 3486 B）。改走 base64 传递。
  - **坑 5 · author/committer**：API 默认用 token 持有者 + 当前时间，sha 必不同。要显式传 `{name, email, date}` 复刻本地身份（当前提交者是 `Codex <codex@local>`）。
  - **沙箱拦子进程**：Node 里 `execFileSync('git', …)` 报 `EBUSY (-4082)`，绝对路径也一样。所以 git 操作全在 `.sh` 侧完成，结果经环境变量传给 `.mjs`。
  - **坑 6 · `npm ci` 会挡住整个 CI**：`liquid-glass-react@1.1.1` 的 peer 是 `react >= 19`，
    而项目在 React 18.3.1 ⇒ 干净环境里 `npm ci` 直接 ERESOLVE 失败（**网页端部署从
    2026-09-24 起一直失败的真因**）。本地 `node_modules` 已存在所以看不出来。
    已在仓库根用 `.npmrc` 的 `legacy-peer-deps=true` 固化。**改依赖后先想这条。**
  - **坑 7 · API 建的"树"在按 sha 读的路径上不可靠**（`GET /git/trees/<sha>` 对**未被任何
    提交引用**的树返回 404；blob 不受影响），而 GitHub 校验"父树的子项"就走这条读路径
    ⇒ 父树 POST 报 `tree.sha X is not a valid tree`(422)，整条链建不起来。
    **解法：每建完一棵树立刻用一个孤儿提交（`parents: [远端顶点]`，不进任何分支）让它
    reachable**，父树随即 201。另外：`git ls-tree -r -t` **不列根树**（漏掉则建提交 422）；
    密集调用会零星 500（空体）、提交接口的 422 也常是瞬态 ⇒ 都要退避重试；
    `git diff-tree --raw` 列数不定别切列（先 `--name-only` 再 `git rev-parse HEAD:<path>`）；
    `git ls-tree -r -t | awk` 里 sha 在 `$3`。参考实现：`tmp/push2.{sh,py}`。
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
- **已知时序陷阱**：触屏轻触后浏览器会在 `pointerup` **之后**补发 `mousedown`（其默认动作会抢走焦点，曾导致"输入框闪现即消失"）。
- **`backdrop-filter`（玻璃磨砂）的取证：只有「元素级截图」不能信，页面级截图可以。**
  第七轮（2026-09-24）把这条彻底量清了 —— 本轮之前记的"CDP 看不见磨砂、只能用系统级
  抓图"**不要再用**：
  - `page.screenshot({ clip })`（页面级）**忠实地渲染 `backdrop-filter`**：无头 Edge 上
    量到"材质开 std 0.4 / 材质关 119.0"，那就是磨砂本身，且与系统级真实屏幕读数
    同向同量级（菜单死 0.66 ↔ 78.4；弹窗活 0.07 ↔ 3.5）。
  - `locator().screenshot()`（元素级）**会把一切判成"穿透"**：它为元素单独建
    render surface，连 `opacity:0.95` 这种规范正对照都读成"穿透"。**别用它量材质。**
  - 判据必须是**同方法内的「保留率」**：同一状态抓"材质开 / 关"两张比 std。
    绝对数字不可跨方法比（第五轮 CDP 读 38.0、真实屏幕 3.2，比值同向但绝对值差 10 倍）。
  ⇒ 量磨砂**不需要抢占屏幕**。系统级抓图（`scripts/glass-material-screen.{mjs,py}`）
  仍然保留，用作"屏幕上真正长什么样"的最终验收。
- **保留率的两个指纹很好认**：≈0 = 磨砂既画出来了、也采到了背景；
  **≈0.66 = 只剩染色**（`--gs-tint` 的 alpha 恰好 0.34，把对比度压到 0.66）。
  见到 0.66 就别再怀疑别的原因，直接去查定位层的 `z-index` / `position`。
- **窗口置顶会被别人的置顶浮层压住**（腾讯会议共享浮窗、NVIDIA Overlay 之类）。
  两个必踩的坑：① `user32.SetWindowPos` **必须显式声明 `argtypes`**，否则
  `HWND_TOPMOST = -1` 在 x64 上被零扩展成 `0x00000000FFFFFFFF`，调用**静默失败**
  且日志里看不出来；② 定位标记别用红/绿（会与探针自己的红/蓝条纹撞色），用青/品红。
  抓图前先确认屏幕没被占用（`tmp/winfocus.py` 可列可见窗口），
  否则会把别人的窗口拍下来 —— 既拿错数据，也可能拍进用户的隐私内容。

## 触摸手势的三个硬约束（改移动端手势前必读）

这三条都是实测结论，不是推断。违反任意一条都会写出"看起来对、真机上不对"的代码。

### 1. `touch-action` 在 `pointerdown` 时**锁存**，整段手势期间改无效

想让"未解锁时能滚动、解锁后能拖动"，靠 `.armed` 类把 `touch-action` 从 `pan-y` 切到 `none`
**行不通**。隔离实验（`scripts/` 下曾放过临时脚本，结论已固化在此）：

```
按下时 touch-action=pan-y → 中途加类改成 none → 再移动
结果：仍然滚动（scrollTop=22）并派发 pointercancel
```

同一实验里全程 `pan-y` 的对照组也是 `scrollTop=23`。两者行为一致 ⇒ 中途改值没被采纳。

**因此二选一，没有中间态**：
- 想要浏览器原生滚动 → `touch-action: pan-y`，但要接受"浏览器在第一次 `touchmove`
  就启动滚动并派发 `pointercancel`，**状态机永远起不了拖**"。
- 想要状态机完全掌控 → `touch-action: none`，滚动要**自己实现**。

本项目选了后者：移动端 `.day-event { touch-action: none }`，
未解锁的纵向位移由 `hooks/useEventBlockScroll.ts` 手写进 `.day-scroll` 的 `scrollTop`；
解锁后该 hook 立即让位给状态机做拖动。实测双向都成立（上移 90px → +90，下移 80px → −80）。

### 2. `pointercancel` 一旦到达，这次手势就废了

`touch-action: pan-y` 下浏览器会在 `pointermove` 之后立刻发 `pointercancel`：

```
scroll  type=pointerdown    pt=touch
scroll  type=pointermove    pt=touch
scroll  type=pointercancel  pt=touch      ← 到这里状态机只能复位
scroll  type=lostpointercapture
>>> ACTUAL SCROLL scrollTop=25
```

所以"长按解锁后拖动"在 `pan-y` 下**永远不可能成功**，哪怕 `armed` 已经亮起。
看到"长按有反应但拖不动"就查这条。

### 3. 探针的场景之间必须复位滚动位置

上一个场景把页面滚下去后，下一个场景按"块在视口内"算出的坐标会落到视口外，
触摸点打在空白处 → 状态机收不到 `item` hit → 表现为"长按解锁失效"这种假缺陷。
同理：**不要写 `scrollTop = 300` 这种超过上限的值**（内容 892 − 视口 694 = 最大 198），
浏览器会静默钳回 198，此时再想向下滚已无余量，测出来必是 Δ=0。

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
- **播种的事件日期必须按「本周」动态算**（`mondayKey()`），不能写死某天：日视图默认打开
  "今天"那一列，写死 9/14 那周而运行日是 9/23 时，画布上一个块都没有，
  指标看着正常、量的却是空画布。三个探针都已改为动态播种。
- **写作陷阱（一族的三个实例，改样式前先查这三条）**：
  1. 作者样式里的 `display: flex` 会盖掉 UA 样式表的 `[hidden] { display: none }`。凡是用 `hidden` 属性做显示/隐藏的组件，都要显式补 `[hidden] { display: none }`，否则属性写了等于没写（`.preset-list` 的折叠按钮曾因此整体失效）。
  2. 单类选择器同权重时**源序在后者胜出**。写给通用类（`.icon-btn`、`.mobile-only` 等）加覆盖的规则时，必须提权到 `.父类 .目标类`，否则被文件后半段的通用类盖掉（`.goal-more { display: none }` 曾被 `theme.css:357` 的 `.icon-btn { display: inline-flex }` 盖掉，桌面端误显示「…」按钮）。**别只看选择器名字像不像覆盖，要 `grep -n` 确认两条规则的先后。**
  3. **flex 子项默认 `align-items: stretch`，会被拉伸到容器的"内容盒高度"（可视高 − padding），而不是内容自身高度。** 同一行里若有兄弟项带确定高度（能溢出滚动），就会出现"兄弟跑到很下面、这一项提前断掉"的错位。`.day-gutter`（时间轴左侧标尺）曾因此丢底色：桌面 1440×900 少 25px、手机 390×844 少 180px，缺口大小 = 内容高 − 可视内容盒高，所以两端不一样。修法是给该子项 `align-self: flex-start`，让它回到内容高度。
- 改完布局后用 `--shots` 存几张截图目视一遍：数值全对但版式崩掉（按钮被挤到换行、文字被 sticky 元素裁掉）只有截图看得见，本项目已三次靠截图发现纯读数看不见的问题。

## 手势与滚动的实测探针（同一个开发服务器）

「想滚时间轴却把事件块拖走了」这类争议不能靠读代码裁决，三个脚本给数字：

```
node scripts/event-gesture-probe.mjs --out docs/probes/event-gesture.md
node scripts/day-scroll-regression-probe.mjs --out docs/probes/day-scroll-regression.md
node scripts/navheight-delta-probe.mjs --out docs/probes/navheight-delta.md
```

- `event-gesture-probe.mjs`：在 390×844 触摸视口下跑三个场景——块上纵滑（**不该**移动块）、
  长按解锁后拖动（**应该**移动块）、短促轻触（**不该**移动块）。
  **判据不能只看块的 `top` 变化**：滚动同样会改变 `top`。正确判据是
  "块是否**跟随**滚动量移动"（`top` 位移 ≈ −scrollΔ 即跟随=未被拖动），
  再配合 `.dragging` 类与 `armed` 类的采样作为旁证。报告里直接打印当前生效的
  `touch-action` 值，用来排除"改了源码、跑的是旧包"。
- `day-scroll-regression-probe.mjs`：确认改动没破坏其它路径——鼠标即时拖块、
  画布空白处上滑/下滑的原生滚动、滚轮滚动，共 4 项。
- `navheight-delta-probe.mjs`：底部导航 58→66px 的代价。做法是在**同一页面内**
  先后量"当前构建"与"注回改动前尺寸"（`addStyleTag` 注入覆盖 CSS），
  避免为拿一个对比数字回滚代码。结论：导航 +8px，内容净高 −8px，
  单个入口触控高 44px → **54px**（iOS HIG 下限是 44px）。

安全区与投影的取证（问题 2 / 问题 4）：

```
node scripts/safearea-slider-probe.mjs --out docs/probes/safearea-slider.md --shots docs/probes/shots-after5
```

- 桌面浏览器里 `env(safe-area-inset-*)` 恒为 0，**直接量永远量不出修复**。
  本脚本用 `addStyleTag` 把 `--safe-top` 钉成 47px（灵动岛机型状态栏典型值），
  再量各页顶部元素位置：修复到位时位移应**恰好等于 47px**（实测四页全部 47）。
- 同时打印 `.review-slider-thumb` 的 `box-shadow` / `border` / `border-radius` 计算值，
  用来判定滑块投影是否真的去掉（灰影来源就是这个 `box-shadow`，不是背景色）。

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

## 液玻璃材质（改 `components/glass/` 或任何玻璃外观前必读）

> **2026-09-24 第七轮：菜单磨砂的真凶是「定位层自己的 `z-index`」，已修。**
> 量法（无头即可，不用抢屏幕）：条纹插在被测浮层**之前**（同级、absolute、无 z-index），
> 同一状态抓"材质开 / 材质关"两张，比 **保留率 = std(开)/std(关)**。
> ≈0 = 磨砂生效；**≈0.66 = 只剩染色（死）**。

**玻璃定位层（`.gs-layer*`）上不能有非 auto 的 `z-index`，也不能是 `position: fixed`**

单变量实测，**两个宿主都做过 —— 别只信一个**：

| 宿主 | 变量 | 保留率 |
|---|---|---|
| 菜单 | 原样，层 `z-index: 50` | 0.66 死 |
| 菜单 | 层 `z-index: 30` / `z-index: 0` | 0.66 死（**0 与 50 同病**） |
| 菜单 | 层 `z-index: auto` | **0.00** 活 |
| 菜单 | 层 z auto ＋ **材质板** z 9 | **0.00** 活（材质板自己带 z 无害） |
| 弹窗 | 原样（层 z auto，外面包着 `.modal-mask` fixed+z60） | **0.07** 活 |
| 弹窗 | 给**它自己的定位层**加 z 50 | 0.65 死 |

⇒ 两条边界：**更外层祖先**的 z-index / fixed **不影响**（弹窗就是反例：它的祖先里有
`fixed` + `z-index: 60`，材质照样活）；**材质板自己**带 z-index **无害**。
所以修法是**把层级从定位层搬到材质板与内容层**（`--gs-z`；两处取**同一个数**，
靠树序把内容压在上面 —— 给内容 +1 会多盖一层正 z，手机 dock 的按钮就会被吞掉点击）。

⚠️ 本节早前记的「带 `position: fixed` 或 `z-index` 的**祖先**就是 backdrop root 边界」
**是错的，已作废**（规范也写明 z-index / fixed 不形成 backdrop root）。
被坐实的只有一条现象：**这一层自己带上了，材质就死**。**机制仍未定论，不要推测。**
`.gs-layer--dock`（手机 dock）的 `z-index: 0` 是同一个坑，已一并改成 `--gs-z: 0`。
`url()` 滤镜与这条**无关**（换干净 `blur()` 一样死）。

**弹窗遮罩（`.modal-mask`）曾经是材质板的祖先 —— 那也是同一个坑的另一副面孔。**
遮罩为了压过事件卡必须带 `z-index`（一张**合成面**），采样被截在它内部。
实测（同一块板、同一组条纹）：遮罩当祖先 → 保留率 **0.30**、板内亮 24.9；
搬进玻璃层内部当**兄弟** → **0.02**、45.1（菜单直通页面是 0.02 / 76.2）。
⇒ **任何"要压在材质板下面、又必须带 z-index"的东西，都只能画在材质板之前当兄弟，
不能当祖先**（`GlassSurface` 的 `layerPrefix` 就是给这个用的）。
⚠️ 因此**别用"把遮罩调淡"去解决弹窗不像玻璃**：结构不对时越淡材质越不糊
（0.55→0.15 保留率 0.30→0.48，到 0 就是 0.66 死）。结构改对后浓度才是亮度旋钮，
取 0.20 时弹窗板内亮度 74.4 对上菜单 76.2。

> **2026-09-25 第十三轮：遮罩加上了背景虚化，两处新踩的坑。**

**坑 A —— 浮层的定位层，包含块必须是视口；弹窗一律 portal 到 `document.body`。**
`.gs-layer { position: absolute; inset: 0 }` 的尺寸与原点都来自**最近的定位祖先**，
所以 `center: { top: '50%', left: '50%' }` 是不是屏幕中心，取决于弹窗被渲染在哪儿。
手机档的 `aside.sidebar` 是 `position: fixed; height: 66px` 的**贴底导航条**，
而「外观设置 / 云同步登录 / 确认框」三个弹窗恰好挂在它里面 ⇒ 定位层的实测矩形
就是那条导航条（**12,798 377×66**），锚点落在 (200.5, **831**) 而不是 (201, **437**)，
面板 440→**1222**（下越界 348px），内容的滚动条被推出屏外 ⇒ 用户报"下半部分全被遮住"。
修法写在 `GlassModal` 里（`createPortal(..., document.body)`）：body 与 #root 都不是定位祖先，
包含块退化为初始包含块（文档不滚动 ⇒ 等价视口）。层级不受影响（正 z 的遮罩 60/120、
材质板 70/130 仍压过手机导航条 100），React 事件仍沿组件树冒泡。
**以后往任何定位容器里塞浮层之前，先问一句：(0,0) 是不是屏幕左上角。**

**坑 B —— 降级档（iOS）的几何选择器必须带 `data-glass-engine` 前缀，别和 `.modal` 平权重。**
`.gs-fallback` 的选择器权重 (0,1,0) 与 `.modal` **相等**，而 `.modal` 里也有
`border-radius` / `box-shadow` / `width` / `padding` ⇒ 谁赢只由打包后的源序决定。
第十三轮就翻在这上面：`.modal.glass-host { border-radius: 0 }`（本来只为清**库面板**的老壳）
把降级档面板与它的 `::after` 镜面描边一起变成了**直角**，用户描述为"弹窗边框有一圈方形白色"
（实测可见面计算圆角 **0px**，应为 32px）。
⇒ 规则：**圆角/投影只清库面板那一档**（`.modal.glass-host:not(.gs-fallback)`），
降级档自己的几何写成 `.gs-layer[data-glass-engine='fallback'] .gs-fallback`（0,2,0）。
判据：`getComputedStyle(face).borderRadius === '32px'` **且** `getComputedStyle(face,'::after')`
也是 32px —— 后者才是那圈白线的直接来源。

**坑 C —— 遮罩虚化会让"材质保留率"的语义漂移，别把新读数当成材质坏了。**
`--gs-mask-blur`（默认 20px）虚化的是面板以外的整片背景，面板采到的背景因此
**先被糊过一道**：材质板再糊一道能拿走的对比度天然更少 ⇒ 同一块板、同一组条纹，
"材质开/关"的保留率从 0.02 抬到 0.29、Δmean 从 4+ 掉到 1.2~2.1，且方向变成染色主导
（`grad` 开/关几乎相同）。
判"材质有没有输出"要**在锐利背景下量**：`scripts/glass-material-probe.mjs` 为此新增一行
`弹窗 · 遮罩不虚化（材质自身贡献）`（把 `--gs-mask-blur` 临时置 0，实测 Δmean 6.01、
grad 3.76→5.35）；判"材质空心"的 0.35 门槛不变，"极弱"门槛据实测从 1.67 下调到 0.8
（理由写在 `scripts/glass-material-judge.py` 的 `WEAK` 旁）。
`tmp/mobile-dialog-verify.mjs` 也按这个口径出图（同一次运行里既量"遮罩虚化"也量"不虚化"）。

**坑 D —— 遮罩铺满整屏 ⇒ 面板正后面也被糊了一道、还压暗了（2026-09-26 第十四轮：在遮罩上挖洞）。**
遮罩是**铺满视口**的，而材质板排在它之后，所以"透过玻璃看背景"看的其实是「遮罩 × 页面」：
对比度掉、亮度掉，折射要的高频细节也被一起糊掉（位移滤镜能搬的只有边缘梯度）。
判据（把材质板自身材质关掉，只留遮罩）：面板内同一片条纹 std **2.2**（被遮罩糊平）
vs 把 `--gs-mask-blur` 置 0 时的 95.3（原样页面）。
修法是给 `.modal-mask` 加 8 层 `mask` 挖一个**与面板等大小、等圆角**的洞
（四条带 + 四个角块，**全部 `add`**，不用 `mask-composite: subtract` —— Safari 支持面更窄），
几何读 `.gs-layer` 上的 `--gs-panel-w/h` 与 `--gs-cx/--gs-cy`。
结果：面板内 119.0（锐利，53 倍）、面板外仍是 3.5（照旧糊）、透射亮度 **+16~17%**、
圆角弧外糊/弧内锐（证明是圆角洞不是包围盒）、交互不变（**`mask` 不参与命中测试**）。
不支持 `mask` 的引擎整条声明被丢弃 ⇒ 退回"铺满整屏"，与改前一致（安全降级）。
复现：`node tmp/mask-hole-verify.mjs --engine=fallback|chromium`。

**坑 E —— 浮层与"漆"必须共用一套视口坐标系；弹窗还要套一层 fixed 的视口盒（2026-09-26 第十五轮）。**
定位层是 `absolute; inset: 0` ⇒ 包含块是**初始包含块（布局视口）**；而遮罩原本是 `position: fixed`
⇒ 基准是**可见视口**。手机浏览器里这两个视口不重合（地址栏/系统栏的高度差），于是"面板"与
"挖掉的洞"整体错位 —— 用户报"所有面板和挖洞大小不匹配"（**本地无头复现不出来**：那里两个视口恒等）。
修法：`GlassModal` portal 的根套一层 `.gs-viewport{position:fixed;inset:0}`，定位层与遮罩都在它下面，
遮罩同步改 `absolute`；材质**不受影响**（fixed/z-index 只有挂在这一层自己身上才致命，挂外层祖先安全 ——
实测保留率仍 0.02）。⚠️ 该层是 fixed ⇒ **自成 stacking context，整棵弹窗的层级由它自己的 z 决定**
（桌面 70 / 手机 130，镜像 `.gs-layer--dialog` 的 `--gs-z`；手机 dock(100) 与菜单(50/110) 的相对顺序不变）。

**坑 F —— 弹窗限高别只减 `--app-height`。** 它在 standalone 下是 **100lvh（大视口）**，可以比**可见**高度更大
⇒ 面板比屏幕还高、上下都被切（实测：设 1000px 时上下各越界 17px、1200px 时各 78px）。
两处内容层限高写成 `calc(min(100svh, var(--app-height, 100dvh)) - N)`（`svh` 最小，兜底不可能超出可见区域）。

```
# 开发服务器
./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
PY313="C:/Users/Samuel/AppData/Local/Programs/Python/Python313/python.exe"

# ① 量磨砂 —— 无头页面级截图就够（第七轮起不必抢屏幕）
#    条纹插在被测浮层之前 + 同状态抓"材质开/关"两张 + 算保留率，见第七轮的那两组脚本
node tmp/menu-fix-verify.mjs && "$PY313" tmp/menu-fix-judge.py        # 菜单（含层级命中测试）
node tmp/dialog-oracle.mjs  && "$PY313" tmp/dialog-judge.py           # 弹窗（内容隐藏 + 双采样盒）

# ①'' 手机端弹窗三问：居中 / 圆角 / 背景虚化（第十三轮）
node tmp/mobile-dialog-fix.mjs --engine=fallback      # 复现 + 几何 + 祖先链 + 抓图
node tmp/mobile-dialog-verify.mjs --engine=fallback   # 量化验收（几何断言 + 交互 + 保留率）
node tmp/mobile-dialog-verify.mjs --engine=chromium
node tmp/desktop-dialog-check.mjs --engine=chromium   # 桌面档复核（portal 改动也影响桌面）

# ①' 系统级验收 —— 只在要"屏幕上真正长什么样"时用（会置顶窗口，别在开会时跑）
node scripts/glass-material-screen.mjs --out tmp/glassScreen
"$PY313" scripts/glass-material-screen.py tmp/glassScreen     # 打印 ✅/❌ 与因果判定
# 抓图前会把标题匹配的窗口置顶（Win32 SetWindowPos）；找不到红/绿标记块＝窗口被遮挡

# ② 材质结构 —— 定位层未被 fixed/z-index 截断、几何重合、染色、设置接线
node scripts/glass-material-probe.mjs --out tmp/glassMaterial
"$PY313" scripts/glass-material-judge.py tmp/glassMaterial      # 退出码 1 = 有宿主是空心的

# 结构/几何/可点性断言（34 项，只作旁证）
node scripts/liquid-glass-probe.mjs --out docs/probes/liquid-glass

# 修复前后对照图与染色候选图（读 tmp/glassCause 的历史帧，故只在有存档时有意义）
node scripts/glass-before-after.mjs --out tmp/glassMaterial/ba
node scripts/glass-tint-candidates.mjs --out tmp/glassMaterial/tint
"$PY313" scripts/glass-figs.py --out docs/probes/liquid-glass-shots
```

**最重要的两条**（完整结论见 `.workbuddy/memory/MEMORY.md` 第一节、报告见 `docs/probes/liquid-glass.md` 第零节）：

1. **材质的唯一宿主是 `.gs-plate`（材质板），它是面板的兄弟、挂在锚点层上。**
   不能在 liquid-glass-react 的子树里放 `backdrop-filter` —— 库根节点带 `transform`，
   在 Chromium 里它就是 **backdrop root**，后代的 backdrop 只有"根节点自己画过的东西"，
   而根节点背景透明 ⇒ 采到空白（这正是"所有弹窗全透明"的根因，**不是版本限制**）。
   同理**锚点不能带 transform**（动画会临时加）—— 材质会被抽干。
2. **别再用"断言全绿"当验收。** 曾出现 33 项断言全绿、而所有弹窗内部是全透明的：那些断言
   只验节点/属性/几何，**没有一项量"有没有东西被画出来"**。材质类改动必须跑上面的
   `glass-material-*`（判据是材质开/关的像素差 ≥ 0.6 且变化像素 ≥ 3%）。

已知未解释的观测：材质板存在时，库自己的 `span.glass__warp`（已 `display:none`）
仍会额外贡献一层糊化（关掉它 Δ16.27 / 80% 像素）。机制说不清，因此保持关闭（材质所有者唯一），
**要动这条先重跑材质探针**。

### 桌面端探针（CDP 接管真实窗口，网页探针替不了）

```bash
# 9222 常被别的 Electron host 占着，换 9333
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS
./node_modules/.bin/electron-vite dev --remoteDebuggingPort 9333
"C:/Users/Samuel/AppData/Local/Programs/Python/Python313/python.exe" tmp/focus-quadrant.py

node scripts/desktop-glass-cdp.mjs --port 9333                    # standard 档
node scripts/desktop-glass-cdp.mjs --port 9333 --mode shader       # shader 档
node scripts/error-boundary-check.mjs                              # 故意抛错，验兜底界面
```

三坑，都会让探针"看着在跑、其实什么也没量到"：

1. **必须 `unset ELECTRON_RUN_AS_NODE NODE_OPTIONS`**。沙箱会注入它们（后者是
   `--require=…/node-language-shim.cjs`），Electron 退化成纯 Node，报
   `Cannot read properties of undefined (reading 'whenReady')` —— **不是代码问题**。
2. **窗口被遮挡时渲染进程 rAF 被节流** → Playwright 的 `page.screenshot()` /
   `page.click()` 会一直等到超时（等 fonts / 等稳定帧）。改用原生 CDP
   `Page.captureScreenshot` 与 `page.evaluate(() => el.click())`，并先提窗口到前台。
3. **桌面端截图是 DPR 1.75**（1280×800 窗口 → 2240×1400 PNG），像素取样要先换算。

### 两条由「库量尺寸的时机」引出的硬约束（当天第三轮，都实测踩过）

库只在**挂载**与 `window.resize` 两个时刻用 `getBoundingClientRect()` 量自己，
两次都不可靠，且**错误会一直留着**：

1. **宿主被 CSS 隐藏时它会量到 0×0。** shader 档拿这个零去 `createImageData(0, ·)`
   抛 `IndexSizeError`；异常在 effect 里，而应用没有错误边界 → React 卸载整棵树 →
   **窗口只剩底色、"永久打不开"**（设置是持久化的）。另外三档不抛错，所以这个故障
   **只在 shader 档出现**，排查时别被"其他档正常"误导。
   两道修法都要留着：`GlassSurface` 用 **`getClientRects().length > 0`**（判"有没有布局盒"，
   不是"尺寸是不是零"）做挂载闸门；顶层 `components/ErrorBoundary.tsx` 兜底并给
   「重置外观设置并重载」出口。**新增任何会抛错的 render/effect 前先想清楚有没有边界。**
2. **`getBoundingClientRect()` 把祖先 transform 算进去。** 入场动画 `@keyframes pop-in`
   的 `scale(0.94)` 挂在祖先 `.gs-anim` 上 → 库把尺寸永久记成 0.94 倍 → 它那 6 层装饰
   （2 底色 + 4 镜面边）全部缩小，稳定后镜面边比玻璃体小约 14px；而动画期间材质板
   也停在 0.94、两者恰好重合，所以症状是**"动画里看着对、一稳定就错位"**。
   修法：`animationend`（`animationName === 'pop-in'`）时替库发一次 `window` 的 `resize`
   —— 那是库自己注册的重测入口。**故意不加"别的实例在动画就先别发"的守卫**（自愈设计）。
   自检：`.gs-anim` 里非 `.gs-panel` 子项的 `style.width` ÷ 玻璃体宽 **必须 ≈ 1.0000**，
   `desktop-glass-cdp.mjs` 已把它做成断言。

顺带量到的事实：**shader 档每打开一个玻璃层卡主线程约 1.3 秒**（长任务 3 个、最长 1276ms；
standard 档 0 个），其中 canvas API 只占 30ms，其余全在库的逐像素 JS 循环。
StrictMode 下 effect 双调用会翻倍，打包版约一半。

**Δ 的口径统一为「逐通道 0~255」**：曾经写成 `np.abs(a-b).sum(axis=2)`（逐像素三通道求和，
量纲 0~765），同一画面会报出 3 倍的 Δ，与文档/图注对不上。改判读逻辑时别退回求和。

