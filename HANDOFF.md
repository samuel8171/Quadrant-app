# 象限（Quadrant）· 交接文档

> **本版整体重写**（上一版停在 2026-09-27 第十八轮）。
> 生成：**2026-10-09 15:32**（GMT+8）
> 本地 `main`：最后一次**代码**改动 **`ca97dc7`**（R3-F2），其上叠了 doc 提交与
> `chore(release): 1.3.1 → 1.4.0`（桌面端打包）—— **这两个尚未推送**
> 远端 `main`：**`392a16bd`**（其树 == `ca97dc7` 的树，逐字节相同；sha 不同 —— 见 §6）
> 线上：https://samuel8171.github.io/Quadrant-app/ ｜ 产物 `assets/index-CFBg2gX4.js` + `index-DSNHBsOY.css`

---

## 0. 一句话现状

**视觉/玻璃战线已收官，金钱系统已上线。下一阶段主题是「功能改进 + 金钱逻辑优化」。**

- 液态玻璃（liquid-glass-react）+ WebKit 降级材质：弹窗 ×7、菜单 ×3、手机 dock、
  象限计费气泡、日结面板 —— 全部完成，且有**可失败的回归守门**。
- 金钱系统（时币 / 娱币）已完成 Task 1–11 + R2-A…R2-K + R3-A/C/D/E/F/F2，
  两轮终审 clean，**已随 `main` 上线网页端**。
- 当前 `main` 上最后一次改动是 **R3-F2**（底栏文字被材质板压住）。
- ⚠️ **R3-B（桌面端云同步手动/自动）是唯一没做的任务** —— 用户指定「放最后，
  其余全部做完再动它」，**下一阶段若要做，请先读 §5.3 的三个前置问题**。

---

## 1. 下一对话的入口：先读哪些文件

按「先读哪个」排序。**不要凭直觉读源码猜语义，规格与计划里都写清了。**

| 顺序 | 文件 | 为什么 |
|---|---|---|
| ① | `docs/superpowers/specs/2026-09-29-money-system-design.md`（31 KB） | 金钱系统的**主规格**：域模型、计费式、界面结构 |
| ② | `docs/superpowers/specs/2026-09-30-money-system-r2.md`（16 KB） | **R2 修订**：数值定标、日结范围与逾期、娱币来源、**§9 语义裁定记录** |
| ③ | `docs/superpowers/plans/2026-09-29-money-system.md`（102 KB） | 实施计划：Global Constraints、逐任务 brief、R3 阶段、已知缺陷记录 |
| ④ | `src/shared/money.ts`（1347 行） | **计算引擎本体**，见 §2.2 |
| ⑤ | `.superpowers/sdd/2026-09-29-money-system/` | 逐任务报告与终审记录（**gitignored**，只在本机）。`progress.md` 95 KB 是全过程 |
| ⑥ | `AGENTS.md` | 环境/工具链/玻璃的耐久结论（改前必读） |

---

## 2. 金钱系统现状

### 2.1 数据模型（`src/shared/types.ts`）

```
AppData.money?: MoneyState          // undefined = 该功能从未启用（等价关闭）
                                   // ⚠️ 关闭时必须保留字段、不得清除（否则=账本全删）

MoneyState { enabled, config, enabledAt?, days: LedgerDay[], weeks: WeekSettlement[] }
MoneyConfig { weeklyTC, dailyCapTC, tcPerHour, nightStartMin/EndMin, nightMultiplier,
              minCapRatio, weeklyLT, rewardLT, penaltyLT, missPenaltyLT,
              videoLTPerHour, gameLTPerHour, restDayFactor, abandonedDayTC,
              latePhoneTC, latePhoneLT, quadrantMultiplier }
LedgerDay  { date, settledAt|null, entries[], videoMin, gameMin, latePhone,
             dayLimit, spentTC, overdraft, deltaLT, nightPending, isRestDay }
LedgerEntry{ id, kind:'planned'|'unplanned', sourceId|null, title, quadrant|null,
             plannedMin|null, actualMin, done, nightMin, costTC, deltaLT }
WeekSettlement { weekStart, weekEnd, weekTC, spentTC, weekOver, plannedMin, actualMin,
                 doneCount, missCount, unplannedCount, unplannedMin, nightMin,
                 overLimitDays, penaltyTier:0|1|2|3, nextWeekTC, nextWeekLT, notes[] }
```

⭐ **`MoneyState` 刻意没有 `balance` 字段**：当前周额度与余额全部**派生**
（`weeks.at(-1)?.nextWeekTC ?? config.weeklyTC`）。冗余的 `balance` 会成为唯一可能与
账本不一致的状态。**别"顺手"加回来。**

⭐ **新增字段一律向后兼容**：`videoMin` / `gameMin` / `latePhone` / `isRestDay` /
`enabledAt` 全是**可选/缺失即有默认语义**（旧记录按 0 或 false 处理）。原因写在每个
字段的注释里 —— 尤其是 `enabledAt`，绝不能替旧数据凭空发明一个生效日。

### 2.2 计算引擎（`src/shared/money.ts`）

**纯函数，无副作用，全部可单测。** 关键导出：

| 函数 | 职责 |
|---|---|
| `DEFAULT_MONEY_CONFIG` | **这些数值的单一真源**。`dataCodec.normalizeMoney` 的非法值回退、开启开关写入的初始 config 都引用这里 |
| `nightMinutesOf` | 深夜分钟数（跨零点，左闭右开，逐分钟循环——闭式公式易错） |
| `costOfEntry` | 单条事件的时币成本 |
| `quadrantCostOf` / `quadrantEntryOf` | 象限计费（气泡用） |
| `settleDay` | **日结**：算 `dayLimit`/`spentTC`/`overdraft`/`deltaLT` |
| `settleWeek` | **周结算**：超支 → `penaltyTier` → `nextWeekTC`/`nextWeekLT` |
| `penaltyTierOf` | 超支档位（`TIER_SCALE` 是档位表） |
| `ensureLedgerDays` | 补满 `[今天 − 7, 今天 − 1]` 的空日 |
| `abandonExpiredDays` | 逾期未结算 → 按满额扣（`abandonedDayTC`），**自动执行** |
| `ensureWeekRollover` | 跨周滚动 |
| `selectMoneyStats(money, today)` | **UI 唯一数据源** → `MoneyStats` |
| `pendingDays` | 待结算日列表 |
| `weekSummaryLines` / `composeReviewText` | 周结论文本（进复盘页 / Word 导出） |

`LEDGER_WINDOW_DAYS = 7`；记账窗口下界 = `max(今天 − 7, enabledAt)`。

⭐ **改引擎前先想这条**：`abandonExpiredDays` 是**自动扣款**，任何让
`ensureLedgerDays` 多补出几天的改动，都会连带产生真实扣款。`enabledAt` 的存在正是
为了堵住「刚开启功能的第一屏就是 7 天待结算」这个坑。

### 2.3 UI 组成

| 文件 | 行数 | 说明 |
|---|---|---|
| `pages/MinePage.tsx` | 158 | 「我的」页；**DOM 顺序即屏幕顺序**（两个 hero → 四张小卡） |
| `components/money/SettlePanel.tsx` | 825 | **日结面板**（最高频的交互面板；R3-E 已玻璃化） |
| `components/money/QuadrantCostBubble.tsx` | 282 | 四象限计费气泡（R3-D 已玻璃化） |
| `components/money/WeekLedger.tsx` | 65 | 周账本 |
| `components/money/SettleCard.tsx` | 26 | 周计划页的日结入口卡（**R3-F 修过安全区**） |
| `components/money/MoneyIcon.tsx` | 58 | 时币 / 娱币图标 |
| `components/mine/*.tsx` | 6 个组件 | BalanceWidget / PenaltyWidget / TimeCoinTrendWidget / LeisureTrendWidget / NightWidget / QualityWidget |

⭐ **六个小组件都只吃 `selectMoneyStats` 的返回值**，页面本身不参与计算 ——
组件与数据源之间只有 `MoneyStats` 这一个契约。**加新指标改 `MoneyStats` + 组件，
不要在页面里写计算。**

⭐ `MinePage` 的 `today = dateKey(new Date())` **每次渲染现算**（进 `useMemo` 依赖），
刻意**不引入轮询定时器** —— 理由见文件内注释；跨零点/跨周的正确性靠这条。

### 2.4 已定标的数值

| 参数 | 值 | 备注 |
|---|---|---|
| `weeklyTC` / `dailyCapTC` | 560 / 80 | **独立字段**，不由 `weeklyTC/7` 派生（派生会让"调周总额"静默改"日上限"） |
| `tcPerHour` | 10 | |
| `nightStartMin` / `nightEndMin` | 1410 / 360 | 23:30 – 06:00，**左闭右开** |
| `nightMultiplier` | 1.5 | |
| `weeklyLT` | 20 | 娱币周定额 |
| `restDayFactor` | 0.8 | 休息日固定扣 `dailyCapTC × 0.8` = **64** |
| `abandonedDayTC` | 80 | 逾期未结算 = 满额全扣（**与休息日的 64 区分**） |
| `quadrantMultiplier` | q1 1.5 / q2 1.0 / q3 1.2 / q4 0.5 | **Q3 > Q2 是刻意的**：对"被紧急事推着走"收费更高；Q4 最低因为惩罚通道在娱币那边 |

### 2.5 ⚠️ 已知占位与待定（**下一阶段最该先问用户**）

1. ⚠️ **`latePhoneTC` = 40 / `latePhoneLT` = 2 是占位值，从未定标。**
   用户原话只说了"扣除**大量**次日金钱与娱币"，**没给数字**。
   代码与规格里都明确标了「待用户定标」（`money.ts:40-43`、`types.ts:156-164`）。
   任何依赖它的展示/结算都必须能承受这个值被改掉。
   ⇒ **下一对话优先向用户确认这两个数。**
2. ⏳ **平板档 768–1023px 是否补断点** —— 待用户定夺。计划里的建议是**本期不补**
   （属产品外观决策，不是技术缺陷；本项目有断点返工史）。要补需用户说明期望排布。
3. ⚠️ **深夜刷手机的两条追问语义不同，别混**：
   「昨夜 23:30 之后还在做事吗」→ 按时长 × 深夜倍率算**条目**时币；
   `latePhone` → 定额扣**次日**（记录日与扣款日**不是同一天**，见 `LedgerDay.latePhone` 的长注释）。
   两者在同一次日结里并列问出，互不替代。

---

## 3. 分支与部署状态

```
本地  main              ca97dc7  fix(glass): R3-F2 …
远端  main              392a16bd  ← 树 9f916857（与本地逐字节相同），parent 9717d99
远端  feat/money-system 392a16bd  ← 与 main 同步
```

- **GitHub Pages 只在 push 到 `main` 时部署**，推特性分支不触发。
- 本次（R3-F2）：`CI` success、`Deploy web app` success，均跑在 `392a16bd`。
- `feat/money-system` 与 `main` 已合并同点 —— **后续新工作直接在 `main` 上做即可**，
  不必再开特性分支（除非又要"整批做完再合"）。
- ⚠️ 本地 `git push` 需要凭据；本机**先探代理**（见 §8）。

---

## 4. 回归基线（改前改后都跑，期望值写死）

| 项 | 命令 | 期望 |
|---|---|---|
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json` 与 `-p tsconfig.node.json` | **0 错**（⚠️ 根 `tsconfig.json` 是空壳，用它报 `TS18003`） |
| 单元测试 | **逐文件**跑 `tmp/testfiles.txt`（23 个），`--reporter=json` 汇总 | **424/424** |
| 玻璃结构 | `node scripts/liquid-glass-probe.mjs` | **39/39** |
| dock 保留率 | `node scripts/dock-glass-retention.mjs` | 两档 alive（≈0.028 / 0.049），标签对比度 ≥4.5:1 |
| dock 文字层级 | `node scripts/dock-label-order-probe.mjs` | 两档 Δ≈0 且 FWHM>8 |
| 趋势线锐度 | `node scripts/trend-chart-glass.mjs` | 保留率 ≤0.2 且 sharpRatio ≤0.6 |
| 日结栏安全区 | `node scripts/statusbar-clearance-probe.mjs` | 三机型全过，日结栏「盒顶距 safe-top」= 24 |

探针前置：`./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort`
（**用 run_in_background**，`&` 会立刻退出 ⇒ ERR_CONNECTION_REFUSED）。

⚠️ 测试**必须逐文件跑**（多路径触发沙箱 EPERM）；**统计别 grep 输出**（ANSI 色码会误报 0 通过）。

---

## 5. 待办与未决

### 5.1 金钱相关
1. **`latePhoneTC` / `latePhoneLT` 定标**（§2.5-1）—— 优先级最高，卡着一条规则的完整性。
2. 平板断点（§2.5-2）。
3. 用户提出的**新的功能改进与金钱逻辑优化**需求 —— 拿到需求后：
   **先改 spec 再改代码**（这个项目一直是这么走的，计划里也有 Global Constraints 要先读）。

### 5.2 玻璃相关（已收官，仅备查）
- 手机端与桌面端的玻璃均已有守门探针；**唯一没能验到的是真机**（本机无 iOS、
  桌面端 `electron-vite dev` 曾因 GPU 进程崩而起不来）。真机验收不可替代。

### 5.3 R3-B（桌面端云同步手动/自动）—— **唯一未做任务**
用户指定「放最后，其余全部做完再动它」。**动手前必须先答三个问题并写进报告**：
1. 自动同步的**触发时机**是什么？（定时轮询 / 窗口重新可见 / 有未推送改动时 / 组合）—— 选一种，说明为什么，**不要全上**。
2. 自动拉取**会不会覆盖本地尚未推送的改动**？现有保护够不够？**怎么验证这一点？**
3. **冲突时谁赢？** 明确规则，不要"看情况"。

现状（先读，别猜）：`Sidebar.tsx` 的两个手动按钮是**桌面专属**；`appStore.syncOnResume`
在桌面端**提前 return**；`App.tsx` 的定时/可见性对账是**网页端专有**。
⇒ 网页端本来就是自动的，桌面端只有手动。
设置建议放进已有的 `SyncMeta`（已有 `defaultSyncMeta` 与测试），**不要塞进 `AppData`**。

### 5.4 其它遗留
- **Supabase `attachments` bucket 仍未建**：`supabase/schema.sql` 第 4 段（`storage.buckets`
  插入 + 4 条 RLS）从未执行。建之前照片**静默降级为纯本地**（当前设备正常、换设备看不到）
  ⇒ 属"增强缺失"而非"功能故障"。
  ```bash
  curl -s --noproxy '*' "https://nktsnjbkvdyhxdjfbxkh.supabase.co/storage/v1/bucket/attachments" \
    -H "apikey: sb_publishable_oPq0EiI_ofPDz2q0iy9EUQ_byXMWSk5"
  # 返回 bucket JSON（而非 404 Bucket not found）即为就绪
  ```
- **桌面端 exe 最新是 `dist/象限-1.4.0.exe`**（2026-10-09，73,765,900 B = 70.35 MB），
  **已包含**金钱系统全套与 R3-A…R3-F2 全部改动（验货见 §5.4 下方）。产物目录 `dist/` 是
  **gitignored**，exe 不入库 ⇒ 换机器要重新打包。再发布新版本时先抬
  `package.json` + `package-lock.json`（**根包两处**，注意锁文件里 `update-browserslist-db`
  有自己的同名版本**不要动**）的 version，再按 `AGENTS.md` 的打包流程走。
  1.4.0 的验货结果（解 `app.asar` 搜标识串，**别搜 exe**）：
  `"version": "1.4.0"`、`.gs-layer--dock .gs-plate { z-index: 50 }`、
  `.gs-layer--dock .gs-dock-floor` 规则在位（`gs-dock-floor` 出现 10 次）、
  CSS 里 `103` **只在注释正文**、金钱系统标识 `DEFAULT_MONEY_CONFIG` / `settleDay` /
  `selectMoneyStats` / `quadrantMultiplier` / 时币 / 娱币 全部命中。

---

## 6. ⚠️ 本地 / 远端 sha 分叉（需要处理）

R3-F2 走的是 REST 兜底（当时代理没开），API 建的提交与本地**树相同但 sha 不同**。
后果：**直接 `git push` 会被判 non-fast-forward**（`ca97dc7` 与 `392a16bd` 是兄弟）。

**恢复方式**（等代理通了，一条命令）：
```bash
git push --force-with-lease=refs/heads/main:392a16bd origin main
```
推完本地/远端即恢复逐字节一致，并把本地未推的 doc 提交与 `1.4.0` 版本提交一并带上。
**内容不会丢**（`ca97dc7` 与 `392a16bd` 的树逐字节相同，已验证 `9f916857`）。

⚠️ 若届时想**分两次**推（先对齐、再推新提交），注意 `--force-with-lease` 的期望值要
跟着远端当前 sha 走，别照抄 `392a16bd`。

---

## 7. 环境与操作备忘（详见 `AGENTS.md`，此处只留最关键的）

### 推送
```bash
# ① 先探代理；通了就直推（sha 逐字节一致）
git -c http.proxy=http://127.0.0.1:7897 ls-remote --heads origin
# ② 不通才走 REST 兜底（两步，都要后台跑）
BASE_COMMIT=<父提交> bash scripts/api-push-blobs.sh
BRANCH=main bash scripts/api-push-trees.sh
```
⚠️ **push 要凭据**：匿名 `ls-remote` 能通 ≠ push 能通，会报 `could not read Username`
⇒ 用 `git -c credential.helper=manager credential fill` 取 token 内联进 URL。
⚠️ **trees 任务被中断会留下"保活工具提交"**在分支顶点（message
`push tooling: keep tree … reachable`）⇒ 重跑时**必须把 parent 钉回真正的父提交**：
手动构造 `tmp/pushdiag`、改写 `remote.txt`，直接调 `scripts/api-push-trees.py`
（**别走 `.sh`**，它会 curl 覆盖 `remote.txt`）。
⚠️ **`api.github.com` 直连稳定可用**，代理全灭时 REST 备胎随时能走。

### 工程命令
- 本终端 `npm run <script>` 会报 `/usr/bin/env: bash` 找不到 ⇒ 直接调 `node_modules/.bin/` 下的可执行文件。
- `node_modules` 若成"半棵树"**别用 `npm ci` 修** ⇒ `python scripts/heal-node-modules.py`。
- CI 锁 **Node 20**（本机 22+）。CI 的 `npm ci` 依赖仓库根 `.npmrc` 的 `legacy-peer-deps=true`
  （`liquid-glass-react` peer 要 react ≥19，项目 18.3.1）—— **改依赖后先想这条**。

### 探针
- 唯一可用浏览器是**系统 Edge**：`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。
- 探针页 `/probe.html?page=quadrant|weekly|goals|review|mine[&sidebar=1][&strict=0]`（`/` 是登录页）。
- ⭐ **播种数据必须逐字段满足 `platformApi.validAppData`，否则整份静默作废**
  （表现："一个事件都没有"）。`money` 三级降级任一环不合规 ⇒ 计费气泡入口不渲染。
  **种子从 `window.__DEFAULT_MONEY_CONFIG__` 取。**
- 桌面端探针必须走 `scripts/desktop-glass-cdp.mjs`（CDP 接管真窗口），前置
  `unset ELECTRON_RUN_AS_NODE NODE_OPTIONS`，端口避开 9222。

### 不该动的东西
- `.git` 曾遭破坏 ⇒ 自动维护已关（`maintenance.auto false` / `gc.auto 0`）—— **不要重开**。
- `.workbuddy/` 与 `.superpowers/sdd/` 是**本地忽略**目录，别指望它们进仓库。
- `.image-viewer` 刻意**不玻璃化**（浮在真实照片上，saturate/折射会扭曲影像），**别当遗漏补上**。
- 「我的」页的小组件卡片**刻意不玻璃**（身后是纯色，采不到结构，spec §10.1 已裁定）。

---

## 8. 历史轮次索引（细节都在别处，此处只留指针）

| 轮次 | 主题 | 详细记录 |
|---|---|---|
| 第七～十八轮 | 液态玻璃的建立与一连串真实缺陷（磨砂从未画出 / 祖先合成面 / 尺寸测量时机 / iOS standalone 视口盒 …） | `AGENTS.md`、`docs/probes/liquid-glass.md` |
| Task 1–11、R2-A…R2-K | **金钱系统**主体 | `docs/superpowers/plans/2026-09-29-money-system.md`、`.superpowers/sdd/2026-09-29-money-system/` |
| R3-A/C | 设置区整合（外观入口迁入「我的」、手动按钮间距） | 同上 |
| **R3-D** | 象限计费气泡玻璃（宿主搬出 `.event-layer`） | `AGENTS.md`、`QuadrantCostBubble.tsx` 头注释 |
| **R3-E** | 日结面板玻璃化（复用 `GlassModal`，删 `.settle-overlay`） | `AGENTS.md` |
| **R3-F** | 三项 UI 缺陷：dock 材质被保底底压住 / 日结栏安全区与间距 | `docs/probes/r3f-uitweaks.md` |
| **R3-F2** | 承 R3-F：底栏文字被材质板压住 → 保底底搬进玻璃层、板降到 z:50 | 同上（R3-F2 段）、`docs/probes/dock-labels/report.md` |

> ⚠️ **R3-F 的 `z-index: 103` 修法已被 R3-F2 推翻**，两段的教训方向相反，
> 读 `r3f-uitweaks.md` 时**两段都要读**，别只读前面那段。
