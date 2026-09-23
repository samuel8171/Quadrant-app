# 象限（Quadrant）· 交接文档

> 生成时间：2026-09-23 19:50（GMT+8）
> 当前 HEAD：`2761003`（未提交工作区有本轮改动）｜ 远端 `main`：`2761003`

---

## 0. 一句话现状

**本轮修完用户报告的四条问题**（照片上云、桌面端点击展开、单张照片删除、手机端画布平移）。
代码已通过 204 项单测 + 两套构建 + 12 项浏览器探针，**尚未提交推送**。
**照片上云的最后一个前置条件未满足**：Supabase 的 `attachments` bucket 还不存在（见 §3）。

---

## 1. 本轮完成的四件事

### 1.1 照片实体改为 Supabase Storage 云端存储（用户第 1 条）

用户原话：「照片压缩后需要存储在 supabase 云端，不能放在 database 里，放 file storage」。

**结论：代码已就绪，但 bucket 需要你先手动建一次**（`schema.sql` 的 storage 段从未执行过）。

- 新增 `src/renderer/src/lib/cloudPhotos.ts`：`uploadPhoto` / `downloadPhoto` / `deleteCloudPhoto`，
  路径 `attachments/<uid>/<photoId>.jpg`，与 `schema.sql` 的 RLS 策略
  （`(storage.foldername(name))[1] = auth.uid()::text`）严格对应。
- `photoStore.ts` 改为**本地优先、云端兜底**：
  - 写：先落 IndexedDB（必成），再 `void uploadPhoto(...)` 异步上云（失败静默）。
  - 读：本地命中即返回；本地没有（换设备 / 清了浏览器数据）→ 拉云端 → **回写本地缓存**。
  - 删：本地与云端**都删**（只删本地会让已删照片在换设备后"复活"）。
- 全部失败路径**不抛异常**：照片是附件，云端不可达时退化成纯本地，
  绝不能因为一次上传失败让"加照片"这个动作整体报错。`tests/cloudPhotos.test.ts` 专门守这条契约。

### 1.2 电脑版四象限点击事件照片不展开（用户第 2 条）

**根因**：`QuadrantPage` 的 `gestures.onTap` 开头就是 `if (ctx.pointerType === 'mouse') return`，
而画布只绑了 `onDoubleClick`——**鼠标单击这条路根本没人处理**，所以缩略图条永远不展开。

修法：新增 `onViewportClick`。因为原生双击的事件序列是 `click → click → dblclick`，
所以单击动作**延迟到双击窗口之后**（`DOUBLE_TAP_MS`）才执行，`dblclick` 一到就取消它——
否则双击一个带照片的块会先开合两次再弹编辑框，视觉上"闪一下"。

### 1.3 新增单张照片删除（用户第 3 条）

- 缩略图右上角加删除叉。**平时 `pointer-events: none` 不可点**（它和"点图看大图"抢同一块区域，
  常驻可点会导致手机上想放大时频繁误删），露出条件两条：桌面 `:hover`、触屏在缩略图条上长按 500ms。
- 删除是**两步**：第一下变红放大进入"确认删除"态，3 秒内再点一下才真删（超时自动复位）。
- 删除时三件事一起做（漏一件就出问题）：摘 id → 删实体（本地+云端）→ **`forgetPhotoUrl` 清 object URL 缓存**。
  另外修正 `viewer.index`：正开着查看器删掉当前张时下标夹回有效范围，一张不剩就关掉查看器。

### 1.4 手机端四象限无法拖动、只能双指缩放（用户第 4 条）

**根因**（探针实证，不是推断）：`useCanvasGestures.onDragStart` 的 canvas 分支写得没错
（触摸单指应当平移），但它**对触摸永远不会被调用**——状态机在 `requiresLongPressToDrag()`
为真时，未长按解锁的位移只标记 `moved`、不发 `dragStart`，于是 `panRef.current` 从未被设置，
`applyPan` 每次都早退。实测 `pointerdown:touch → pointermove:touch ×3 → pointerup:touch`
全部到达，`.event-layer` 的 transform 纹丝不动（`matrix(1,0,0,1,183,369)` 前后一致）。

修法：给手势内核加 `requiresLongPress` 选项（默认仍按指针类型取值）。
**四象限画布传 `false`**——它没有滚动，不存在"拖动与滚动争抢"这个前提，长按闸门只剩纯损耗。
该标志存在**指针对象上**而非每帧重算，保证一次手势内判定一致。
`DayView`（时间轴）未传该选项，**保持 `true`，滚动行为一字未改**。

---

## 2. 本轮真正的难点：推送链路

代码其实早就写完了，**卡住的是提交推不上去**。

### 2.1 背景

本机 `git push` 的 HTTPS 传输通道**彻底不通**，不要重试：

- 清空代理直连 → `Failed to connect to github.com:443`
- 配置里的代理 `127.0.0.1:7897` → 死端口
- 环境变量里的 `127.0.0.1:14829` → 只扛得住 `ls-remote` 这种小请求；
  push 几 MB 会 `schannel: server closed abruptly` 或 `CONNECT tunnel failed, response 502`

**唯一出路**：`bash scripts/api-push.sh`（走 GitHub REST Git Data API，`api.github.com` 直连稳定）。

### 2.2 为什么这次才炸

`api-push.sh` 此前**只用单提交推送验证过**。一次推 4 个提交时，四处潜伏假设同时失效：

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| 1 | 快进判定用 sha 相等 | 误报「远端有本地没有的提交」 | 改 `git merge-base --is-ancestor` 判祖先；取不到远端 sha 时保守回退到相等判定 |
| 2 | 只创建 HEAD 的提交对象 | `422 Parent SHA does not exist` | 按 `git rev-list --reverse` 从旧到新逐个建（API 要求 parent 已存在） |
| 3 | 对象清单只从 HEAD 导出 | `422 Tree SHA does not exist` | 对链上**每个**提交都跑 `ls-tree`——中间提交的树可能含 HEAD 已删的 blob |
| 4 | 树重建按「路径」索引 | 子树 sha 不匹配 | 改按 **sha** 索引（`trees.tsv`）；同一路径在不同提交下内容不同，按路径合并会重建出错误的树 |

缺陷 4 的具体证据：`src/renderer/src` 同时存在 `7ffd9b5…`（在 `4cc0d62`）与 `0ed08e6…`（后续提交），
两棵树的**子项名完全相同、子项 sha 不同**。顺带修掉子树条目名被 `slice()` 截断的 bug
（`Doc.test.ts` 被截成 `dec.test.ts`）。

### 2.3 两个环境陷阱

1. **Windows Python 在管道里会把 `\n` 翻成 `\r\n`**。下游 `read -r` 拿到 `"072875f…\r"`，
   `"<sha>\r^{tree}"` 是非法对象名，git 报「对象库缺少树」而对象明明存在。
   修法：`sys.stdout.buffer.write` + 防御性 `tr -d '\r'`。
   注意 `$(git ...)` 命令替换是**安全**的（bash 会剥掉尾部 `\r`），危险只在管道 / `read`。
2. **`ls-tree` 失败与空树输出都是空**，无法区分。改为先用 `git cat-file -e "$sha^{tree}"` 校验存在性。

### 2.4 关键转折：写离线校验器

一次真实推送约 **5～6 分钟**（逐个 HEAD 探测 200+ blob），而树重建的错误**只在最后一步才炸**。
写了 `scripts/verify-trees.mjs` 后反馈周期压到**几秒**，立刻定位出 `slice()` 截断。

还发现一处「校验器自己错了」：我按 `git ls-tree` 显示的 `040000` 重建，18/59 不匹配；
用 `od -c` 看 git 对象格式实际写的是 **`40000`（5 位）**。GitHub API 接受 `040000` 并自行归一化，
所以这只坑了自写的校验器（已加 `normalizeMode`，随后 59/59 全过）。

---

## 3. 当前提交链

```
2761003  fix(git): 修复 api-push 在「一次推多个提交」下的四处缺陷   ← HEAD / 远端 main
4767c94  chore(git): 增加树重建的离线校验工具（verify-trees.mjs / gen-trees-tsv.sh）
20a646d  fix(git): 推送脚本的祖先校验改为支持一次推多个提交
783958a  feat(quadrant): 事件块支持照片附件（上限 3 张，含大图查看器）
4cc0d62  revert(review): 周日复盘滑动条回退到上一版样式
a41bc13  fix(web): 修掉手机端四项遗留缺陷（状态栏/滑块配色/标题对齐/圆形勾选框）
87648b5  fix(web): 修复手机端五项问题（缩放/安全区/导航高度/滑块投影/手势误触）
63f6189  chore(git): 增加走 REST API 的推送脚本，并钉死换行符策略
```

`2761003` 是**让推送脚本推它自己**——用一个刚改完的工具完成它唯一能做的那件事，最直接的回归验证，通过。

### 验证结果（全部通过）

- CI **success**、Deploy web app **success**（每次推送都验，共 3 轮）
- 线上 `index.html` 引用 `assets/index-BUiuFZT2.js` + `assets/index-gomA9vKs.css`，
  与本地 `dist-web/assets/` **逐名一致** → 照片功能确认已上线
## 4. 验证结果（本轮，全部通过）

- 单测 **22 文件 / 204 项 / 0 失败**（新增 `tests/cloudPhotos.test.ts` 10 项 + `gestures.test.ts` 扩 4 项）
- `tsc` 双配置 **0 错误**；桌面端 `electron-vite build` 与网页端 `vite build` **均成功**
- 浏览器探针 `tmp/quadrant-fixes-probe.mjs` **12/12**（桌面 9 项 + 手机 3 项）
- `DayView`（时间轴）长按闸门保持 `true`，滚动行为未被本轮改动影响

---

## 5. 下一轮该做什么（按优先级）

### P0 · 建 `attachments` bucket（照片上云的最后一步，**必须你手动做**）

**这是本轮新增的唯一阻塞项。** 实测证据：

```
GET /storage/v1/bucket/attachments   → 404 {"error":"Bucket not found"}   ← bucket 不存在
GET /rest/v1/user_data?select=…      → 200 []                              ← anon key 有效、项目可达
```

`supabase/schema.sql` 里第 4 段（`insert into storage.buckets ... 'attachments'` 与四条 RLS 策略）
**从未在 Supabase 项目里执行过**。在控制台 → SQL Editor 里把该段单独跑一次即可（可重复执行，不会破坏数据）。

跑完用这条自检：

```bash
curl -s --noproxy '*' "https://nktsnjbkvdyhxdjfbxkh.supabase.co/storage/v1/bucket/attachments" \
  -H "apikey: sb_publishable_oPq0EiI_ofPDz2q0iy9EUQ_byXMWSk5"
```

返回 bucket 的 JSON（而非 `404 Bucket not found`）即为就绪。

**建之前功能不会坏**：`uploadPhoto` 失败返回 `false`，照片静默降级为纯本地
（当前设备正常看，换设备看不到）。所以这是"增强缺失"，不是"功能故障"。

### P1 · 桌面端照片功能端到端验收（沿用上一轮结论，仍未做）

- `%APPDATA%/象限/photos/` **不存在** → Electron 端照片存储一次都没写入过
- 最新 exe 是 `dist/象限-1.2.0.exe`（9/18 10:26），照片功能是 9/23 之后才做的
  → **桌面端 exe 不含照片功能**（本轮新增的照片上云/删除同理不含）

步骤：`electron-vite build` → `electron-builder --win portable` → 在 Electron 里加照片、
确认落盘、确认重开仍在、确认大图查看器与删除可用。

**打包前先抬 `package.json` 的 version**（当前 `1.2.0`），否则覆盖 `dist/` 里已发布的 exe；
`package-lock.json` 有两处 `version` 需同步手改（本机 npm 不可用）。

### P2 · 手机端「苹果风」四层 CSS 方案（至今只是评估，未落地）

用户曾给过 `rdev/liquid-glass-react`，希望网页手机端更有苹果风。
**核心结论：他目标设备上真折射拿不到**——他用 iPhone 开 Edge/Safari，iOS 上所有浏览器强制走 WebKit，
而该库的折射依赖 `backdrop-filter: url(#svg)`（Chromium 独占），
代价照付（Canvas 生成位移贴图 + 指针监听）、视觉收益为零。

**更根本的缺口**：`--bg: #0f1115` 是纯深灰，全站只有 2 处渐变。模糊一片纯色还是一片纯色——
这才是「看着廉价」的真正原因，不是模糊不够。

方案定为**四层结构**（背景层→材质层→高光层→边界层），不引入任何库，纯 CSS。
第一步是给 `body::before` 加极光渐变作背景层，让玻璃终于有东西可糊。

> 用户原话里的「**联合之前的方案**」如果指的就是这个，那还没兑现——**建议先向用户确认**。

附带注意：Safari 26 会把 `opacity: 0` 的固定遮罩也纳入 tinting 采样，
隐藏遮罩必须用 `display: none`；伪元素对 tinting 算法不可见（所以 `.sidebar::before` 承载玻璃是有效规避）。

### P3 · 待用户决定的清理项

- `D:/Samuel/quadrant-backup-2026-09-16-pre-s4s7/`（**6.2M**）——是否删除
- `tmp/` 下的临时产物：`quadrant-photo-drag-probe.mjs`、`touch-arrival-probe.mjs`、
  `quadrant-fixes-probe.mjs`、`alltests.txt`、`build-*.log`、`devserver.log` 等
- `src/renderer/probe/main.tsx` 里的 `window.__probeStore` 钩子（不在构建产物内）

---

## 6. 本轮新增的代码事实（改前必读）

### 照片存储的三层结构

| 层 | 位置 | 职责 |
|---|---|---|
| 记录层 | `QuadrantEvent.photos: string[]` | **只存 id**，随 `AppData` 同步到 `user_data` 表 |
| 本机实体 | 网页 IndexedDB / 桌面 `userData/photos/` | 必成的那一份，读写零延迟 |
| 云端实体 | Supabase Storage `attachments/<uid>/<id>.jpg` | 换设备可见；失败静默降级 |

读取是**本地优先、云端兜底**，云端命中后回写本地缓存。
新增/改动事件字段仍要同步**三处**（`platformApi.validAppData`、`main/dataCodec.normalizeEvent`、
`shared/types.ts`），漏一处静默丢数据。

### 两个"闸门"别搞混

- `gestures.requiresLongPressToDrag(pointerType)` —— **按指针类型**的默认值
  （触摸/笔 true、鼠标 false）。时间轴依赖它。
- `useCanvasGestures({ requiresLongPress })` —— **按容器**覆盖该默认值。
  四象限画布传 `false`（无滚动，不需要闸门）；`DayView` 不传，保持 `true`。
  该标志存进 `MachinePointer.needsLongPress`，一次手势内固定不变。

**排查"手机端拖不动"时先看这条**：闸门开着时，未解锁的位移只标记 `moved`、
永不发 `dragStart`，于是 `panRef`/`dragRef` 都不会被设置，表现为"完全没反应"。

### 鼠标单击与双击必须共享一个定时器

原生双击的事件序列是 `click → click → dblclick`。`QuadrantPage.onViewportClick`
用 `clickTimerRef` 把单击动作延迟 `DOUBLE_TAP_MS` 执行，`onDoubleClick` 一到就 `clearTimeout`。
**新增任何鼠标单击行为都要走这个定时器**，否则双击会同时触发单击 + 双击两个效果。

---

## 7. 关键操作备忘（下一轮直接照用）

### 推送

```bash
bash scripts/api-push.sh --dry-run   # 先校验
bash scripts/api-push.sh             # 实推，必须后台跑（全程 5～6 分钟，前台会超时）
```

- 脚本自己会取 token、算链、判祖先、补对象、建提交、更新 ref
- **远端 commit sha 与本地逐字节一致**，不做任何本地改写
- 增量有效：只上传缺失的 blob/tree，不为历史提交重复上传

### 查 CI / 部署

```bash
curl -s --noproxy '*' "https://api.github.com/repos/samuel8171/Quadrant-app/actions/runs?per_page=4"
```

（本机**无 `gh` CLI**；`--noproxy '*'` 是必须的）

### 校验树重建（秒级，推荐每次推送前跑）

```bash
node scripts/verify-trees.mjs
```

### 本轮探针（开发服务器需先起）

```bash
./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
node tmp/quadrant-fixes-probe.mjs        # 12 项：桌面点击展开/双击/删照片 + 手机平移
node tmp/quadrant-photo-drag-probe.mjs   # 复现原始缺陷用（修复前 FAIL、修复后 PASS）
```

### 其他环境事实

- 本机 **npm shim 异常**，脚本一律直接调 `node_modules/.bin/` 下的可执行文件
- 沙箱**拦子进程**：Node 里 `execFileSync`/`spawn` 调 git 报 `EBUSY (-4082)`，
  即使给绝对路径也一样 → 需要 git 输出时，在 shell 脚本里取好再经环境变量传给 Node
- `vitest run` **传多个路径会触发临时写入 shim 报 EPERM**，产生假 Errors → **逐文件跑**
  （用 `--reporter=json` + Python 解析计数，直接 grep 会被 ANSI 色码干扰、误报 0 通过）
- 端口 **5199** 平时空着，用完记得关（本轮起过一个，已随会话结束）
- 唯一可用浏览器是系统 Edge：`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`
- CI 锁 **Node 20**（与 Electron 31 内置 Node 同代），本机开发是 Node 22+
- 网页端由 `.github/workflows/deploy-pages.yml` 在 push 到 main 时自动部署到
  https://samuel8171.github.io/Quadrant-app/，产物路径 `dist-web`
- Supabase 的 URL 与 anon key **硬编码在 `src/renderer/src/lib/cloudSync2.ts`**
- `.git` 曾遭破坏，当前已 `maintenance.auto false` / `gc.auto 0` / `gc.autoDetach false`
  —— **不要重新打开自动维护**
- 探针须走 `/probe.html?page=weekly&sidebar=1`（`/` 是登录页）

---

## 8. 唯一阻塞项

**建 `attachments` bucket**（见 §5 P0）。在此之前照片仅存本机、换设备不可见。
其余工作（四条修复）已完成、已通过全部验证，**但尚未提交推送** —— 工作区有本轮改动。
