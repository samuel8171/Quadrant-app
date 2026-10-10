# 象限 · 周计划预设「拖动换位」动画 —— 方案调研与设计

- 日期：2026-10-09
- 基线：本地工作区（已含 `lib/presetReorder.ts` + `PresetPanel` 排序模式，见
  `docs/probes/goal-history-preset/report.md`）
- 性质：只读调研 + 方案设计 + **当天落地**（见 §零）
- 方法：

---

## 零、决定与落地结果（2026-10-09 当天补充）

用户拍板：**① 插入让位**（不是对调）**② 跟手抬起** **③ 引 `@formkit/auto-animate`（3.2 kB）**。
实现走 §5（auto-animate），**没有**走 §4 的自研 FLIP；但结构上取了 §4 的一个关键结论，见下。

### 实际结构：隐身本体 + 幽灵副本

`@formkit/auto-animate` 用 WAAPI 播让位动画，而 **WAAPI/CSS 动画在层叠里高于内联样式** ——
如果让被拖的那张卡片自己跟着手指走（内联 `transform`），它的 `transform` 会被库的动画盖掉。
所以拆成两半：

```
.preset-list                     ← useAutoAnimate 挂这里（MutationObserver: childList）
  ├─ .preset-card                ← 被拖的那张：visibility: hidden，**仍占着槽位**
  │                                 它自己就是"让位后的空位"，且不会参与跟手
  └─ .preset-card …
document.body
  └─ .preset-card.preset-drag-ghost   ← portal 出来的跟手副本（fixed + translate3d）
```

- 拖动期间按**草稿顺序**渲染 ⇒ DOM 子节点真的换位 ⇒ 库对所有位移的子元素做 FLIP（让位）。
- 幽灵挂 `document.body` 是**必须的**：手机档 `.preset-panel` 带 `backdrop-filter`，
  它会成为 fixed 后代的包含块，面板自身的 `overflow: hidden` 会把幽灵裁掉。
- 指针事件改挂 **window**（不再靠拖柄的 `setPointerCapture`）：被拖卡片隐身/被 React 移位时，
  捕获关系不可靠；`touch-action: none` 仍在拖柄上（按下即锁存，整段手势不退化）。
- 松手：目标槽位**直接取按下时测得的第 `index` 个槽位**，不去 DOM 重测（提交后 React 是异步重排的，
  当场读到的是旧位置）。幽灵用内联 transition 飞过去，落位结束后再让本体显形。

### 实测（`scripts/goal-history-preset-probe.mjs`，桌面纵向 + 手机横向各一遍，全绿）

| 判据 | 桌面（y 轴） | 手机（x 轴） |
| --- | --- | --- |
| 幽灵跟手误差 | dx=0.00 / dy=0.00 | dx=0.00 / dy=0.00 |
| 兄弟块位移量 | 212 → 122 | 177 → 33 |
| 让位**补间**帧数 | 7 / 55 帧处于中间态 | 7 / 55 帧 |
| 采样序列（前 12） | 212,212,…,200,166,141,134,129,… | 177,177,…,139,84,56,… |

体积：网页端 JS `663.59 → 674.32 kB`（gzip `216.24 → 220.07 kB`，**+3.83 kB**），CSS 无变化。
`npm ci --dry-run` 通过（无 peer 冲突）。

### 一个顺带的副作用（已知、接受）

库对 `childList` 的**新增/删除**也做动画（新增 1.5× 时长 + `ease-in`，删除 `ease-out`）。
也就是说**新建/删除预设、以及空态 `.preset-empty` 的切换现在也有过渡**了 ——
这不在需求里，但属于该库的固有行为，观感上是改善，故保留。

---
- 方法（原始调研部分）：
  ① GitHub API 核实星标 / 归档状态 / 最近推送（数据截至 2026-10-09）；
  ② npm registry 核实 `peerDependencies`（React 版本）；
  ③ bundlephobia 核实 min / gzip 体积与依赖数；
  ④ 直读 `formkit/auto-animate` 与 `clauderic/dnd-kit` 源码确认实现细节（文档站是 SPA，抓不到正文）。

---

## 一、现状：现在这套拖拽**没有位置动画**

已经做完的部分（2026-10-09）：

- `lib/presetReorder.resolveDropIndex(targets, draggedId, pointer)` 用**中线判据**解出插入位，
  轴向由调用方喂的 `start/size` 决定（桌面纵向 / 手机横向同一套判定）；
- `PresetPanel` 里 `.preset-drop-line` 画**插入位置指示线**，松手才 `setPresetOrder` 一次性提交；
- 排序模式已 `draggable={false}` 关掉「拖到时间轴」，拖柄带 `touch-action: none`。

**缺的正是动画**：拖动过程中兄弟块一动不动（只有一条线），松手后 React 一次性重排 DOM、
所有卡片瞬移到位。所以"方块拖动换位"目前是**离散跳变**，不是连续的位移动画。

两种布局必须同时成立：

| 形态 | 容器 | 排布 | 附加约束 |
| --- | --- | --- | --- |
| 桌面 | `.preset-panel`（280px 侧栏） | `flex-direction: column`，纵向 | 卡片内联 `height` 随时长伸缩 |
| 手机 | 底部抽屉（`position: fixed` + 纯 CSS `backdrop-filter`） | `flex-direction: row`，横向 | `scroll-snap-type: x proximity`、`overflow-x: auto` |

---

## 二、GitHub 方案盘点（全部为 2026-10-09 实测值）

| 项目 | stars | 归档 | 最近推送 | React peer | min+gzip | 依赖数 | 语义 / 特点 |
| --- | ---: | :--: | --- | --- | ---: | ---: | --- |
| `framer/motion`（`motion@14.0.0`） | 33,903 | 否 | 2026-10-09 | `^18 \|\| ^19` | **46.5 kB** | 2 | `Reorder.Group/Item` 声明式；自动判轴向、自动边缘滚动、自动 z-index |
| `clauderic/dnd-kit`（`core@6.3.1` + `sortable@10.0.0`） | 17,706 | 否 | 2026-09-12 | `react >=16.8` | **13.9 + 3.6 kB** | 3 + 2 | `SortableContext` + `useSortable`；策略含 `vertical/horizontalListSorting`、`rectSorting`、**`rectSwapping`**；带键盘传感器 |
| `atlassian/react-beautiful-dnd` | 33,921 | **是（已归档）** | 2025-08-18 | — | — | — | 不再维护，仅作历史参考 |
| `hello-pangea/dnd@18.0.1` | 4,033 | 否 | 2026-10-09 | `^18 \|\| ^19` | 28.1 kB | 5 | rbd 的社区维护 fork |
| `@formkit/auto-animate@0.10.0` | 13,927 | 否 | 2026-07-10 | **无**（框架无关） | **3.2 kB** | **0** | 给容器挂 ref 即得 FLIP；加/删/移动都补间 |
| `SortableJS@1.15.7`（+`react-sortablejs@6.1.4`） | 31,186 | 否 | 2026-03-24 | 无 / `>=16.9` | 17.9 / 2.7 kB | 0 / 2 | 命令式，自带 FLIP 与触摸支持 |
| `tajo/react-movable@3.4.1` | 1,675 | 否 | 2025-07-14 | `*` | 3.9 kB | 0 | 轻量、鼠标+触摸，**无键盘** |
| `pmndrs/react-spring@10.1.2` | 29,167 | 否 | 2026-10-09 | `^16.8–^19` | 19.6 kB | 5 | 弹簧物理，手势要自己写 |
| `TahaSh/swapy@1.0.5` | 8,502 | 否 | 2025-01-19 | 无 | 7.7 kB | 0 | **对调（swap）**语义、框架无关 |
| `daybrush/moveable` | 10,771 | 否 | 2024-06-03 | — | — | — | 偏自由变换/缩放，**不适合列表排序** |

### 2.1 三种动画范式（必须先分清，选型取决于它）

1. **FLIP**（First–Last–Invert–Play）：先记录旧位置 → 反向 `transform` 到旧位置 → 播到 0。
   `auto-animate`、`SortableJS`、`motion` 的 layout 动画都是这一路。
   特点：**只在"顺序变了"的那一瞬间**做补间，实现简单、性能好。
2. **派生目标位 + 弹簧**：拖动期间实时把每一项 `translate` 到"让位后"的位置，用弹簧收敛。
   `dnd-kit`、`react-spring` 是这一路。特点是**全程连续**、最像 iOS 原生的"让位"，
   代价是要自己做每帧的位置推导。
3. **Swap（对调）**：只把两个方块互换，其余不动。`swapy`、dnd-kit 的 `rectSwappingStrategy` + `arraySwap`。

> ⚠️ **「换位」是个歧义词，必须先定死**：是
> **A. 插入让位**（吸到某两张之间，后面的整体后移一格）还是
> **B. 对调**（两个方块位置互换，其余完全不动）？
> 两者的数据结构（`arrayMove` vs `arraySwap`）与动画都不同。见 §七 待决 ①。

---

## 三、选型结论（先给结论）

**推荐方案 A：自研 FLIP（零依赖）**；不想维护 FLIP 细节则退一档用
**方案 B：`@formkit/auto-animate`（3.2 kB / 0 依赖）**。

**明确不推荐**把 `motion Reorder` 或 `dnd-kit` 作为第一步。理由逐条对着本项目说：

1. **卡片规模不匹配。** 预设通常 3~8 张（色板 8 色）。dnd-kit 引以为豪的
   "100+ 项仍 60fps"在这条量级上用不到。
2. **现有骨架已通过守门探针**（`scripts/goal-history-preset-probe.mjs`，桌面/手机/窄屏三档全绿，
   轴向判定与落点数学已有 15 条单测）。引入库要**整层替换**——把 pointer 捕获 + `setPointerCapture`
   + `touch-action: none` 那套换成库的传感器，现有探针与单测的价值一并作废。
3. **手机抽屉的 `scroll-snap-type: x proximity` 是新风险面。** `motion Reorder` 自带
   "靠近边缘自动滚动"，与 scroll-snap 在同一条轴上竞争，必须在拖拽期把 `scroll-snap-type`
   切到 `none` 再恢复。这类"两套滚动策略打架"的坑，本项目在时间轴上已经踩过（`touch-action` 锁存）。
4. **体积账**：本项目网页端当前产物 216.24 kB gzip（JS）。`motion` 46.5 kB 是 **+21%**；
   `auto-animate` 3.2 kB 是 +1.5%；自研 FLIP ≈ 2 kB 级。
5. **依赖卫生**：`liquid-glass-react` 已经迫使仓库固化 `.npmrc` 的 `legacy-peer-deps=true`。
   再引一个 v14 大版本依赖，等于长期背上升级负担。`auto-animate` **无 React peer、0 依赖**，
   是唯一不产生这类负担的选项；自研则完全不产生依赖。

---

## 四、方案 A（推荐）：自研 FLIP + 拖动期「让位」

### 4.1 交互形态（逐阶段）

| 阶段 | 被拖卡片 | 其余卡片 | 落点提示 |
| --- | --- | --- | --- |
| 按下拖柄（<8px 位移） | 无变化 | 无变化 | 无 |
| 起拖 | `scale(1.03)` + 抬升阴影 + `z-index` 置顶 + `cursor: grabbing`；跟随指针 `translate` | 原地 | 原 `.preset-drop-line` 或改为虚线占位 |
| 指针跨过某张卡中线 | 继续跟手 | **整体让位**：目标位之后的卡片沿轴平移 `卡尺寸 + 间距`，180~220ms 补间 | 占位处显示空位/指示线 |
| 松手 | 从"跟手位置"**弹簧落位**到占位处（不再瞬移） | 保持新位 | 指示线消失 |
| Esc / pointercancel | 弹回原位 | 弹回原顺序 | 消失 |

### 4.2 实现要点（FLIP 的五个动作）

拖动期间**每跨一次中线**执行一轮"重排 + FLIP"：

1. `First`：读 `.preset-card` 的 `getBoundingClientRect()`；
2. 用 `orderAfterDrop(ids, dragId, index)` 算出草稿顺序，`setState` 让 React 按新顺序渲染；
3. `Last`：再读一次 rect；
4. `Invert`：对位置变化的卡片设 `transform: translate(旧−新)`、`transition: none`；
5. `Play`：下一帧把 `transform` 置空 + `transition: transform 200ms <ease>`。

⚠️ 四个必须注意的点：

- **被拖的那张卡片要排除在 FLIP 之外**——它由"跟手 transform"控制，一旦同时参与 FLIP，
  会出现两个 transform 来源互相打架（表现为卡片在指尖下抖动）。
- **轴向**：位移取 `left` 或 `top`，沿用现有 `resolveDropIndex` 的轴向参数化思路，
  不要按"是不是手机"分支判断，而是读 `getComputedStyle(list).flexDirection`。
- **`%` 一律不写**：本项目已定过"带 transform 的层上 `%` 会漂移"，FLIP 全程用 px 计算，天然合规。
- **`scroll-snap-type`**：手机横向档在**拖拽期间**把 `.preset-list` 的
  `scroll-snap-type` 置 `none`，松手后恢复——否则 scroll-snap 会把让位后的卡片吸附回原处。

### 4.3 建议参数（可调，先按这套实现再调手感）

| 项 | 建议值 | 理由 |
| --- | --- | --- |
| 让位过渡 | `180–220ms`，`cubic-bezier(0.2, 0.8, 0.2, 1)` | 先快后缓 = "迅速让开、轻轻停住" |
| 松手落位 | `160ms` 或弹簧 `stiffness 520 / damping 38` | 落位要比让位更"短促"，避免拖泥带水 |
| 起拖抬升 | `scale 1.03` + `0 10px 24px rgba(0,0,0,.45)` | 与现有 `.preset-card:hover` 的抬升同族，衔接自然 |
| 让位时兄弟块 | 可选 `opacity .92` | 让被拖块更突出，弱化"一堆块在动"的视觉噪音 |
| `prefers-reduced-motion: reduce` | **全部时长置 0**（只保留最终位） | 与 `theme.css` 现行的 `transition-duration: .01ms !important` 同口径 |

### 4.4 代码落点

- 新增 `src/renderer/src/lib/flip.ts`：`measure(els)` / `play(deltas, opts)` 两个纯函数 +
  一个 `useFlipList` hook。**可单测的是 delta 计算**（给定前后 rect 数组 → 每个元素的位移量），
  与 `presetReorder.ts` 同一套"几何下沉、DOM 留组件"的分工。
- `PresetPanel`：把 `drop` 状态从"只存指示线位置"改成"**存草稿顺序**"；卡片按草稿顺序渲染
  （这是 FLIP 的前提：DOM 必须真的换位）。
- 探针扩展 `scripts/goal-history-preset-probe.mjs`：新增一条「补间中」判据（见 §八）。

---

## 五、方案 B（备选）：`@formkit/auto-animate`

一行接入，FLIP 由它做：

```ts
const [listRef] = useAutoAnimate({ duration: 200, easing: 'ease-in-out' })
// <div className="preset-list" ref={listRef}>
```

再让拖动期渲染**草稿顺序**即可（与方案 A 的第 2 步完全相同）。

**源码实测事实**（`formkit/auto-animate` `src/index.ts`，非文档转述）：

- 动画走 **`el.animate(...)` = Web Animations API**，按子元素几何做 FLIP；
- 触发靠 **`new MutationObserver(el, { childList: true })`** —— 也就是说**必须真的重排 DOM 子元素**
  才会补间（只画指示线它不会动）；
- **尊重 `prefers-reduced-motion: reduce`：直接自我禁用**（除非显式传
  `disrespectUserMotionPreference: true`）——这一条比大多数库做得对；
- 若父元素计算样式 `position: static`，**它会自行改成 `relative`**（本项目 `.preset-list`
  已是 `relative`，无副作用）；
- 默认 `duration: 250` / `easing: 'ease-in-out'`；新增元素 1.5× 时长 + `ease-in`，移除用 `ease-out`
  （所以 §4.3 的参数要显式覆盖）；
- 依赖 `ResizeObserver`，无它则整个功能静默不生效（现代浏览器都有）。

**它不给的能力**：跟手位移仍要自己写（本项目已有）；不做边缘自动滚动；不带无障碍键盘支持。

---

## 六、方案 C / D（记录在案，暂不采用）

### C · `motion` 的 `Reorder`
```tsx
<Reorder.Group axis="x" values={items} onReorder={setItems}>
  {items.map((i) => <Reorder.Item key={i} value={i} dragListener={false} dragControls={c} />)}
</Reorder.Group>
```
优点：自动判轴向（`x`/`y`/`xy`）、自动边缘滚动、自动给被拖项加 `z-index`、
`useDragControls` 可把拖拽限定在把手上。代价：46.5 kB gzip + 整层替换现有手势骨架。

### D · `dnd-kit`
`SortableContext` + `useSortable` + `DragOverlay`，策略按需选：
`verticalListSortingStrategy` / `horizontalListSortingStrategy`（**插入让位**）、
`rectSortingStrategy` / **`rectSwappingStrategy`**（**对调**，网格场景），
工具函数 `arrayMove` / `arraySwap`，传感器 `sortableKeyboardCoordinates`（键盘无障碍）。

⭐ **唯一能给出"键盘也能排序"的方案**。若将来把预设排序纳入无障碍要求，这是首选。
⚠️ 但两点要单独评估：① `DragOverlay` 默认把被拖元素渲染到 **`document.body` 下的 portal**——
本项目对"玻璃层祖先链不得含 transform / 非 auto 的 z-index"有硬约束，需确认这不是新的合成面；
② 拖拽期的 `transform` 与手机抽屉的 `scroll-snap` 的相互作用同 §三.3。

---

## 七、已拍板的 3 件事（2026-10-09）

1. **语义**：**插入让位**（吸到某两张之间，后面的整体后移一格）。→ 用 `arrayMove` 语义，
   即 `orderAfterDrop`；不是 `arraySwap` 的对调。
2. **被拖卡片的视觉**：**跟手位移 + 抬升**（幽灵副本，`translate3d` 逐帧跟指针，`box-shadow` 抬高）。
3. **依赖**：引入 `@formkit/auto-animate@^0.10.0`（3.2 kB gzip、0 依赖、无 React peer）。

---

## 八、验收判据（已全部推入探针并通过）

`scripts/goal-history-preset-probe.mjs`，桌面纵向 + 手机横向**各跑一遍**：

| # | 判据 | 状态 |
| --- | --- | --- |
| 1 | **在补间，不是瞬移**：跨中线后兄弟块 rect 处于旧位与新位之间（距离两端各 > 2px，且 ≥2 帧） | ✅ 7/55 帧 |
| 2 | **落位准确**：松手后所有卡片 rect 与最终布局一致（幽灵消失、本体显形） | ✅ |
| 3 | 幽灵跟手误差 ≤ 2px；松手后幽灵带 `.settling` 飞向目标槽位再消失 | ✅ dx=dy=0.00 |
| 4 | **不打架**：手机档拖拽期间 `.preset-list` 的 `scroll-snap-type` 为 `none`，松手后恢复（计算值 `x` —— `proximity` 是初始值，会被序列化省略） | ✅ |
| 5 | 数据一致：最终顺序与 `localStorage` 的 `weekPresets` 数组顺序一致 | ✅ |
| 6 | 无 console error | ✅ 0 条 |
| 7 | 松手后无残留拖拽态（`.is-dragging` / `.is-drag-source` / 幽灵三者都清空） | ✅ |

> 未覆盖（诚实记录）：`prefers-reduced-motion` 档没有单独用探针跑。库在该档下**自我禁用**（源码实测），
> 幽灵的落位过渡也显式判了该媒体查询；但"实际观感"未在本轮验证。

---

## 附：调研数据来源

| 数据 | 来源 |
| --- | --- |
| stars / 归档 / 最近推送 | `GET https://api.github.com/repos/<owner>/<repo>`（2026-10-09） |
| React peer 要求 / 版本 | `GET https://registry.npmjs.org/<pkg>/latest` |
| min / gzip 体积 / 依赖数 | `https://bundlephobia.com/api/size?package=<pkg>` |
| auto-animate 实现细节 | `GET https://api.github.com/repos/formkit/auto-animate/contents/src/index.ts`（base64 解码后直读） |
| dnd-kit 导出清单 | `GET .../clauderic/dnd-kit/contents/packages/sortable/src/index.ts` |

> 注：`raw.githubusercontent.com` 在本机**超时不可达**，故源码统一走 `api.github.com` 的
> `contents` 接口取 base64；文档站（auto-animate.formkit.com / docs.dndkit.com）是 SPA，
> 抓不到正文，因此所有实现结论均以源码为准。
