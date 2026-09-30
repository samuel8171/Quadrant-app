# 金钱系统设计（时间就是金钱）

> ⚠️ **本文已被 R2 修订部分取代（2026-09-30）**，见 `2026-09-30-money-system-r2.md`。
> 被取代的是 **§5 数据模型、§6 金钱逻辑、§11 参数默认值、§12.3 小组件清单**；
> §4 开关机制、§7 交互设计、§9 落点与改动清单、§10 测试策略**仍然有效**。
> R2 的主要变更：日软上限改为独立字段（不再由周总额派生）、事件计费乘象限（重要/紧急）倍率、
> 娱币新增「刷视频 / 打游戏」两条纯消费来源、日结改为固定回溯 7 天且逾期满额扣款、休息日、
> 深夜刷手机的次日连带扣款，以及界面上的货币图标 / 事件块价值 / 荧光折线趋势图。

- 日期：2026-09-29
- 状态：**待评审**
- 路径：架构级（新增子系统，横跨象限 / 周计划 / 周日复盘）
- 关联：`src/shared/types.ts`、`src/main/dataCodec.ts`、`src/renderer/src/lib/platformApi.ts`、`src/shared/defaults.ts`

---

## 1. 背景与目标

给「象限」加入一套以「时间就是金钱」为灵感的激励系统：把可支配的时间建模为一笔**每周发放、过期作废**的预算，
做事按实际耗时消耗它；同时在深夜做事收取倍率惩罚；第二货币（娱乐币）约束娱乐额度。
一周的账本在周末自动汇总，直接进入周日复盘。

**成功标准（可断言）**

1. 关闭该功能时，程序行为与引入本系统之前**完全一致**，复盘导出的 Word / txt **逐字节相同**。
2. 开启后，日结问询能在「打开应用」这一动作下完成，不依赖任何后台定时或系统通知。
3. 一周结束后，复盘页能自动呈现本周账本摘要，无需手工填写。

**非目标**

- 不做账号体系、不做货币兑换、不做多人协作。
- 不做系统级推送 / 通知（网页端明确不要，桌面端亦不做）。
- 不做运行时热切换（见第 4 节）。

---

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| **时币 TC** | 主货币。做事按实际耗时消耗，每周固定发放，周终清零 |
| **娱币 LT** | 副货币。兑换娱乐活动。每周定额 + 表现浮动 |
| **周池 W** | 每周发放的时币总额 |
| **日软上限 D** | 每日建议消耗上限。**不阻断消费**，仅在日结时结算 |
| **透支额 overdraft** | 当日花费超出额度的部分，**只带到次日** |
| **日结** | 对某一天的实际执行情况做一次确认与记账，产出 `LedgerDay` |
| **深夜时段** | `[23:30, 06:00)`。落在此时段的实际做事时长按倍率计费 |
| **计划外事项** | 当天做了但没写进周计划的事 |

---

## 3. 范围

覆盖四个既有视图：**四象限**（事件完成时计量）、**周计划**（日结问询的宿主）、**周日复盘**（周账本摘要的落点）、
**我的**（新增，金钱小组件面板的宿主，见第 12 节）。

不覆盖：目标页（`GoalsPage`）、登录页、云同步协议本身。

---

## 4. 开关机制

### 4.1 定义

单一全局开关，**切换后需要重启程序（桌面端）/ 刷新页面（网页端）才生效**。

这不是妥协，而是刻意的设计选择。理由是它把「关闭 = 原程序逻辑」从**条件判断**变成**结构事实**：

- 关闭时金钱子树**根本不被实例化**。不存在「切换瞬间日结面板还开着」这类中间态。
- 只需在 `App.tsx` 的**一处**做挂载判断。数据在 `useEffect`（`App.tsx:38-47`）里已经由 `init()` 载入，
  判断点的时机是现成的，无需让每个组件对开关做响应式订阅。
- 测试面可控：关闭态的回归 = 现有测试原样通过；开启态另加测试。不产生「开关 × 功能」的组合爆炸。

### 4.2 存储位置

开关与配置一并存在 `AppData.money.enabled`。

**`money` 字段是可选的。** 老数据没有该字段时：

- `validAppData` 必须把 `money === undefined` 判为**合法**（否则 `loadData` 会走 `defaultData()` 分支，
  **静默清空用户全部目标与事件** —— 本项目最严重的故障模式）。
- `money === undefined` 等价于「功能关闭」。

### 4.3 关闭时必须守住的边界

| # | 边界 | 违反后果 |
| --- | --- | --- |
| 1 | 关闭时**不清除** `money` 数据，只停止计算与渲染 | 「关一下开关」= 账本全删，不可逆 |
| 2 | 关闭时不渲染待结算卡片、不渲染复盘账本区块、不弹象限计费气泡、不跑周结算 | 残留 UI |
| 3 | 所有金钱算逻辑集中于纯函数，关闭时**不被调用**，不产生任何写入 | 关闭态仍改数据 |
| 4 | 关闭态复盘导出与改动前逐字节一致 | 无法证明「还原」 |

配一条反向断言：**开启开关不得改变任何现有字段的语义。**

### 4.4 重启的实现

- 桌面端：设置里切换 → 写入数据 → 提示「需要重启生效」→ 提供「立即重启」按钮。
  「立即重启」需要新增一个 IPC（`app.relaunch()` + `app.exit()`），约 3 行。
  **若追求最简约，可只给文字提示，不做按钮** —— 见第 12 节未决问题。
- 网页端：切换 → 提示 → `location.reload()`。

---

## 5. 数据模型

```ts
// src/shared/types.ts —— AppData 新增可选字段
export interface AppData {
  version: 2
  goals: Goal[]
  events: QuadrantEvent[]
  weekPresets: WeekPreset[]
  weekEvents: WeekEvent[]
  weekCounterOffset: number
  money?: MoneyState          // 可选：undefined = 功能从未启用
}

export interface MoneyState {
  enabled: boolean
  config: MoneyConfig
  days: LedgerDay[]           // 日账本，按 date 升序
  weeks: WeekSettlement[]     // 周结算记录，按 weekStart 升序
}
```

> **不设 `balance` 字段。** 当前周的额度与余额全部由 `weeks` 与 `days` 派生
> （本周额度 = `weeks.at(-1)?.nextWeekTC ?? config.weeklyTC`）。
> 冗余的 `balance` 会成为唯一可能与账本不一致的状态，而数据量极小（一周至多 7 条），派生成本可忽略。

export interface MoneyConfig {
  weeklyTC: number            // W
  tcPerHour: number
  nightStartMin: number       // 1410 = 23:30
  nightEndMin: number         // 360  = 06:00
  nightMultiplier: number
  minCapRatio: number         // 0.2
  weeklyLT: number
  rewardLT: number
  penaltyLT: number
  missPenaltyLT: number
}

export interface LedgerDay {
  date: string                // 'YYYY-MM-DD'，本地日期
  settledAt: string | null    // ISO；null = 未结算
  entries: LedgerEntry[]
  // —— 结算快照，settledAt 写入后不再变化 ——
  dayLimit: number            // 当日实际可用额度
  spentTC: number
  overdraft: number           // 带入次日的透支额
  deltaLT: number             // 当日娱币净变化
  nightPending: boolean       // 深夜补记是否仍待确认（见 7.3）
}

export interface LedgerEntry {
  id: string
  kind: 'planned' | 'unplanned'
  sourceId: string | null     // planned → weekEvent.id / quadrantEvent.id
  title: string               // 快照，防源被删后失联
  quadrant: Quadrant | null
  plannedMin: number | null   // 计划时长，计划外为 null
  actualMin: number
  done: boolean
  nightMin: number            // 落在深夜区间内的分钟数；0 表示无
  costTC: number
  deltaLT: number
}

export interface WeekSettlement {
  weekStart: string           // 周一
  weekEnd: string             // 周日
  weekTC: number              // 本周发放额度（已含上周惩罚后的值）
  spentTC: number
  weekOver: number            // 超支额，0 表示未超
  plannedMin: number
  actualMin: number
  doneCount: number
  missCount: number
  unplannedCount: number
  unplannedMin: number
  nightMin: number            // 深夜做事总时长
  overLimitDays: number       // 超日软上限的天数
  penaltyTier: 0 | 1 | 2 | 3  // 0 = 无惩罚
  nextWeekTC: number
  nextWeekLT: number
  notes: string[]             // 自动生成的结论，逐条可解释
}
```

**设计要点**

- 日账本**按日一条**，与 PitBank 的「日结单」模型同构。选它而非给 `WeekEvent` 加字段，原因是：
  `WeekEvent` / `QuadrantEvent` 现在都没有 `done` 字段，「有没有做 / 实际多久 / 计划外的事」全是新数据；
  而**计划外事项**这条最有价值的信息，在任何「扩展既有实体」的方案里都没有落脚点。
- `title` / `quadrant` / `plannedMin` 是**快照**。源事件被删除后账本仍可读，不会出现空记录。
- 所有快照字段在 `settledAt` 写入后**不可变**。补记只能改 `nightPending` 相关部分（见 7.3）。

---

## 6. 金钱逻辑

### 6.1 两种货币

| 货币 | 来源 | 用途 | 互通 |
| --- | --- | --- | --- |
| 时币 TC | 每周一发放 `W`；周日 24:00 清零 | 做事消耗（按实际时长） | ❌ |
| 娱币 LT | 每周一发放 `weeklyLT` + 当日表现浮动 | 兑换自定义娱乐活动 | ❌ |

两者严格隔离、不可互相兑换 —— 双货币分层（软货币易得、硬货币稀缺）是防通胀的基本手段。

### 6.2 时币的三层约束

**① 周池。** `W` 每周一发放，周日 24:00 清零，余额作废。

**② 每日软上限。** `D = W / 7`。**不阻断消费**，只在日结时结算。

**③ 超限侵蚀次日。**

```
dayLimit_i  = max(D × minCapRatio, D − overdraft_{i−1})
overdraft_i = max(0, spent_i − dayLimit_i)
```

- `overdraft` **只带到次日**，隔日自动修复。不累积的理由：`D` 是固定值，累积会导致第 5 天起天天空账，
  惩罚失去区分度，也让「做事」这件事本身变得不可能。
- `minCapRatio = 0.2` 是额度保底：无论前一日透支多少，次日仍保留 20% 额度，避免雪崩。
- 自我修复示例：`D = 50`。第 1 天花 80 → 透支 30。第 2 天额度 20，花 20 → 透支 0。第 3 天额度恢复 50。

### 6.3 计费规则

**单条条目**

```
dayMin  = actualMin − nightMin
base    = (dayMin + nightMin × nightMultiplier) / 60 × tcPerHour
costTC  = round(base)
```

即**只对落在深夜区间内的那部分分钟数**乘倍率，不是整条乘。`nightMin ≤ actualMin` 恒成立。

**深夜判定**

- 周计划事件：**实际开始时刻是未知量**（日结只问实际时长）。用「计划开始时刻 + 实际时长」近似推断实际结束时刻，
  取落在 `[23:30, 06:00)` 内的分钟数 —— 即 `nightMinutesOf(startMin, actualMin, config): number`。
  区间**左闭右开**：恰好 23:30 结束的条目 `nightMin` 为 0。
  这是启发式近似，不是事实 —— 因此 `nightMin` 必须允许手工覆盖（见 7.2）。
- 象限事件：完成动作是实时的，用**当前时刻**判定。这是全系统唯一能实时判定的场合。
- 手工覆盖的方式是**直接改 `nightMin` 这个数字**（填 0 即取消），不设独立的布尔标记 ——
  布尔标记一旦与分钟数并存，两者就可能不一致。

### 6.4 娱币规则

| 情形 | ΔLT |
| --- | --- |
| `!done`（有事情没做） | `−missPenaltyLT` |
| 低效：`actualMin > plannedMin × 1.5` | `−penaltyLT` |
| 高效：`actualMin ≤ plannedMin × 1.0` | `+rewardLT` |
| 其余（1.0 < ratio ≤ 1.5） | 0 |
| **计划外事项** | **只计 TC，不参与 LT** |

计划外事项不参与娱币的理由：否则「随手加一条事项」即可刷币，规则立刻失效。
但它们**计入 TC 与周账本**，因为「做了计划外的事」是真实的执行信息。

### 6.5 周结算与惩罚

```
weekOver = max(0, spentTC(周) − W)
```

| 档位 | 超支比例 | 下周 W | 下周 LT |
| --- | --- | --- | --- |
| 0 | 未超支 | 100% | 100% |
| 1 | ≤ 10% | 85% | 85% |
| 2 | 10% – 30% | 70% | 60% |
| 3 | > 30% | 50% | 40% |

用**档位查表**而非连续公式：更好解释、更好调参，也天然不会把下周罚到归零（守住「不能封锁」的红线）。

---

## 7. 交互设计

### 7.1 唯一的交互入口：日结卡片

**不依赖任何定时器或通知。** 机制是：打开应用时，检查 `days` 中是否存在 `settledAt === null` 且日期早于今天的记录。
有则在周计划页顶部渲染一张常驻卡片：「有 N 天待结算」，点开进入结算面板。

- 待结算天数 > 1 时，**从最早的一天开始**逐日结算。
- 网页端与桌面端行为完全一致。

### 7.2 结算面板的问题序列

对第 `i` 天，依次问：

1. **计划内事件逐条**：做了吗？（是 / 否）→ 做了的话，实际用了多久？（默认预填计划时长）
2. **有没有计划外的事？** 有则逐条录入：标题 / 时长 / 象限归属。
3. **补记项**：见 7.3。

每条实时显示它产生的 TC 消耗与 LT 变化，让规则**当场可解释**，而不是结算完给一个黑箱数字。

### 7.3 深夜补记（关键时序细节）

日结触发点是当天 **23:20**，而深夜时段从 **23:30** 才开始 —— **结算时深夜窗口尚未打开**。
因此深夜部分只能由**次日**的日结补记，这正是需求里「前一天 23:30 还有做事吗」这一问的由来。

实现：

- 日结第 `i` 天时，若 `days[i−1].nightPending === true`，则附带一问：
  「昨夜 23:30 之后还在做事吗？」（是 / 否；是则问持续到几点）
- 答「是」时，把对应时长**追加到第 `i−1` 天**的 `entries`，重算该日的 `spentTC` / `overdraft` / `deltaLT`，
  并把 `nightPending` 置为 `false`。
- 这意味着**第 `i−1` 天的结算快照会被次日修改一次**。这是不可变规则的唯一例外，需在代码中显式标注。
- 由于待结算按「最早优先」逐日结算（7.1），结算第 `i` 天时第 `i−1` 天必然已结算，上述分支在正常路径下不会发生。

### 7.4 象限事件的计费询问

完成象限事件时弹出**两行内联气泡**（非模态）：是否计费 / 小时数（默认预填）。
默认「不计费」，一键确认。四象限页是高频拖拽区，模态会打断操作。

> ⚠️ **前置缺口**：`QuadrantEvent` 目前**没有任何「完成」动作**（只有 `deadline` 与 `escalateAt`）。
> 因此本任务必须先在其右键 / 长按菜单里新增一个「标记完成」入口作为气泡的触发点。
> **不得**给 `QuadrantEvent` 加 `done` 字段 —— 完成状态只存在于账本 `LedgerEntry` 里。
> 四象限页有多次因手势问题返工的历史（见 `AGENTS.md`），新入口必须实测不破坏既有拖拽与长按。

### 7.5 周结算触发

无定时器。**周一（或本周首次打开应用）时**比对「`weeks` 中最后一条的 `weekStart`」与「本周一」：
若不一致，对中间每一个已结束的周**依次**结算 —— 中间缺失的周按空周处理
（`spentTC = 0`、无惩罚、`nextWeekTC` 重置为 `weeklyTC`）。
写入 `weeks` 后，本周额度取最后一条的 `nextWeekTC` 与 `nextWeekLT`。

---

## 8. 复盘汇入

`ReviewPage` 新增「本周账本」区块，与既有的三档滑动条（完成度 / 质量 / 压力）**并列**，不替代。

区块内容来自最新的 `WeekSettlement`：周花费 / 额度、超支额与档位、计划 vs 实际时长、
未完成数、计划外事项数与时长、深夜做事总时长、超限天数，以及 `notes` 里的自动结论。

导出 Word（`src/main/reviewDoc.ts`）与 txt（`platformApi.saveReview`）时，账本摘要作为**追加的一段**
—— 但**不在导出层实现**。做法是在 `ReviewPage` 一处把摘要拼进 `reviewEdit.text`
（`composeReviewText(text, week)`），导出链一行不改。

> 「同源」因此退化为「只有一个调用点」，且关闭态的字节一致**自动成立**：
> `composeReviewText(text, undefined)` 原样返回 `text`。
> 备选方案（给 `ReviewExport` 加字段）会牵动 `main/index.ts:40` 的 IPC 契约与两个消费点，
> 全是新增同步点，**已否决**。

> 关闭开关时该区块不渲染，导出内容与改动前逐字节一致（见 4.3 第 4 条）。

---

## 9. 落点与改动清单

### 9.1 同步点（⚠️ 本项目最易出错的地方）

新增持久化字段必须**同时**改这 **5 个文件**，漏一处即静默故障：

| # | 文件 | 改什么 | 漏掉的后果 |
| --- | --- | --- | --- |
| 1 | `src/shared/types.ts` | `AppData.money?` + 新类型 | 类型不通 |
| 2 | `src/main/dataCodec.ts` | 新增 `normalizeMoney`，在 `parseData` 中调用 | 桌面端读盘时字段丢失 |
| 3 | `src/renderer/src/lib/platformApi.ts` | `validAppData` 增加 `money === undefined \|\| validMoney(money)` | **数据被判非法 → `defaultData()` → 全部目标与事件被清空** |
| 4 | `src/shared/defaults.ts` | `defaultData()` 不含 `money`；**`isEmptyData` 需把金钱数据计入** | 仅有钱账本、无目标事件的用户会被判「空数据」，**云端数据不上传 / 被覆盖保护误判** |
| 5 | `scripts/verify-integrity.mjs` | **两处复刻**：`validAppData`（`:399-421`）与 `firstViolation`（`:424-456`） | 体检脚本与实际校验规则漂移；`:566-597` 的「模型同步」启发式会对 `money` 报 WARN |

> 第 4 处的 `isEmptyData`（`defaults.ts:31-38`）与第 5 处的体检脚本，此前都不在
> 「`types.ts` / `dataCodec` / `validAppData` 三处同步」的既有认知里，是本次排查新发现的。

**明确不需要改的一处**：`src/renderer/src/lib/cloudValidation.ts` 的 `validCloudData`（`:16-19`）
只校验 `version === 2` 与四个数组，**是刻意宽松的**（其文件头注释说明目的是形状容错、
并为了切断与 `cloudSync2.ts` 的模块耦合）。`money` 有无都能通过，符合其设计意图。

### 9.2 新增文件

```
src/shared/money.ts                                  类型 + 纯函数（计费 / 日结 / 周结算 / selectMoneyStats）
src/renderer/src/components/money/SettleCard.tsx     待结算卡片
src/renderer/src/components/money/SettlePanel.tsx    结算面板
src/renderer/src/components/money/QuadrantCostBubble.tsx  象限计费气泡
src/renderer/src/components/money/WeekLedger.tsx     复盘页账本区块
src/renderer/src/pages/MinePage.tsx                  「我的」页（第 12 节）
src/renderer/src/components/mine/*.tsx               6 个小组件 + 面板骨架（第 12.3 节）
```

### 9.3 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/renderer/src/App.tsx` | `PAGE_ORDER`（`:15`）加入 `'mine'`；在 `init()` 完成后判断 `money?.enabled`，决定是否挂载金钱子树 |
| `src/renderer/src/state/appStore.ts` | `Page` 类型加入 `'mine'`；新增 action：`settleDay` / `addUnplannedEntry` / `confirmNight` / `runWeekSettlement` / `setMoneyEnabled` |
| `src/renderer/src/components/Sidebar.tsx` | `NAV`（`:12-17`）加入「我的」；**「外观」按钮加 `desktop-only` 类**（手机端隐藏，见 12.1）；更新 `:148-152` 注释 |
| `src/renderer/src/styles/theme.css` | 仅更新 `:2942` 与 `:2953` 两处注释（列数与指示块尺寸均不变）；新增「我的」页与小组件样式 |
| `src/renderer/src/pages/WeeklyPage.tsx` | 挂载 `SettleCard` |
| `src/renderer/src/pages/QuadrantPage.tsx` | 事件完成时挂载计费气泡 |
| `src/renderer/src/pages/ReviewPage.tsx` | 渲染 `WeekLedger` |
| `src/main/index.ts` + `src/preload/index.ts` | 若做「立即重启」按钮，新增 `app:relaunch` IPC |

> ⚠️ **两处必须实机 / 探针复核**（只读代码发现不了）：
> 1. **手机端 dock**：第 5 格内容由「外观」换成「我的」。验收点 —— 5 格标签均不折行、
>    指示块能滑到第 5 格、`--mobile-nav-height` 仍为 66px、外观入口确实消失。
> 2. **桌面端侧栏高度**：`.nav` 由 5 项增至 6 项（224px → 270px，项高 40 + gap 6）。
>    窗口 `minHeight` 是 640px（`main/index.ts:17`），需确认侧栏底部（云同步按钮 + 寄语）不被挤压或溢出。

### 9.4 常量单一真源

`weeklyTC`、`tcPerHour`、深夜时段等**只定义一次**，位于 `MoneyConfig` 的默认值常量（`src/shared/money.ts`）。

⚠️ 深夜时段（`nightStartMin = 1410`）与 `weekRules.ts` 的 `DAY_START_MIN = 420`（07:00）**语义不同**：
前者是**计费规则**，后者是**时间轴的可见范围**。两者**不应强行同源**。
真正要避免的是同一个常量在 CSS 与 TS 里各写一份（如 `theme.css` 的 `--day-hour` 对应 `weekRules.DAY_HOUR_PX`）。

---

## 10. 测试策略

**纯函数优先。** 计费、日结、周结算全部实现为 `src/shared/money.ts` 中的无副作用函数，可直接单测：

| 用例 | 断言 |
| --- | --- |
| 未超限的普通日 | `overdraft === 0`，`spentTC` 等于条目之和 |
| 超限日 | `overdraft === spent − dayLimit`，且次日 `dayLimit` 相应下降 |
| 连续超限 | 次日额度不低于 `D × 0.2`（保底生效） |
| 自我修复 | 超限日后一天正常消费，第三天额度恢复 `D` |
| 深夜倍率 | 跨 23:30 的条目只对越界分钟数乘倍率 |
| 娱币三分支 | 未做 / 低效 / 高效分别命中，边界值（恰好 1.0、恰好 1.5）单列 |
| 周惩罚档位 | 0% / 10% / 30% / 30%+ 各一例，含边界 |
| **派生统计** | `selectMoneyStats` 在「空账本 / 部分日缺失 / 跨周边界」三种输入下不抛错，数值与手工计算一致 |
| **关闭态隔离** | `money === undefined` 时 `validAppData` 返回 `true` |
| **老数据兼容** | 无 `money` 字段的 v2 数据经 `parseData` 往返后逐字节不变 |

**手机端 dock 验收（需真机或探针，不能只读代码）**：5 格标签不折行、指示块能滑到第 5 格、
`--mobile-nav-height` 仍为 66px、「我的」页在窄屏下小组件单列堆叠且不横向溢出。

**关键回归**：`tests/dataCodec.test.ts`、`tests/platformApi.test.ts` 现有用例必须全绿（基线 204/204）。
新增 `tests/money.test.ts`。测试须**逐文件跑**（多路径会触发沙箱 EPERM）。

---

## 11. 参数默认值

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `weeklyTC` (W) | 350 | 按 `tcPerHour = 10` 折算约 35 小时/周 |
| `tcPerHour` | 10 | 币/小时 |
| `minCapRatio` | 0.2 | 额度保底 |
| `nightStartMin` / `nightEndMin` | 1410 / 360 | 23:30 – 06:00 |
| `nightMultiplier` | 1.5 | 深夜倍率 |
| `weeklyLT` | 10 | 娱币周定额 |
| `rewardLT` / `penaltyLT` / `missPenaltyLT` | 0.5 / 0.5 / 1 | 娱币奖惩 |

> **首周为校准期**：`W` 与 `tcPerHour` 的取值需要一周真实数据才能定标。
> 建议先用默认值跑一周，再按「实际周工时 / 35」的比例调整 `tcPerHour`。

---

## 12. 「我的」页与金钱小组件

### 12.1 导航结构变更（关键约束）

现状：手机端 dock 硬编码五等分 —— `theme.css:2943` 是 `repeat(5, minmax(0, 1fr))`，
指示块 `:2962` 宽 `calc((100% - 8px) / 5)`（`8px` = 4 个间隙 × 2px），
`--nav-index` 只由页面项给出、取值 0~3（`:2953`）。当前**恰好占满 5 格**：4 个页面 + 1 个「外观」入口。

**做法：新增「我的」为第 5 个页面；「外观」入口在手机端隐藏。**

| 步骤 | 具体改动 |
| --- | --- |
| 1 | `NAV`（`Sidebar.tsx:12-17`）加入 `{ page: 'mine', label: '我的' }` ⇒ 5 个页面项 |
| 2 | 「外观」按钮加 `desktop-only` 类（该类已存在：`theme.css:150` 与 `:3733` 手机档 `display: none !important`） |
| 3 | 手机端可见项 = 5 个页面 ⇒ **刚好填满 `repeat(5)`**，`grid-template-columns` 与指示块宽度**都不用改** |
| 4 | 桌面端 `.nav` 是 flex 纵向列（`:194-199`），6 项自由堆叠；「外观」不参与 `--nav-index`，指示块位移（`:215`，46px/项）无需改动 |
| 5 | 更新两处注释：`theme.css:2942`、`:2953`（`--nav-index` 取值域 0~3 → 0~4） |

**为什么竖屏不提供外观设置**（本次决策）：玻璃参数（模糊量 / 饱和度 / 圆角 / 折射模式）需要在宽屏上预览才有意义，
窄屏下改完看不到效果，等于给了一个不可验证的设置项。

关键点：**该限制跟「布局档位」走，不跟「设备」走。** 本项目布局是纯宽度驱动
（唯一断点 `max-width: 767px` 为手机档，`theme.css:1680/2851`；全文件**没有任何 orientation 媒体查询**），
手机**横屏宽度 ≥ 768px 会自动进入桌面结构**，外观入口随之出现。

> 因此**不需要 orientation 媒体查询，也不需要 JS `matchMedia` 判断** —— 一条 `desktop-only` 类即可，
> 且行为与现有断点体系自动一致。

若改为新增第 6 格（不隐藏外观），则需 `repeat(6, …)` 与 `(100% - 10px) / 6`，
每格宽度由约 75px 降到约 62px，必须真机复核 4 字标签（「周日复盘」）是否折行。不取此路。

### 12.2 页面结构

```
我的
├─ 金钱                ← 仅当 money?.enabled 时渲染（见 4.3 第 2 条）
│   └─ 6 个小组件（12.3）
├─ 设置                ← 始终渲染
│   ├─ 金钱系统开关（带「需重启生效」提示）
│   └─ 云同步状态
└─ 关于
```

> 「外观设置」**不进本页**，仍留在侧栏（桌面端可见）。原因：若同时放进「我的」，
> 竖屏下就能从「我的」打开它，与 12.1 的限制矛盾。

### 12.3 小组件清单

| # | 组件 | 展示内容 | 视觉 |
| --- | --- | --- | --- |
| 1 | 双币余额 | 时币剩余 / 娱币剩余 + 本周已用比例 | 两个大数字 + 一条剩余进度条 |
| 2 | 本周消耗 | 周一~周日 7 根柱，柱高 = 当日 `spentTC` | 柱状图 + 日额度 `D` 的水平基准线；超限柱换警示色 |
| 3 | 日额度热力 | 7 格色阶 = `spentTC / D` | GitHub 贡献图的缩小版 |
| 4 | 深夜时段 | 本周深夜做事总时长与占比 | 横向占比条 |
| 5 | 执行质量 | 高效 / 正常 / 低效 / 未完成 四类计数 | 四段堆叠条 + 图例 |
| 6 | 惩罚预告 | 若本周现在结束会落哪一档、下周 `W` 与 `LT` 各打折多少 | 档位徽标 + 两个百分比 |

组件 1 与 6 是 hero（跨两列），其余四个为单列小卡。

### 12.4 布局与响应式

桌面：CSS Grid，12 列基准。组件 1 与 6 是 hero，各跨 6 列（一行两个）；其余四个小卡各跨 3 列（一行四个）。
手机：**单列堆叠**，顺序即上表顺序（最重要的余额与惩罚预告在前）。

⚠️ **小组件卡片默认不玻璃化**，沿用现有面板样式（`.gs-panel` 之外的普通卡片）。
理由：每新增一个材质宿主都要重新满足「祖先链上不能有合成面」这条约束（`fixed` / `sticky` / 非 auto 的 `z-index`），
本项目为此返工过多次。玻璃化作为后续可选项，不在本期范围内。

### 12.5 数据来源

全部由 `money.days` / `money.weeks` 派生，**不新增持久化字段**。
实现为一个纯函数选择器 `selectMoneyStats(money, today): MoneyStats`，与计费逻辑同住在 `src/shared/money.ts`，可直接单测。

### 12.6 技术选型：零新增依赖

检索了 GitHub 上的主流方案，结论是**一个都不引入**：

| 候选 | ★ | 否决理由 |
| --- | --- | --- |
| `react-grid-layout/react-grid-layout` | 22,437 | 拖拽/缩放正是「简约」不需要的；引入第二个依赖及其 CSS；且其拖拽会与本项目已有的 `touch-action` 手势系统冲突（`touch-action` 在 `pointerdown` 时锁存、整段手势改类无效） |
| `recharts/recharts` | 27,597 | 基于 D3，体积与依赖过重，而本项目图表数据量极小（7 天 × 几个指标） |
| `tremorlabs/tremor-npm` | 16,486 | 依赖 Tailwind，本项目用 `theme.css` 纯 CSS + 设计令牌 |
| `metafizzy/packery` | 4,322 | 瀑布流用于变高卡片；本页卡片等高 |
| `kevinsqi/react-calendar-heatmap` | 1,300 | 借鉴其热力图视觉，自实现约 40 行 SVG 即可 |
| `danielbayerlein/dashboard` | 1,343 | 借鉴其「组件注册表 + 配置」的组织方式（不是代码） |

**全部手写 SVG + CSS Grid。** 依据：项目现有全部可视化（四象限坐标系、时间轴、三档滑块、玻璃材质）
都是手写 SVG/CSS，引入图表库会带来与 `theme.css` 设计令牌并行的第二套样式语言；
且移动端是本项目当前最高优先级，任何与现有手势系统冲突的依赖都是净负担。

---

## 13. 决策记录与遗留问题

### 13.1 已在计划阶段决议

| # | 问题 | 决议 | 依据 |
| --- | --- | --- | --- |
| 1 | 「立即重启」按钮 | **不做** | `app.relaunch()` + `app.exit()` 不会触发 `before-quit`，即绕过 `main/index.ts:57-66` 的落盘兜底，会丢掉最后一次 `data:save`。改为只给文字提示，用户手动重开 |
| 2 | 象限计费气泡的小时数默认值 | **不预填，每次手填** | 给 `QuadrantEvent` 加预估时长字段要牵动 5 个同步点，为一个小交互不值 |
| 3 | `balance` 字段 | **移除**，改为派生 | 见第 5 节 |
| 4 | 娱币的兑换清单 | **本期不做** | 先验证惩罚机制是否真的有效；清单本身是独立子系统，值得单独一份 spec |

### 13.2 遗留（不阻塞实施）

- 娱币兑换清单（决策 4）。
- 小组件卡片的玻璃化。
- 桌面端系统级通知 —— 已明确不做（网页端不要提醒，两端统一走应用内卡片）。

---

## 14. 参考项目与机制出处

| 来源 | 借鉴点 |
| --- | --- |
| `HabitRPG/habitica`（★14,178） | 双货币分层；「取消完成则退还」保证账本与状态一致。**激励方向相反**：它做事赚钱，本系统做事花钱 |
| `Mohandas-KJ/PitBank` | 把专注会话建模为**银行交易**，产出不可变日结单 + 周汇总 ⇒ 本系统「账本与复盘同源」的思路来源 |
| `BanMuye/HabitPlant` | 中文自用形态：打卡得币 → 商城；未完成扣生命值（双向奖惩） |
| `allanhue/HabitTrove` / `Ayagikei/LifeUp` / `joravarsinghing/SelfMint` | 「完成任务赚币 → 兑换」的同类机制，参考价值递减 |
| TimeScape（python-fullstack） | 纯「时间即货币」，每动作扣币（含 Sleep −15）⇒ 深夜扣费的直系先例；但其归零 = Game Over **不可移植** |
| YNAB 超支结转规则 | 现金超支从下期可用额度扣除；**负值不结转**、**不改历史只影响未来** ⇒ 本系统 `overdraft` 语义的来源 |
| 手游体力 / 树脂系统（原神树脂、鸣潮行动力） | 反例。Unity 官方经济指南指出溢出上限是**留存工具**，靠沉没成本焦虑换日活。移植到自用工具是负收益 ⇒ 因此本系统坚持**软上限、不阻断、不归零** |
