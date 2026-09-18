# 周计划·日视图：轴系几何修复与动效方案（2026-09-18）

- 状态：**已实施，待确认**
- 触发：用户报告①时间轴数字后的背景条未覆盖到 24:00（桌面与手机都有，覆盖面积不一）②事件块比时间区间略小；并要求③手机端底栏加入与桌面端左侧栏同逻辑的动画④预设展开收起加高度动画⑤桌面端去掉预设的下拉按钮。
- 全部结论来自真实浏览器实测，脚本：`scripts/axis-geometry-probe.mjs`、`scripts/motion-probe.mjs`

---

## 一、缺陷 1：标尺背景条未铺到 24:00

### 实测（修复前）

| 视口 | `.day-gutter` 实测高 | 覆盖到 | 缺口 |
| --- | --- | --- | --- |
| 1440×900 | 801px | 23:29 | 25px |
| 390×844 | 646px | 20:15 | 180px |

同一份数据里 `.day-grid-bg` 与 `.day-canvas` 都是 816px、覆盖 7:00–24:00，**只有标尺列短**。

### 根因

`.day-scroll` 是 `display: flex`，子项默认 `align-items: stretch`。`.day-canvas` 有确定高度（能溢出滚动），而 `.day-gutter` 高度是 `auto` —— **`auto` 高度的 flex 子项会被拉伸到容器的"内容盒高度"（`clientHeight − padding`），而不是它自身的内容高度**：

- 桌面：`clientHeight` 801，无 padding → 标尺 801
- 手机：`clientHeight` 702，`padding-bottom` 56 → 标尺 646

于是缺口 = 内容高（836）− 可视内容盒高，**这就是"两端覆盖面积不一"的来源**，与屏幕大小无关，只与容器高度和 padding 有关。

### 修复

1. `.day-gutter { align-self: flex-start }` —— 高度回归内容自身（10 + 17×48 + 10 = 836px）。
2. 顺带消除隐患：`.day-canvas { height: 816px }` 原本**硬编码在 CSS**，而 `DayView.tsx` 的 `CONTENT_H`（= 2×`DAY_PAD_PX` + 17×`DAY_HOUR_PX` = 836）**定义了却从未被使用**。改为由 `DayView` 内联给出，CSS 里删掉写死的高度。
3. 给 `.day-scroll` 加 `--day-hour` / `--day-pad` 两个变量，让 `.day-gutter` / `.day-hour-label` 与 TS 常量同源（注释里标明必须与 `weekRules.ts` 同步）。

### 修复后

三个视口一致：`.day-canvas` 836px、`.day-gutter` 836px、`.day-grid-bg` 10→826（7:00–24:00）。标尺底色到 24:00 线后再收尾 10px，无缺口。

---

## 二、缺陷 2：事件块与时间区间不对齐

### 实测（修复前）

| 声明区间 | 实测顶 / 高 | 期望顶 / 高 | 底差 |
| --- | --- | --- | --- |
| 15:00-16:00 | 394 / 46 | 394 / 48 | −2px |

顶边精确，**底边恒差 2px**（不随时长缩放，是固定值）。

### 根因

`eventHeightPx` 返回 `((endMin - startMin) / 60) * hourPx - 2`，那个 `-2` 是当初用来给相邻事件留"呼吸缝"的。代价是每块都比它声明的区间短 2px，15:00-16:00 的块停在 15:58。

### 修复

`eventHeightPx` 返回精确高度（保留 `Math.max(4, …)` 兜底极短事件）。视觉分隔改由既有的 **1px 描边 + 6px 圆角**承担。

### 修复后

4/4 事件块完全贴合，顶差 0.0px、底差 0.0px，1 小时块实测 48px。

---

## 三、改进 1：手机端底部导航的滑动指示块

### 现状

桌面端本来就有 `.nav-indicator`：一个会随激活项平移的高亮块（`transition: transform 0.25s`）。手机端底部栏把它 `display: none` 掉了，激活态是直接给 `.nav-item.active` 加背景与边框——**没有位移，是瞬变**。

### 方案

让两端共用**同一个元素、同一条 transition**，只把滑动轴交给 CSS：

- JS 只输出「第几项」：`style={{ '--nav-index': activeIndex }}`
- 桌面端：`transform: translateY(calc(var(--nav-index) * 46px))`（40px 项高 + 6px gap）
- 手机端：`transform: translateX(calc(var(--nav-index) * (100% + 2px)))`

手机端用百分比是关键：`translateX` 的百分比相对**元素自身宽度**，把自身宽设成 `calc((100% - 6px) / 4)`（4 列 3 个 gap），那么「自身宽 + gap」正好等于 grid 一格的步长，**不需要知道任何像素值**，断点与列数变了也不用改 JS。

配套：手机端 `.nav-item.active` 交回透明背景，否则指示块滑走后旧项还留着一圈残留底色。

### 验收

| 视口 | 指示块与激活项中心偏差 | 过渡中间帧数 |
| --- | --- | --- |
| 1440×900（4 项） | 0 / 0 / 0 / 0 | 37–50 |
| 390×844（4 项） | 0 / 0 / 0 / 0 | 49–59 |

---

## 四、改进 2：预设面板的展开/收起动画

### 方案选型

"高度自适应内容 + 过渡"历史上只有两条路，本方案取第三条：

| 方案 | 问题 |
| --- | --- |
| `max-height` 猜一个上限 | 过渡时长按**上限**计时，内容比上限矮就会出现"先动完再干等"，卡顿感随内容长度变化 |
| JS 读 `scrollHeight` | 每次要 reflow，还要处理内容变化、清理定时器 |
| **`grid-template-rows: 0fr → 1fr`** | ✅ 采用。`fr` 是数值、浏览器可插值，等价于"过渡到 auto"，无需测量，**时长恒定** |

（`grid-template-rows` 可过渡这一技巧由 Nelson Menezes 发现，CSS-Tricks 有整理；现代 Chromium / Firefox / Safari 都支持。）

### 实现

新增外层 `.preset-collapse`（`display: grid`，展开 `1fr` / 收起 `0fr`），`.preset-list` 不再是 `.preset-panel` 的直接子项：

```css
.preset-collapse { display: grid; grid-template-rows: 1fr; overflow: hidden;
                   transition: grid-template-rows .28s cubic-bezier(.4,0,.2,1); }
.preset-panel.collapsed .preset-collapse { grid-template-rows: 0fr; }
```

配合同样重要的一条：收起动画结束后让列表**脱离焦点序列**，否则 Tab 会走进看不见的卡片。用延迟生效的 `visibility`，动画期间内容仍可见：

```css
.preset-panel.collapsed .preset-list { visibility: hidden; transition: visibility 0s linear .28s; }
```

**踩到的坑**：`.preset-list` 原有 `padding: 10px 12px 12px`，收起后残留 22px 空档 —— `padding` 属于元素自身的盒子，border-box 下即使 grid 轨道把高度压成 0，它仍是硬性最小外尺寸，`min-height: 0` 与父级 `overflow: hidden` 都无法消除。改为 padding 归零、留白迁到 `.preset-list::before/::after`（伪元素）与 `.preset-card` 的 margin。

### 验收（390×844，12 条预设）

| 指标 | 结果 |
| --- | --- |
| 收起态 `grid-template-rows` | 0px，列表高 0px（不再残留） |
| 展开态面板高 / 列表高 | 195px / 147px |
| 展开 ↔ 收起中间帧数 | 80 / 81（判据 ≥ 3） |
| 收起后列表 | `visibility: hidden`，脱离 Tab 序列 |
| 卡片尺寸 | 136×125px，横向可滚（内容 1760 vs 可视 364） |
| 卡片内操作区 | 44px，完整落在可视区内 |
| 抽屉底边与底栏间距 | 0px（不重叠，正好贴上） |

---

## 五、改进 3：桌面端去掉下拉按钮

组件里把两件事分开表达，不再共用一个 `expanded`：

```tsx
const collapsible = isMobile                 // 是否渲染折叠控件
const listOpen = !collapsible || expanded    // 列表是否显示
```

- 桌面端渲染 `<div className="preset-toggle static">`（不是 `<button>`），**不渲染箭头**，点击标题也不折叠，列表恒显。
- 手机端仍渲染 `<button>` + 箭头，抽屉可折叠，默认收起。
- 跨断点 resize 时 `useEffect` 重置展开态：手机一进来默认收起（展开会盖掉约 190px 时间轴）。
- `.preset-toggle.static { cursor: default }` 用**两个类**提权，压过 `.preset-toggle { cursor: pointer }` —— 同元素上的单类选择器同权重时按源序决胜负，直接再写一条 `.preset-toggle` 会输。

验收：桌面端折叠控件是 `DIV`、无 `svg`；点击标题后列表 735px → 735px（恒显）。

---

## 六、验收汇总

| 项目 | 结果 |
| --- | --- |
| `tsc`（node + web 两套配置） | 通过 |
| 单元测试 | 20 文件 / 170 项全绿 |
| `electron-vite build` | 成功 |
| `vite build --config vite.web.config.ts` | 成功 |
| 轴系几何探针 | 三视口无缺口、事件块 4/4 贴合 |
| 动效探针 | 无失败项 |
| 移动端密度探针（回归） | 与上一轮一致（时间轴未被遮挡高 485 / 662 / 750，目标卡标题宽 129px） |

证据文件：

- `docs/probes/axis-geometry-before.md` / `axis-geometry-after.md`
- `docs/probes/motion.md`
- 截图 `docs/probes/axis-shots/`、`docs/probes/motion-shots/`

---

## 七、已知限制

1. **时间轴的几何常量仍分散在两处**（`weekRules.ts` 与 `theme.css` 的 CSS 变量），改一处必须同步另一处。彻底消除需要把数值从 TS 注入 CSS 变量，目前不值得为它引入构建期耦合。
2. **手机端抽屉与底部导航条间距为 0**（紧贴）。看起来像一个整体上延的组件，可用；若想留呼吸感，把 `.preset-panel` 的 `bottom` 从 `10px + nav` 提到 `18px + nav` 即可，代价是时间轴再少 8px 的未遮挡高度。
3. **周视图相邻日期列被 sticky 小时轴压住时事件块首字被裁**（390 宽可见为「程 1」）。本轮未动（用户已明确不做"整周适配"）；修法是加 `scroll-snap-type: x proximity` + `scroll-padding-left: 52px`。
4. 动画时长 0.28s 与指示块 0.25s 为经验值，未做可用性测试；`prefers-reduced-motion: reduce` 下由全局规则统一压到 0.01ms。
