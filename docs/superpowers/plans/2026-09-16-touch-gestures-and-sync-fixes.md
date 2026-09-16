# 触摸手势与同步层修复方案

- 日期：2026-09-16
- 基线：`main`（`origin/main` 顶端，tag `v1.0.0`）
- 范围：四象限触摸层、周计划单日页拖动、云同步可靠性
- 状态：**待确认，未执行**
- 前置：`src/renderer/src/components/CloudLoginDialog.tsx` 等 4 个文件的改动已在工作区（未提交）

---

## 0. 结论摘要

用户报告的 6 项症状，经代码取证后归为 **3 个根因**，且其中 5 项的机制已被精确定位到具体代码行：

| # | 症状 | 根因归属 | 机制是否已定位 |
|---|---|---|---|
| 1 | 四象限 `touch-action:none` 与滚动冲突 | 根因 A | 是（但结论与直觉相反，见 1.2） |
| 2 | 四象限拖动不可靠 | 根因 A + B | 是（抓取偏移、长按 550ms、象限判定用锚点） |
| 3 | 周计划拖动后事件块泛白 | 根因 C | 是（`pointercancel` 未处理导致状态残留） |
| 4 | 周计划"缩小" | 根因 C | **否**，两个候选机制，需真机确认（见 2.3） |
| 5 | 时间轴拖动与滚动冲突 | 根因 C | 是（`touch-action: pan-y` 覆盖 + 无取消处理） |
| 6 | 触屏双击不可靠 | 根因 A | 是（依赖 `dblclick` 事件） |
| 7 | 手机无法呼出右键菜单 | 根因 A | 是（**规格违反**：规格要求长按开菜单，实装把长按绑成了拖动） |
| 8 | 网页端实时同步不可靠 | 根因 D | 是（7 条独立缺陷，含 2 条静默数据丢失路径） |

三个根因：

- **根因 A｜缺少统一的触摸手势内核。** 全仓没有 Tap / DoubleTap / LongPress / Drag 的状态机，每个页面各自用 `dblclick`、`contextmenu`、`setTimeout(550)` 拼凑，导致手势语义互相冲突（同一手势既是"拖动"又是"菜单"）。
- **根因 B｜拖动几何模型错误。** `moveEvent` 把事件卡左上角直接钉在指针位置，无抓取偏移、无居中；象限归属又按"锚点"判定。结果是卡片被抓起的瞬间跳位，且贴近坐标轴时反复翻转象限。
- **根因 C｜`pointercancel` 未被处理。** 全仓仅 2 处 `onPointerCancel`，均未复位页面级拖动状态。浏览器接管滚动 → 指针被取消 → `pointerup` 永不触发 → `drag` 状态永久残留。
- **根因 D｜同步层是"整份覆盖 + 单向推送"。** `user_data` 单行 jsonb，无行级时间戳参与判定，且**网页端启动时只读 localStorage、从不读云端**。

---

## 1. 四象限触摸层

### 1.1 现状取证

| 观察 | 证据 |
|---|---|
| 视口禁止所有浏览器手势 | `theme.css:617` `.quadrant-viewport { touch-action: none }` |
| 事件卡在移动端也禁止手势 | `theme.css:2559`（`max-width:767px` 块内）`.event-card { touch-action: none }` |
| 长按 550ms 绑成"开始拖动" | `EventCard.tsx:49-61` → `QuadrantPage.tsx:497-500`（`onEventLongPress` 仅设置 `dragRef`） |
| 右键菜单只由原生 `contextmenu` 触发 | `EventCard.tsx:73-77`、`QuadrantPage.tsx:502-504` |
| 双击新建依赖 `dblclick` 事件 | `QuadrantPage.tsx:460-474`、`:552` |
| 拖动无抓取偏移 | `QuadrantPage.tsx:428-432` → `eventRules.ts:30-42`（`x/y` 直接赋值为指针世界坐标） |
| 象限按锚点判定 | `eventRules.ts:39`（`quadrantOfWorldPoint(worldX, worldY)`） |
| 轴距在屏幕空间、落库在世界坐标 | `quadrantMath.ts:113-128`，`AXIS_GAP_PX = 10` 直接作用于 `rect.left/top` |
| 触摸时若命中事件卡则不平移画布 | `quadrantMath.ts:55-57` + `QuadrantPage.tsx:343-345` |

### 1.2 关于"`touch-action:none` 与页面滚动冲突"的修正

**结论：在四象限页面，`touch-action: none` 与页面滚动之间不存在冲突，不需要改。**

理由：`.quadrant-page` 是 `flex: 1` 的纵向 flex 容器（`theme.css:587-593`），`.quadrant-viewport` 是 `flex: 1`（`theme.css:609-618`），父链 `body { overflow: hidden }`（`theme.css:36`）、`.content { height: 100% }`（移动端 `theme.css:2174-2176`）。**该页面不产生滚动，也就没有"被 `touch-action` 挡住的滚动"。** 反之，`touch-action: none` 在这里是必需的：没有它，双指捏合会缩放整个网页而非画布。

真正被挡住的是**事件卡上的交互**：`EventCard.tsx:49-61` 在 `pointerdown` 时只登记触摸点，而 `QuadrantPage.tsx:343-345` 命中事件卡时**直接 return，不平移**。于是手指落在卡片上时：既不平移、也不拖动，必须原样静止 550ms 才进入拖动。手指一旦有轻微位移（<10px），长按仍有概率触发，但拖动起点已经偏移；位移更大则完全无事发生。**这是"拖动不可靠"的第一位原因。**

> 需要澄清的另一半：`touch-action: none` **确实**会阻止页面的双击缩放与文本选择——这是期望行为。但它与 `dblclick` 事件的可靠性无关，双击问题见 1.4。

### 1.3 交互语义定稿（建议）

规格已明确规定手机端的手势语义，实装与规格冲突。以规格为准

`docs/superpowers/specs/2026-09-03-mobile-portrait-web-design.md:73-76`：

> - 单指拖动画布；双指捏合缩放；双击空白区域新建事件。
> - **长按事件打开操作菜单；手机菜单呈现为底部 action sheet**，桌面仍为右键浮层。
> - 事件卡片支持拖动跨象限，放置后必须沿用现有业务规则更新 `quadrant`。

即：**长按 = 菜单**，拖动需要另辟路径。建议的手势表：

| 手势 | 命中空白画布 | 命中事件卡 |
|---|---|---|
| 单指轻触 | 取消选中 | 选中（出现选中态） |
| 单指移动 | 平移画布 | **拖动事件卡**（位移 > 8px 即触发，无需等待） |
| 长按（静止满 380ms） | 打开画布菜单（仅"粘贴"） | 打开底部 action sheet（修改信息/详细信息/复制/剪切/删除/保存） |
| 双击 | 新建事件 | 打开编辑 |
| 双指 | 捏合缩放 | 捏合缩放 |
| 右键（桌面） | 浮层菜单 | 浮层菜单 |

关键取舍：**卡片上的"移动即拖动"与"长按开菜单"共存**，判据是**位移**而非时间——

- 按下后位移 > `DRAG_SLOP`(8px) → 进入拖动，长按计时器作废；
- 静止满 `LONG_PRESS_MS`(380ms) → 卡片视觉抬起（`scale(1.04)` + 阴影）作为预告，此时**不弹菜单**；若抬起手指 → 弹菜单；若此时开始移动 → 转入拖动。

这是 iOS 主屏图标的判据，避免"长按必须静止"的脆弱性。

### 1.4 方案：抽出统一手势内核

新增 `src/renderer/src/lib/gestures.ts`（纯函数，可单测），所有页面共用：

```ts
export const DRAG_SLOP_PX = 8
export const TAP_MAX_MS = 320
export const LONG_PRESS_MS = 380
export const DOUBLE_TAP_MS = 280
export const DOUBLE_TAP_DIST_PX = 28

export type PointerPhase =
  | { kind: 'pressed'; id: number; x: number; y: number; t: number; moved: boolean }
  | { kind: 'dragging'; id: number; from: Point; last: Point }
  | null

/** 长按判据：静止且超过阈值时间。 */
export function isLongPress(phase: PointerPhase, now: number): boolean

/** 双击判据：两次轻触的时间与位移都在阈值内。 */
export function isDoubleTap(
  prev: { x: number; y: number; t: number } | null,
  next: { x: number; y: number; t: number }
): boolean

/** 位移是否超过拖动阈值。 */
export function exceedsSlop(from: Point, to: Point): boolean
```

配套一个钩子 `useCanvasGestures.ts` 负责：指针登记、`setPointerCapture`、**`pointercancel` 复位**、长按计时、双击判定、拖动回调。

需要落地的改动点：

| 文件 | 改动 |
|---|---|
| `lib/gestures.ts`（新） | 阈值常量 + 三个纯函数 |
| `hooks/useCanvasGestures.ts`（新） | 指针生命周期 + 计时器 + 取消复位 |
| `QuadrantPage.tsx` | `onPointerDown/Move/Up` 走手势内核；新增 `onPointerCancel`；`onDoubleClick` 改为自研双击判定（桌面保留原生 `dblclick` 兼容） |
| `EventCard.tsx` | 删除 550ms 长按绑定拖动的逻辑；`onLongPress` 语义改为"开菜单"；拖动手势由父级统一处理 |
| `theme.css` | `.event-handle` 在 `@media (hover: none)` 下隐藏（触屏没有 hover，14×14 的把手不可用）；`.event-card { touch-action: none }` 提到全局；新增抬起态样式 |

**为什么不用 `dblclick`：** 该事件在触屏上由浏览器合成，受 `touch-action`、两次轻触的位移与间隔、以及 `preventDefault` 影响，各浏览器行为不一致。自研判定（两次 `pointerup` 间隔 < 280ms、位移 < 28px）是确定性的。

### 1.5 拖动几何修正

现状 `moveEvent(id, worldX, worldY)` 把卡片左上角钉在指针上（`eventRules.ts:40`）。修正为：

1. **抓取偏移**：`pointerdown` 时记录 `grabOffset = 指针世界坐标 - 卡片左上角世界坐标`；拖动时 `newX = 指针世界坐标 - grabOffset`。卡片不再跳位。
2. **象限判定改用卡片中心**（或与当前象限的"面积占优"判定），而不是左上角锚点。避免贴轴时反复翻转。
3. **`clampEventToQuadrant` 的轴距改为世界单位**。当前 `AXIS_GAP_PX = 10` 是屏幕像素（`quadrantMath.ts:118-126`），却在世界坐标系里落库，导致缩放 2.5x 时合法的事件缩到 0.5x 后视觉轴距只剩 2px。改为 `AXIS_GAP_UNITS = 0.5`（= 10px @ zoom 1）。**这是一处数据语义变更，需要一次性迁移既有事件的坐标**，或接受"旧数据在极限缩放下有轻微越轴"（推荐后者，成本为零）。
4. **拖动过程中不落库**：当前每次 `pointermove` 都触发 `saveSoon`（`appStore.ts:298-305`）。改为拖动期间只更新本地视觉状态（`dragPreview`），`pointerup` 时提交一次。收益：减少 95% 以上的写入，并顺带消除"拖动中被实时同步回滚"的问题（见 3.4）。

---

## 2. 周计划单日页（`DayView`）

### 2.1 现状取证

| 观察 | 证据 |
|---|---|
| 移动端画布允许纵向滚动 | `theme.css:2629`（移动块内）`.day-canvas { touch-action: pan-y }`；桌面为 `none`（`theme.css:1241`） |
| 事件块没有自己的 `touch-action` | `theme.css:1050-1064` `.day-event` 无 `touch-action` |
| 长按 550ms 才开始拖动 | `DayView.tsx:129-137` |
| 画布只监听 `pointermove` / `pointerup` | `DayView.tsx:256-268`，**无 `onPointerCancel`** |
| 拖动时 `opacity: .86`（唯一的视觉变化） | `theme.css:1089-1093` `.day-event.dragging` |
| 「抬起放大」是死代码 | `theme.css:2560` `.day-event.touch-dragging { transform: scale(1.06) }`，但 `EventBlock` 从不接收该类名 |
| 吸附是"槽位插入"，失败即不移动 | `weekRules.ts:260-295`；`:292-293` 越界或重叠直接 `return null` |
| 预设拖动用 HTML5 DnD | `PresetPanel.tsx:59-69`（`draggable` + `dataTransfer`）；移动端点击替代（`:70`、`weeklyMobileLayout.ts:13-15`，规格 `:88` 明确"不要求 HTML5 拖放"） |

### 2.2 根因：滚动与拖动被同时触发

这是"冲突"的确切机制：

1. 手指落在事件块上，`touch-action` 的有效值 = 交集(`.day-event` 的 `auto`, `.day-canvas` 的 `pan-y`) = `pan-y`（触屏时 `.day-event` 没有覆盖）。
2. 手指纵向移动，浏览器判定为**滚动**：容器开始滚、并向元素派发 `pointercancel`。
3. `DayView` 没有 `onPointerCancel` 处理，但 `setTimeout(550)` 不会被取消 → 550ms 后 `beginDrag` 仍在执行。
4. 若此时指针已被取消，`canvas.setPointerCapture(e.pointerId)` 会抛 `NotFoundError`（未捕获）；若浏览器尚未取消（用户先静止 550ms 再移动），则 `setPointerCapture` 成功——**但滚动依然会发生**（pointer capture 不阻止滚动），于是事件块"跟着手指走"和"容器滚动"两个位移叠加，块体出现抖动/跳变。
5. 最终 `pointercancel` 到达时 `pointerup` 永不触发 → `drag` 状态残留 → `.day-event.dragging` 的 `opacity: .86` **一直挂着**，这就是"泛白"持续存在的原因。

### 2.3 关于"事件块缩小"的诚实说明

**以下是唯一未能从静态代码确定的症状。** 已排除的可能性：

- `.day-event` 拖动期间的 `height` 是常量（`DayView.tsx:292-297` 传入 `eventHeightPx(...)`，与拖动无关）；
- 无任何 `transform` 缩放作用于 `.day-event`（唯一的 `scale` 规则 `theme.css:2560` 从未生效）；
- 拖动期间的视觉差异**在代码上只有 `opacity: .86` 一项**。

两个候选机制，需真机确认：

- **候选 1**：`EventBlock` 从未接收 `touch-dragging` 类名（`DayView.tsx:286-301` 只传 `dragging`），导致规格中"抬起放大"的效果从未出现。与四象限页对比（那里 `EventCard` 会加 `touch-dragging` 并 `scale(1.06)`），周计划页的块体看起来就是"没有放大"/"相对缩小"。
- **候选 2**：`pointercancel` 后 `drag` 残留，用户此时若继续操作，`onCanvasPointerUp` 会以残留的 `drag.id` 执行 `moveWeekEvent`（`DayView.tsx:162-173`），块体跳到意外的槽位，加上 30 分钟事件本身只有 22px 高、标题字号降到 8px（`theme.css:1103-1106`），观感上像被压扁。

**处理方式**：本方案的拖动重写会**整体替换**这段实现（包括抬起态、状态复位、预览幽灵），两个候选机制都会被消除。实现第一步用真机录屏确认原始成因，若还有第三个原因，一并修掉。

### 2.4 方案：重写时间轴拖动

**CSS 层（最小、最关键的修复）**

```css
/* 全局，不再局限在 max-width:767px */
.day-event { touch-action: none; }
```

`.day-event` 设为 `none` 后，有效 `touch-action` = 交集(`none`, `pan-y`) = `none`：**从事件块开始的触摸不再触发滚动**，也就不会再有 `pointercancel`；从空白画布或左侧时间标尺开始的触摸仍是 `pan-y`，滚动保留。

**行为层**

| 项 | 现状 | 改为 |
|---|---|---|
| 起拖 | 静止 550ms | 位移 > 8px **或** 静止 220ms（先到者胜），并立即给出抬起态 |
| 拖动反馈 | 只改 `opacity` | `scale(1.03)` + 投影 + 半透明**幽灵预览**落在吸附位置，块体留在原位半透明 |
| 位置吸附 | 槽位插入，失败即不动 | 5 分钟吸附 + 贪心滑动到最近空位（见下） |
| 时间提示 | 无 | 拖动时在块体旁显示 `14:05–15:05` |
| 释放 | 直接提交 | 提交前二次校正；`Esc`/取消手势回滚 |
| 取消 | 无处理 | `onPointerCancel` 复位 `drag`、清除幽灵、不提交 |

**吸附算法**（替换 `snapEventStart`，保留在 `weekRules.ts` 便于单测）

```
desired = snapTo5(minuteFromOffsetY(指针 Y))
若 [desired, desired+duration) 与同日均无重叠 → 采用
否则：向移动方向以 5 分钟为步长搜索最近的不重叠位置（上限 ±12 小时）
      找到 → 采用；未找到 → 保持原位（不提交）
```

现状的"粘贴到邻事件边缘"策略（`weekRules.ts:281-291`）会让块体跳到与手指无关的位置，这是"拖动逻辑很基础"的直接来源。新策略保证"落点即所见"。

**预设面板**

规格 `:88` 明确"手机端不要求 HTML5 拖放"，实装的"移动端点击 → 创建表单"是符合规格的（`PresetPanel.tsx:70`）。桌面端 HTML5 DnD 可用但能力有限：无幽灵反馈、无落点预览、不支持触屏、不支持跨日。

| 选项 | 内容 | 成本 | 建议 |
|---|---|---|---|
| a | 保留现状，仅补 `dragend` 清理与落点预览 | 小 | 本期可选 |
| b | 统一改为 pointer 拖放，桌面手机一致，可跨日拖动 | 中 | 列为 P2，等移动端主体稳定后再做 |

---

## 3. 同步层

### 3.1 现状取证

| 观察 | 证据 |
|---|---|
| 网页端启动只读 localStorage，**从不读云端** | `appStore.ts:115-118` → `platformApi.ts` `createWebPlatformApi.loadData()`（读 `quadrant-web-data-v2`） |
| 网页端每次数据变更都自动整份 upsert 到云端 | `appStore.ts:99-104`（`if (!window.quadrantApi) void uploadCloudData(data)`） |
| 实时订阅只监听 `UPDATE`，不监听 `INSERT`/`DELETE` | `cloudSync2.ts:40` |
| 实时推送只写内存、不落盘 | `appStore.ts:128` `applyCloudData: (data) => set({ data })` |
| 桌面端不订阅实时 | `App.tsx:48-50` `if (!authenticated \|\| isDesktop) return` |
| 网页端没有任何同步按钮 | `Sidebar.tsx:102`（云按钮整体在 `isDesktop &&` 之下） |
| `syncData` 语义是"云端覆盖本地" | `cloudSync2.ts:20-30` + `appStore.ts:120-123` + `appStore.test` 中 `tests/cloudSync.test.ts` 的断言 |
| `updated_at` 字段存在但从未参与判定 | `cloudSync2.ts:27,35`（只写入、不比较） |
| 表结构是单行整份 jsonb | `supabase/schema.sql`（仅在 `dev` 分支，`main` 上已删除）：`user_data(user_id pk, data jsonb, updated_at)` |
| schema 中**没有**把表加入 realtime publication | 同上（若未通过控制台手工开启，实时推送根本不会到达） |
| 保存防抖 500ms，无退出落盘 | `scheduleSave.ts:1-6`；全仓无 `beforeunload`/`visibilitychange`/`before-quit` |

### 3.2 两条静默数据丢失路径（最高优先级）

**路径 ①：新设备/清缓存 → 覆盖云端为空。**

1. 手机清理浏览器数据（或换设备）后打开网页 → `loadData()` 读不到 localStorage → 返回 `defaultData()`（空数据）。
2. 用户随手点一下任何操作 → `saveSoon` → 500ms 后 `uploadCloudData(空数据)` → 云端行被整份覆盖。
3. 桌面端下次点"同步数据" → 拉到的就是空数据 → 本地也变空。**数据全失，且全程无任何提示。**

这也解释了用户观察到的"实时数据上传同步不可靠"：网页端**没有任何"从云端读取"的入口**，唯一的下行通道是实时推送，而实时推送在移动端后台挂起、WebSocket 断开期间会丢失全部变更；回到前台后不会补拉。

**路径 ②：桌面端"同步数据"覆盖本地。**

桌面端编辑不自动上传（`appStore.ts:102` 的条件），用户改完一堆内容后点"同步数据"，`syncData` 取云端整份覆盖本地（`cloudSync2.ts:26`）→ 桌面端的修改全部消失。按钮名字"同步"暗示双向，实际是单向下载。

### 3.3 目标语义（先定义，再实现）

| 操作 | 语义 | 冲突处理 |
|---|---|---|
| 自动保存（网页端每次编辑） | 本地落盘 + 上传云端 | 上传前比对云端 revision；不一致时先拉取合并，若无法合并则**提示用户**而不是静默覆盖 |
| `上传到云端`（桌面，按钮已加到"同步数据"上方） | 本地 → 云端，整份覆盖 | 上传前拉取云端元信息，若云端更新更迟则弹出确认"云端有更新的数据，继续将覆盖" |
| `从云端恢复`（原"同步数据"） | 云端 → 本地，整份覆盖 | 本地有未上传改动时弹出确认 |
| 实时（网页端 + 桌面端） | **通知 + 主动拉取** | 收到通知后先比对 revision，仅当云端更新才拉取并落盘 |

**建议把桌面那两个按钮改名**为「上传到云端」「从云端恢复」，并各自显示差异摘要（本地 N 条 / 云端 M 条 / 云端最后更新于 X）。当前 `ConfirmDialog` 只接受单条 `message`，扩展一个可选 `detail` 字段即可。

### 3.4 一期方案：修可靠性与数据安全（建议本期做）

按依赖顺序：

1. **同步元信息独立存储。** 新增 `SyncMeta { lastPulledAt, lastPushedAt, cloudRevision, deviceId }`，存于 `localStorage`（网页）/ 独立的 `sync.json`（桌面，经新 IPC）。**不要塞进 `AppData`**（避免污染同步载荷）。
2. **启动即拉取。** `init()` 改为：读本地 → 拉云端元信息 → 若云端 `updated_at` 晚于 `lastPulledAt`，或本地是空数据而云端有数据 → 采用云端并落盘。
3. **空数据写入保护。** 若本地为 `defaultData()` 且云端有非空数据 → **禁止自动上传**，改为拉取。（修正路径 ①）
4. **落盘。** `applyCloudData` 增加 `getPlatformApi().saveData(data)`。（修正路径 ②的一半）
5. **实时改为 broadcast "通知 + 拉取"。** 上传成功后向 `channel('quadrant-sync')` 广播 `{ revision, deviceId }`；其他设备收到后按 revision 拉取。理由与收益：
   - 规避 `postgres_changes` 的 payload 上限（jsonb 整行随数据增长，**加了照片之后必然撞上**）；
   - 不依赖 `UPDATE`-only 的订阅（修正首次 upsert 时 `INSERT` 收不到的问题）；
   - 不需要 `ALTER PUBLICATION`，避免"实时根本没开"这类不可见的配置缺失；
   - 自带回环抑制（比对 `deviceId`）。
6. **前台恢复即同步。** `document.addEventListener('visibilitychange')` 与 `window.addEventListener('online')` → 触发一次拉取。**这是移动端最关键的一条**：Safari 冻结后台页面会断开 WebSocket，恢复时必须补拉。
7. **退出落盘。** `pagehide`/`beforeunload` → 取消防抖并立即保存；桌面主进程加 `before-quit` 等待最后一次 `data:save` 完成。（当前 500ms 窗口内关页面会丢最后一批编辑。）
8. **拖拽期间不落库**（与 1.5 配合），顺带消除"拖动中被实时回滚"。

一期完成后：**不会再有静默数据丢失**，跨设备同步在"整份覆盖"语义下可靠。

### 3.5 二期方案：行级 LWW（是否做取决于使用方式）

一期仍是"整份覆盖"，「手机改一处、桌面改一处」时后写者胜，先写者的改动仍会丢。要真正解决，需要把同步粒度降到行：

```
表拆分：goals / goals_subtasks / quadrant_events / week_presets / week_events / stickers
每行：id, user_id, updated_at, deleted_at（软删）
客户端合并：按 id 归并，updated_at 大者胜；deleted_at 非空则视为删除
```

前提与成本（必须在决定前知道）：

- **需要给每个实体加 `updatedAt`**。当前实体只有 `createdAt`，`QuadrantEvent`/`WeekEvent`/`Goal` 均无修改时间戳 → 属于**数据模型变更 + 迁移**，不是纯同步层改动。
- 新增 5–6 张表、对应 RLS、迁移脚本、逐实体 merge 函数与测试。`AppData.version` 可保持 2（序列化格式不变），但 `AppData` 类型要加字段并升到 3。
- **不建议上 CRDT**（Yjs/Automerge）：单用户双设备的场景下，收益远低于引入的复杂度与体积。

**判定标准**：如果实际是"手机为主、桌面偶尔整份覆盖"，一期足够；如果是"两端交替编辑"，二期必须做。此项请确认。

---

## 4. 实施顺序与验收

| 阶段 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| S1 | 手势内核 + 四象限手势重写（含菜单、双击、取消处理） | — | 真机（iOS + Android）逐条手势表通过；新增 `gestures.test.ts` 全绿 |
| S2 | 拖动几何修正（抓取偏移、中心判象限、拖动不落库） | S1 | 拖 20 次无跳位；贴轴不翻转 |
| S3 | 周计划拖动重写（`touch-action`、幽灵预览、吸附算法、取消处理） | S1/S2 的手势内核 | 真机纵向拖动不滚动、不残留泛白；新增 `weekSnap.test.ts` |
| S4 | 同步一期（元信息、启动拉取、空数据保护、broadcast、前台恢复、退出落盘） | — | `cloudSync.test.ts` 扩展；双设备手工验证 6 个场景 |
| S5 | 桌面按钮语义（改名、差异摘要、上传前守卫） | S4 | — |
| S6 | 预设面板 pointer 拖放（可选） | S3 | — |
| S7 | CI 加门禁：`typecheck` + `test` | — | PR 上自动运行 |

**验证环境**：`playwright-core` 已是 devDependency，`scripts/visual-self-check.mjs` 已存在，可扩展一个 375/390/430 三视口的触摸冒烟脚本；真机验证不可省略（模拟触摸无法复现 iOS Safari 的 `pointercancel` 时序）。

**每阶段完成后**：`./node_modules/.bin/tsc --noEmit -p tsconfig.node.json && ./node_modules/.bin/tsc --noEmit -p tsconfig.web.json && ./node_modules/.bin/vitest run`

---

## 5. 明确不做的事

| 不做 | 理由 |
|---|---|
| 引入 tldraw / Excalidraw / AFFiNE 等画布库 | tldraw 许可非 OSI 且含商业条款；当前规模（每象限 ≤ 30 事件）用 DOM + CSS transform 是更优解 |
| 上 CRDT | 单用户双设备，收益低于成本 |
| 重写为 Canvas 场景图 | 现有 DOM 层已正常，重写不解决任何已报告的问题 |
| 把密钥写回客户端 | 见上一轮的处置结论 |
| 改象限坐标系或位置语义 | 规格 `:56-67` 明确禁止 |
| 用 base64 把图片塞进 `AppData` | 见贴纸方案文档第 4 节 |

---

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 手势重写引入回归 | 手势内核为纯函数 + 单测；`EventCard`/`DayView` 的改动集中在事件处理器，不触碰数据层；每阶段可独立回滚 |
| `.day-event { touch-action: none }` 让"从事件块起滑滚动"失效 | 保留左侧时间标尺与空白区域可滚；若实测不接受，改用"块体左侧 44px 拖动条"方案（见 2.4 取舍表） |
| 轴距改世界单位影响既有数据 | 采用不迁移方案（旧数据仅极限缩放下轻微越轴），零成本 |
| 同步改动涉及线上数据 | 一期只增加保护与拉取，不改写云端格式；上线前用 `v1.0.0` tag 对应的 `plan.json` 做一次备份 |
| iOS Safari 的 `pointercancel` 时序与 Android 不同 | 真机双向验证；手势内核不依赖单一事件路径 |

---

## 7. 待你确认的决策点

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| D1 | 周计划拖动的手势取舍 | ① 整块拖动 + 220ms 拾起（牺牲"从块上起滑滚动"）② 块体左侧 44px 拖动条（保留滚动） | ①，代价小、手感好；时间标尺与空白区仍可滚 |
| D2 | 同步二期（行级 LWW）是否本期做 | ① 只做一期 ② 一期 + 二期 | 先做一期，观察一周后再定 |
| D3 | 桌面按钮命名 | ① 保留"上传数据/同步数据" ② 改为"上传到云端/从云端恢复" | ②，避免误操作丢数据 |
| D4 | 预设面板是否改 pointer 拖放 | ① 仅补清理与预览 ② 完整重写 | ①，本期 |
| D5 | "缩小"症状是否先做真机取证 | ① 先录屏确认再动手 ② 直接按本方案重写 | ②，重写会覆盖该成因 |
