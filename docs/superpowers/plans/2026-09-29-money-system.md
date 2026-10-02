# 金钱系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「象限」加入一套「时间就是金钱」的双货币激励系统，覆盖四象限 / 周计划 / 周日复盘，并新增「我的」页作为其小组件仪表盘。

**Architecture:** 计费与结算全部实现为 `src/shared/money.ts` 中的**无副作用纯函数**，数据落在一个新增的可选字段 `AppData.money` 上（每天一条日账本记录）。界面分三层：周计划页的「待结算卡片」是唯一日常入口，象限页有轻量计费气泡，复盘页与「我的」页只读地派生展示。整个子系统由一个**启动时读取的开关**控制，关闭时金钱子树根本不被实例化。

**Tech Stack:** TypeScript 5.5 + React 18.3 + Zustand 4.5 + Electron 31 / Vite 5；**零新增依赖**，可视化全部手写 SVG + CSS Grid。

**Spec:** `docs/superpowers/specs/2026-09-29-money-system-design.md`

## Global Constraints

- **不新增任何 npm 依赖。** 图表、栅格、拖拽全部手写。
- **测试必须逐文件跑**：`./node_modules/.bin/vitest run tests/<file>.test.ts`。多路径会触发沙箱 EPERM。基线 **204/204**。
- **不要用 `npm run <script>`** —— 本终端会报 `/usr/bin/env: bash` 找不到。一律直接调 `./node_modules/.bin/<bin>`。
- 类型检查：`./node_modules/.bin/tsc --noEmit -p tsconfig.web.json` 与 `./node_modules/.bin/tsc --noEmit -p tsconfig.node.json`。
- 若 `electron-vite build` 因沙箱批量删除被拦，先用 Python `shutil.rmtree('out/main')`、`shutil.rmtree('out/preload')` 清一次再构建。
- **CI 锁 Node 20**。纯逻辑模块**不得**与「顶层有副作用」的模块同住一个文件（`cloudValidation.ts:3-15` 记录了这次教训）。
- **新增持久化字段必须同步 5 个文件**（spec 9.1）：`shared/types.ts`、`main/dataCodec.ts`、`renderer/lib/platformApi.ts`、`shared/defaults.ts`、`scripts/verify-integrity.mjs`（该脚本内有 **2 处**复刻：`validAppData` 与 `firstViolation`）。
- **关闭态零副作用**（spec 4.3）：`money === undefined` 或 `enabled === false` 时，不渲染任何金钱 UI、不写任何金钱数据、复盘导出与改动前**逐字节一致**。`money` 字段在关闭时**必须保留**，不得清除。
- **参数默认值原样使用**（spec 11）：`weeklyTC 350`、`tcPerHour 10`、`minCapRatio 0.2`、`nightStartMin 1410`、`nightEndMin 360`、`nightMultiplier 1.5`、`weeklyLT 10`、`rewardLT 0.5`、`penaltyLT 0.5`、`missPenaltyLT 1`。
- **注释正文里绝不能出现注释终止符本身**（CSS/JS 通用，本项目已复发两次 —— 一次让 `.gs-plate.gs-refract` 整条规则被解析器丢弃）。
- 提交信息沿用仓库既有风格（`feat:` / `fix:` / `test:` 前缀）。

## Review Focus

以下是 spec 隐含、但没有哪个任务的测试会主动覆盖、且最可能在真实使用中咬人的输入。
每一条都在下面对应任务的测试里被钉住。

1. **跨周未结算** —— 用户出差两周后打开应用，`days` 里堆了 10 个未结算日且跨了两个周边界。
   期望：按最早优先逐日结算；中间的完整周各结算一次，空周按零花费、不惩罚处理。
2. **源事件已被删除** —— 日结时不慎删掉了对应的周计划事件，`sourceId` 悬空。
   期望：账本靠 `title` 快照仍可完整阅读，不抛错、不出现空白行。
3. **`plannedMin` 为 `null` 或 `0`** —— 计划外条目没有计划时长，或用户填了 0。
   期望：娱币判定返回 0（正常），不做除零比较，不产生 `NaN`。
4. **恰好在 23:30 结束** —— 事件的推断结束时刻正好等于 `nightStartMin`。
   期望：**不算**深夜（区间左闭右开），倍率不生效。
5. **`enabled: false` 但账本数据仍在** —— 用户关掉开关后再导出复盘。
   期望：导出内容与从未启用过该功能时**逐字节一致**。

---

### Task 1: 持久化与开关字段

**Files:**
- Create: `src/shared/money.ts`（本任务只放常量 `DEFAULT_MONEY_CONFIG`）
- Modify: `src/shared/types.ts`
- Modify: `src/shared/defaults.ts`
- Modify: `src/main/dataCodec.ts`
- Modify: `src/renderer/src/lib/platformApi.ts`
- Modify: `scripts/verify-integrity.mjs:387-456`（两处复刻）
- Test: `tests/dataCodec.test.ts`, `tests/platformApi.test.ts`, `tests/syncMeta.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 类型 `MoneyConfig` / `LedgerEntryKind` / `LedgerEntry` / `LedgerDay` / `PenaltyTier` / `WeekSettlement` / `MoneyState`；`AppData.money?: MoneyState`
  - `src/shared/money.ts`：常量 `DEFAULT_MONEY_CONFIG: MoneyConfig`
  - `main/dataCodec.normalizeMoney(raw: unknown): MoneyState | undefined`
  - `renderer/lib/platformApi`: 模块内 `validMoney(value: unknown): boolean`
  - `shared/defaults`: `defaultData()` 不含 `money`；`isEmptyData(data: AppData): boolean` 计入金钱数据

字段定义以 spec 第 5 节为准，逐字抄写。要点：`MoneyState` **没有** `balance` 字段。

- [ ] **Step 1: 写失败测试 —— 往返保真与老数据不变**

在 `tests/dataCodec.test.ts` 末尾追加：

```ts
it('无 money 字段的 v2 数据往返后逐字节不变', () => {
  const raw = { version: 2, goals: [], events: [], weekPresets: [], weekEvents: [], weekCounterOffset: 0 }
  expect(parseData(JSON.stringify(raw))).toEqual(raw)
})

it('money 为非对象时被丢弃为 undefined，不影响其余字段', () => {
  const out = parseData({ ...baseData, money: 42 })
  expect(out.money).toBeUndefined()
  expect(out.goals).toEqual(baseData.goals)
})

it('合法 money 往返保真（含一天已结算记录）', () => {
  const out = parseData(JSON.parse(JSON.stringify(sampleDataWithMoney)))
  expect(out.money).toEqual(sampleDataWithMoney.money)
})
```

`baseData` / `sampleDataWithMoney` 是本文件已有的构造辅助，按现有风格定义。

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/dataCodec.test.ts`
Expected: FAIL —— `parseData` 返回的对象里没有 `money`（`out.money` 为 `undefined`，第三条断言失败）

- [ ] **Step 3: 在 `src/shared/types.ts` 补类型并接上 `normalizeMoney`**

在 `types.ts` 的 `AppData` 里加 `money?: MoneyState`，并逐字抄写 spec 第 5 节的全部类型。
`dataCodec.ts` 中新增 `normalizeMoney`：非 record 或无 `boolean` 类型的 `enabled` → 返回 `undefined`；
`config` 逐键用 `Number.isFinite` 校验、非法回退到 `DEFAULT_MONEY_CONFIG` 的同名值；
`days` / `weeks` 逐项做结构过滤（字段不全的项丢弃，不使整份数据失效）。
在 `parseData` 的返回对象里加上 `...(money ? { money } : {})`。

> 本步顺带创建 `src/shared/money.ts`，在其中导出 `DEFAULT_MONEY_CONFIG`（逐字抄写 spec 第 11 节的默认值）。
> Task 2 起的各任务只往这个文件继续追加函数，不新建模块。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/dataCodec.test.ts`
Expected: PASS（含既有全部用例）

- [ ] **Step 5: 写失败测试 —— `money === undefined` 必须合法**

在 `tests/platformApi.test.ts` 追加：

```ts
it('money === undefined 的数据是合法的（否则老数据会被静默重置）', async () => {
  const api = createWebPlatformApi(fakeStorage(JSON.stringify(baseData)))
  expect(await api.loadData()).toEqual(baseData)
})

it('money 存在但 enabled 不是布尔时整份数据被拒', async () => {
  const bad = { ...baseData, money: { enabled: 'yes', config: {}, days: [], weeks: [] } }
  const api = createWebPlatformApi(fakeStorage(JSON.stringify(bad)))
  expect(await api.loadData()).toEqual(defaultData())
})

it('含合法 money 的数据通过校验', async () => {
  const api = createWebPlatformApi(fakeStorage(JSON.stringify(sampleDataWithMoney)))
  expect((await api.loadData()).money).toEqual(sampleDataWithMoney.money)
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/platformApi.test.ts`
Expected: FAIL —— 至少第二条会失败（`money` 存在时旧校验器对未知字段整体放行，非法 `enabled` 被当合法）。
第三条是否 RED 取决于实现顺序，不必强求两条都红。

- [ ] **Step 7: 在 `platformApi.ts` 实现 `validMoney` 并接入 `validAppData`**

`validMoney` 只校验 spec 第 5 节列出的字段类型，宽严程度与既有 `validPhotos` 一致（可选字段放行、存在则必须合规）。
接入方式为 `(data.money === undefined || validMoney(data.money))`。

- [ ] **Step 8: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/platformApi.test.ts`
Expected: PASS

- [ ] **Step 9: 同步 `scripts/verify-integrity.mjs` 的两处复刻**

在 `:390-421` 区域加 `validMoney` 与 `validAppData` 里的 `(d.money === undefined || validMoney(d.money))`；
在 `:424-456` 的 `firstViolation` 里加对应的分支，返回 `` `money 不合规（检查 enabled/config/days/weeks）` ``。
注意该文件的 `hasStringFields` / `num` / `quad` 辅助位于各自作用域内，按现有写法复用。

- [ ] **Step 10: 验证体检脚本**

```bash
python -c "import json,os;os.makedirs('tmp/vi-probe',exist_ok=True);json.dump({'version':2,'goals':[],'events':[],'weekPresets':[],'weekEvents':[],'weekCounterOffset':0},open('tmp/vi-probe/plan.json','w'))"
node scripts/verify-integrity.mjs --appdata tmp/vi-probe
```
Expected: 「运行数据」组 pass；**不出现**关于 `money` 的 FAIL 或 WARN。

- [ ] **Step 11: `isEmptyData` 计入金钱数据**

在 `src/shared/defaults.ts` 的 `isEmptyData` 里追加条件：`money` 存在且 `days` 或 `weeks` 非空时，
本函数返回 `false`。文件头注释同步说明「金钱账本也算用户数据」。

补测试：**追加到 `tests/syncMeta.test.ts`** —— 该文件已经覆盖 `isEmptyData`（`:207-209`），
不要新建 `tests/defaults.test.ts`。新增用例：仅含一条已结算日的 `money` + 四个数组全空 → `isEmptyData` 为 `false`。
注意既有断言 `isEmptyData(data({ weekCounterOffset: 120 }))` 仍应为 `true`（无 `money` 字段），必须保持通过。

⚠️ 这个改动有真实行为后果：`syncMeta.ts:57` 用它决定 `adopt-cloud`，`appStore.ts:150/158` 用它做云端覆盖保护。
只加「钱账本也算数据」这一条，不要顺带改别的判据。

- [ ] **Step 12: 跑全部相关测试**

Run: `./node_modules/.bin/vitest run tests/dataCodec.test.ts`
Run: `./node_modules/.bin/vitest run tests/platformApi.test.ts`
Run: `./node_modules/.bin/vitest run tests/defaults.test.ts`
Expected: 全部 PASS

- [ ] **Step 13: 提交**

```bash
git add src/shared/types.ts src/shared/defaults.ts src/main/dataCodec.ts src/renderer/src/lib/platformApi.ts scripts/verify-integrity.mjs tests/
git commit -m "feat(money): add optional money field with validators and sync points"
```

---

### Task 2: 单条计费与娱币判定

**Files:**
- Modify: `src/shared/money.ts`（Task 1 已创建，本任务追加）
- Test: `tests/money.test.ts`

**Interfaces:**
- Consumes: `MoneyConfig`、`DEFAULT_MONEY_CONFIG`（Task 1）
- Produces:
  - `nightMinutesOf(input: { startMin: number; actualMin: number }, config: MoneyConfig): number`
  - `costOfEntry(input: { actualMin: number; nightMin: number }, config: MoneyConfig): number`
  - `leisureDelta(input: { kind: LedgerEntryKind; done: boolean; actualMin: number; plannedMin: number | null }, config: MoneyConfig): number`

**为什么 `costOfEntry` 收 `nightMin` 而不是布尔**：spec 6.3 要求**只对落在深夜区间内的那部分分钟数**乘倍率，
不是整条乘。布尔标记做不到部分倍率，且一旦与分钟数并存就会两者不一致。

- [ ] **Step 1: 写失败测试**

```ts
it('按实际时长计费：2 小时 × 10 币 = 20', () => {
  expect(costOfEntry({ actualMin: 120, nightMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(20)
})

it('深夜倍率只作用于落在深夜区间的那部分分钟数', () => {
  // 120 分钟中 60 分钟在深夜：(60 + 60 × 1.5) / 60 × 10 = 25
  expect(costOfEntry({ actualMin: 120, nightMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(25)
  expect(costOfEntry({ actualMin: 120, nightMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(30)
})

it('实际时长为 0 时不产生费用', () => {
  expect(costOfEntry({ actualMin: 0, nightMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(0)
})

it('nightMinutesOf：区间左闭右开，恰好 23:30 结束不算深夜', () => {
  expect(nightMinutesOf({ startMin: 1350, actualMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0)   // 22:30 + 60
  expect(nightMinutesOf({ startMin: 1350, actualMin: 90 }, DEFAULT_MONEY_CONFIG)).toBe(30)  // 22:30 + 90
  expect(nightMinutesOf({ startMin: 1380, actualMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(30)  // 23:00 + 60
})

it('nightMinutesOf：跨零点到次日清晨', () => {
  // 23:00 开始做 480 分钟 → 落在 [23:30, 06:00) 内的是 390 分钟
  expect(nightMinutesOf({ startMin: 1380, actualMin: 480 }, DEFAULT_MONEY_CONFIG)).toBe(390)
})

it('nightMinutesOf：完全在白天为 0', () => {
  expect(nightMinutesOf({ startMin: 600, actualMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(0)
})

it('没做的事扣娱币，不看时长', () => {
  expect(leisureDelta({ kind: 'planned', done: false, actualMin: 0, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(-1)
})

it('高效完成有奖励，低效完成有惩罚，中间段为 0', () => {
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 60, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0.5)
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 120, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(-0.5)
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 80, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0)
})

it('边界：恰好等于计划时长算高效，恰好 1.5 倍不算低效', () => {
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 60, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0.5)
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 90, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0)
})

it('计划外条目不参与娱币（否则随手加一条就能刷币）', () => {
  expect(leisureDelta({ kind: 'unplanned', done: true, actualMin: 30, plannedMin: null }, DEFAULT_MONEY_CONFIG)).toBe(0)
})

it('plannedMin 为 null 或 0 时返回 0，不产生 NaN', () => {
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 30, plannedMin: null }, DEFAULT_MONEY_CONFIG)).toBe(0)
  expect(leisureDelta({ kind: 'planned', done: true, actualMin: 30, plannedMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: FAIL —— `costOfEntry is not a function`

- [ ] **Step 3: 实现三个函数**

`nightMinutesOf`：逐分钟判定，不要写闭式公式 —— 深夜区间跨零点（`[1410, 1440) ∪ [0, 360)`），
闭式容易在跨零点与跨多日两处出错，而 `actualMin` 上限只有 600，逐分钟循环完全可接受。
对 `i ∈ [0, actualMin)`，取 `m = (startMin + i) mod 1440`，落在区间内则计数。

`costOfEntry`：`dayMin = actualMin - nightMin`，再按 spec 6.3 的公式取整。

`leisureDelta` 判定顺序：`!done` → `missPenaltyLT`；`kind === 'unplanned'` → 0；
`plannedMin` 非正数或为 `null` → 0；`actualMin <= plannedMin × 1.0` → `+rewardLT`；
`actualMin > plannedMin × 1.5` → `−penaltyLT`；否则 0。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/money.ts tests/money.test.ts
git commit -m "feat(money): add per-entry cost and leisure-token delta"
```

---

### Task 3: 日结算（额度、透支、保底）

**Files:**
- Modify: `src/shared/money.ts`
- Test: `tests/money.test.ts`

**Interfaces:**
- Consumes: `costOfEntry` / `leisureDelta`（Task 2）
- Produces:
  - `dayLimitOf(previousOverdraft: number, config: MoneyConfig): number`
  - `settleDay(input: { date: string; entries: LedgerEntry[]; previousOverdraft: number; settledAt: string; config: MoneyConfig }): LedgerDay`

- [ ] **Step 1: 写失败测试**

```ts
it('无透支时当日额度等于周额度除以 7', () => {
  expect(dayLimitOf(0, DEFAULT_MONEY_CONFIG)).toBe(50)
})

it('透支从次日额度扣除，且不击穿保底线', () => {
  expect(dayLimitOf(30, DEFAULT_MONEY_CONFIG)).toBe(20)
  expect(dayLimitOf(999, DEFAULT_MONEY_CONFIG)).toBe(10)   // 50 × 0.2
})

it('未超限的普通日：透支为 0，花费等于条目之和', () => {
  const day = settleDay({
    date: '2026-09-28', previousOverdraft: 0, settledAt: '2026-09-28T23:20:00.000Z',
    entries: [
      mkEntry({ actualMin: 120, plannedMin: 120, done: true }),
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ],
    config: DEFAULT_MONEY_CONFIG
  })
  expect(day.spentTC).toBe(30)
  expect(day.overdraft).toBe(0)
  expect(day.dayLimit).toBe(50)
})

it('超限日的透支等于花费减额度', () => {
  const day = settleDay({
    date: '2026-09-28', previousOverdraft: 0, settledAt: 'x',
    entries: [mkEntry({ actualMin: 480, plannedMin: 480, done: true })],   // 80 币
    config: DEFAULT_MONEY_CONFIG
  })
  expect(day.overdraft).toBe(30)
})

it('自修复：透支一天后正常消费，第三天额度恢复', () => {
  const d1 = settleDay({ date: '2026-09-28', previousOverdraft: 0, settledAt: 'x',
    entries: [mkEntry({ actualMin: 480, plannedMin: 480, done: true })], config: DEFAULT_MONEY_CONFIG })
  const d2 = settleDay({ date: '2026-09-29', previousOverdraft: d1.overdraft, settledAt: 'x',
    entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })], config: DEFAULT_MONEY_CONFIG })
  expect(d2.dayLimit).toBe(20)
  expect(d2.overdraft).toBe(0)
  expect(dayLimitOf(d2.overdraft, DEFAULT_MONEY_CONFIG)).toBe(50)
})

it('deltaLT 是当日全部条目娱币增量之和', () => {
  const day = settleDay({ date: '2026-09-28', previousOverdraft: 0, settledAt: 'x',
    entries: [mkEntry({ done: false }), mkEntry({ done: true, actualMin: 30, plannedMin: 60 })],
    config: DEFAULT_MONEY_CONFIG })
  expect(day.deltaLT).toBe(-0.5)
})
```

`mkEntry` 是本测试文件内的构造辅助，默认 `kind: 'planned'`、`nightMin: 0`、`actualMin: 0`、`plannedMin: 60`。

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: FAIL —— `dayLimitOf is not a function`

- [ ] **Step 3: 实现**

`dayLimitOf` = `Math.max(weeklyTC / 7 * minCapRatio, weeklyTC / 7 - previousOverdraft)`。
`settleDay` 计算 `dayLimit` → `spentTC`（逐条 `costOfEntry` 求和）→ `overdraft = Math.max(0, spentTC - dayLimit)`
→ `deltaLT`（逐条 `leisureDelta` 求和），`settledAt` 原样写入，`nightPending` 置 `true`。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/money.ts tests/money.test.ts
git commit -m "feat(money): add daily settlement with overdraft carry and floor"
```

---

### Task 4: 周结算、档位惩罚与跨周滚动

**Files:**
- Modify: `src/shared/money.ts`
- Test: `tests/money.test.ts`

**Interfaces:**
- Consumes: `settleDay` 的产物 `LedgerDay`（Task 3）
- Produces:
  - `penaltyTierOf(weekOver: number, weekTC: number): PenaltyTier`
  - `settleWeek(input: { weekStart: string; weekEnd: string; days: LedgerDay[]; weekTC: number; weekLT: number; config: MoneyConfig }): WeekSettlement`
  - `ensureWeekRollover(state: MoneyState, today: string): MoneyState`
  - `currentQuota(state: MoneyState): { weekTC: number; weekLT: number }`

档位表（spec 6.5，逐字）：未超支 → tier 0，下周 100%/100%；
超支 ≤10% → tier 1，85%/85%；10%–30% → tier 2，70%/60%；>30% → tier 3，50%/40%。

**测试夹具用一个 helper，不要两个**：`mkWeek(over?: { spent?: number; weekStart?: string; nextWeekTC?: number; nextWeekLT?: number })`
返回 `settleWeek` 的入参（内部造 7 天的 `LedgerDay`，默认 `spent = 300`）。
断言里的 `overLimitDays: 1` / `unplannedCount: 1` / `unplannedMin: 45` / `missCount: 1` / `nightMin: 30`
由这个默认夹具的形状决定 —— 实现者自行构造能同时满足这五个数的一组条目即可，夹具内部结构不作硬性规定。
另需一个 `mkSettledWeek(over?)` 直接返回一个**已算好的** `WeekSettlement`，供跨周滚动与 T10 使用。

- [ ] **Step 1: 写失败测试**

```ts
it('档位边界', () => {
  expect(penaltyTierOf(0, 350)).toBe(0)
  expect(penaltyTierOf(35, 350)).toBe(1)      // 恰好 10%
  expect(penaltyTierOf(36, 350)).toBe(2)
  expect(penaltyTierOf(105, 350)).toBe(2)     // 恰好 30%
  expect(penaltyTierOf(106, 350)).toBe(3)
})

it('各档位对应的下周额度', () => {
  expect(settleWeek(mkWeek({ spent: 300 })).nextWeekTC).toBe(350)
  expect(settleWeek(mkWeek({ spent: 385 })).nextWeekTC).toBeCloseTo(297.5)
  expect(settleWeek(mkWeek({ spent: 420 })).nextWeekTC).toBeCloseTo(245)
  expect(settleWeek(mkWeek({ spent: 460 })).nextWeekTC).toBeCloseTo(175)
})

it('未超支时娱币不打折', () => {
  expect(settleWeek(mkWeek({ spent: 300 })).nextWeekLT).toBe(10)
})

it('周汇总的字段来自日账本', () => {
  const w = settleWeek(mkWeek({ spent: 300 }))
  expect(w.overLimitDays).toBe(1)
  expect(w.unplannedCount).toBe(1)
  expect(w.unplannedMin).toBe(45)
  expect(w.missCount).toBe(1)
  expect(w.nightMin).toBe(30)
})

it('跨周滚动：缺失的周按空周处理，不惩罚、额度重置', () => {
  const state = { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [
    mkSettledWeek({ weekStart: '2026-09-07', nextWeekTC: 245, nextWeekLT: 6 })
  ] }
  const next = ensureWeekRollover(state, '2026-09-28')   // 距今跨了 09-14、09-21 两个周
  expect(next.weeks).toHaveLength(3)
  expect(next.weeks[1].weekTC).toBeCloseTo(245)
  expect(next.weeks[2].weekTC).toBe(350)
  expect(currentQuota(next)).toEqual({ weekTC: 350, weekLT: 10 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: FAIL —— `penaltyTierOf is not a function`

- [ ] **Step 3: 实现**

`settleWeek` 遍历该周 7 天的 `LedgerDay`（缺失的日按零计），汇总 spec 5 节 `WeekSettlement` 的全部字段；
`weekOver = Math.max(0, spentTC - weekTC)`；据档位算 `nextWeekTC` / `nextWeekLT`。
`notes` 生成 2–4 条可解释结论（如「本周 3 天超限」「深夜做事 120 分钟」「有 2 件事没做」）。
`ensureWeekRollover` 用 `mondayOf`（见下）算出「最后一次结算的下一周」到「上一个已结束的周」，逐周补齐。

> 需要周一计算：复用 `src/renderer/src/lib/weekRules.ts` 的 `mondayOf` / `addDays`。
> **但这会让 `shared/` 依赖 `renderer/`，方向是错的。** 正确做法是把 `mondayOf` / `addDays` / `dateKey`
> 这三个纯日期函数**下沉到 `src/shared/`**（新建 `src/shared/dateKey.ts`），让 `weekRules.ts` 改为 re-export。
> 这一步**不得改变** `weekRules.ts` 的对外签名，既有 `tests/weekRules.test.ts` 必须原样全绿。

- [ ] **Step 4: 跑测试确认通过（含 weekRules 回归）**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Run: `./node_modules/.bin/vitest run tests/weekRules.test.ts`
Expected: 全部 PASS —— 后者证明日期函数下沉没有破坏既有行为

- [ ] **Step 5: 提交**

```bash
git add src/shared/money.ts src/shared/dateKey.ts src/renderer/src/lib/weekRules.ts tests/
git commit -m "feat(money): add weekly settlement, penalty tiers and week rollover"
```

---

### Task 5: 派生统计（小组件的数据源）

**Files:**
- Modify: `src/shared/money.ts`
- Test: `tests/money.test.ts`

**Interfaces:**
- Consumes: `currentQuota`（Task 4）
- Produces:
  - `interface MoneyStats`
  - `selectMoneyStats(money: MoneyState, today: string): MoneyStats`

`MoneyStats` 字段（供 Task 7 的 6 个小组件消费，逐字实现）：
`weekStart`、`weekTC`、`spentTC`、`remainingTC`、`weekLT`、`spentLT`、`remainingLT`、
`daily: { date: string; weekday: string; spentTC: number; limit: number; ratio: number }[]`（恒为 7 项）、
`nightMin`、`nightRatio`、`quality: { efficient: number; normal: number; inefficient: number; missed: number }`、
`penaltyTier: PenaltyTier`、`nextWeekTC: number`、`nextWeekLT: number`。

- [ ] **Step 1: 写失败测试**

```ts
it('daily 恒为 7 项，未结算的日子按零计', () => {
  const stats = selectMoneyStats(moneyWithTwoSettledDays, '2026-09-30')
  expect(stats.daily).toHaveLength(7)
  expect(stats.daily[0].ratio).toBe(0)
  expect(stats.daily[0].limit).toBeCloseTo(50)
  expect(stats.daily.map((d) => d.weekday)).toEqual(['一','二','三','四','五','六','日'])
})

it('余额 = 额度减本周已花', () => {
  const stats = selectMoneyStats(moneyWithTwoSettledDays, '2026-09-30')
  expect(stats.remainingTC).toBeCloseTo(stats.weekTC - stats.spentTC)
})

it('ratio = spentTC / limit，limit 为 0 时不产生 Infinity', () => {
  const stats = selectMoneyStats(moneyWithZeroLimitDay, '2026-09-30')
  expect(Number.isFinite(stats.daily[0].ratio)).toBe(true)
  expect(stats.daily[0].ratio).toBe(0)
})

it('quality 四类计数与条目一一对应', () => {
  const stats = selectMoneyStats(moneyWithTwoSettledDays, '2026-09-30')
  expect(stats.quality.missed).toBe(1)
  expect(stats.quality.efficient).toBe(1)
})

it('源事件被删除后仍按 title 快照正常计入，不抛错', () => {
  // 该账本里的 sourceId 指向一个已不存在的 weekEvent.id
  const stats = selectMoneyStats(moneyWithDanglingSourceId, '2026-09-30')
  expect(stats.spentTC).toBeGreaterThan(0)
  expect(Number.isFinite(stats.remainingTC)).toBe(true)
  expect(stats.daily.some((d) => d.spentTC > 0)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: FAIL —— `selectMoneyStats is not a function`

- [ ] **Step 3: 实现**

按当前周（`mondayOf(today)` 起 7 天）过滤 `days`，逐日算 `limit`（用前一日 `overdraft`，无前一日则 0）与 `ratio`；
`limit <= 0` 时 `ratio` 取 0。

**`weekday` 用裸单字，并且由 `shared/money.ts` 自己定义常量** ——
`weekRules.WEEKDAY_NAMES` 是 `['周一', '周二', …]`（带「周」前缀）且住在 `renderer/`，
两个原因都使它不能被 `shared/` 使用。在 `shared/money.ts` 里定义
`const WEEKDAY_LABELS = ['一','二','三','四','五','六','日']`。

`quality` 由条目分类：`!done` → `missed`；
`kind === 'unplanned'` 不计入任何一类；`actualMin <= plannedMin` → `efficient`；
`actualMin > plannedMin * 1.5` → `inefficient`；否则 `normal`。`penaltyTier` 用当前周的实时 `spentTC` 预演。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/money.ts tests/money.test.ts
git commit -m "feat(money): add derived stats selector for widgets"
```

---

### Task 6: 「我的」页骨架、导航改造与金钱开关

**Files:**
- Create: `src/renderer/src/pages/MinePage.tsx`
- Modify: `src/renderer/src/App.tsx:15`, `App.tsx:91-113`
- Modify: `src/renderer/src/state/appStore.ts`（`Page` 类型 + `setMoneyEnabled` action）
- Modify: `src/renderer/src/components/Sidebar.tsx:12-17`, `:148-160`
- Modify: `src/renderer/src/styles/theme.css:2942`, `:2953`（仅注释）与新增样式

**Interfaces:**
- Consumes: `MoneyState`（Task 1）
- Produces: `Page` 类型新增 `'mine'`；`useAppStore` 新增 `setMoneyEnabled(enabled: boolean): void` 与 `rolloverMoneyWeek(): void`

- [ ] **Step 1: 改导航与页面骨架**

`Sidebar.tsx` 的 `NAV` 加入 `{ page: 'mine', label: '我的', icon: User }`（图标从 `lucide-react` 取）；
「外观」按钮的 `className` 由 `nav-item appearance-button` 改为 `nav-item appearance-button desktop-only`。
`App.tsx` 的 `PAGE_ORDER` 加入 `'mine'`，并在 `page === 'mine' && <MinePage />`。
`MinePage.tsx` 先只渲染三个分组标题（金钱 / 设置 / 关于）与金钱开关。

- [ ] **Step 2: 更新两处注释（不改任何尺寸）**

`theme.css:2942` 的「五列：四个页面 + 一个外观设置入口」改为「五列：五个页面（外观入口在手机档隐藏）」；
`:2953` 的「`--nav-index` 只由页面项给出（0~3）」改为 `0~4`。
**`grid-template-columns` 与 `--nav-indicator` 的 width 一个字符都不改。**

- [ ] **Step 3: 实现开关与周滚动两个 action**

`setMoneyEnabled(true)`：若 `data.money` 不存在则写入 `{ enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [] }`，
否则只把 `enabled` 置 true；`setMoneyEnabled(false)`：**只改 `enabled`，绝不动 `days` / `weeks`**。
两种操作都走既有 `saveSoon` 落盘链，并弹出「需要重启生效」的提示。

`rolloverMoneyWeek()`：调用 Task 4 的 `ensureWeekRollover(data.money, todayKey())`，把结果写回 `data.money`。
**仅当 `data.money?.enabled` 为真时执行**，并在 store 的 `init` 与 `applyCloudData` 之后各调用一次 ——
后者是必要的，因为从云端拉下来的数据可能已经跨周。

- [ ] **Step 4: 类型检查**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json`
Expected: 无错误

- [ ] **Step 5: 构建并人工验收**

Run: `./node_modules/.bin/electron-vite build`
Expected: 构建成功。随后启动应用，验收：
桌面端侧栏出现「我的」且点击可达、外观入口仍在、指示块落到「我的」那一格；
窗口缩到 767px 以下（或手机端）时**外观入口消失**、底部 5 格依次为目标/四象限/周计划/周日复盘/我的且标签不折行。

> 若 `out/` 因沙箱批量删除被拦：`python -c "import shutil;[shutil.rmtree(p,ignore_errors=True) for p in ('out/main','out/preload')]"`。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/pages/MinePage.tsx src/renderer/src/App.tsx src/renderer/src/state/appStore.ts src/renderer/src/components/Sidebar.tsx src/renderer/src/styles/theme.css
git commit -m "feat(mine): add Mine page, nav entry and money toggle"
```

---

### Task 7: 六个金钱小组件

**Files:**
- Create: `src/renderer/src/components/mine/WidgetShell.tsx` + `BalanceWidget.tsx` / `WeeklySpendWidget.tsx` / `DailyHeatWidget.tsx` / `NightWidget.tsx` / `QualityWidget.tsx` / `PenaltyWidget.tsx`
- Modify: `src/renderer/src/pages/MinePage.tsx`
- Modify: `src/renderer/src/styles/theme.css`

**Interfaces:**
- Consumes: `selectMoneyStats` 与其返回的 `MoneyStats`（Task 5）
- Produces: 上述 7 个组件，全部只接收 `stats: MoneyStats` 一个 prop

- [ ] **Step 1: 实现 `WidgetShell`**

`WidgetShell({ title, subtitle, span, children })`：一个卡片外壳，桌面跨 `span` 列（hero 传 6，小卡传 3），手机恒为整行。
**不玻璃化** —— 用普通背景色 + `var(--border)`，理由见 spec 12.4。

- [ ] **Step 2: 逐个实现 6 个组件**

| 组件 | 渲染 |
| --- | --- |
| `BalanceWidget` | 两个大数字（`remainingTC` / `remainingLT`）+ 一条 `spentTC / weekTC` 进度条 |
| `WeeklySpendWidget` | 7 根 SVG 矩形柱，高按 `daily[i].spentTC` 归一化；一条水平基准线在 `limit / max` 处；`spentTC > limit` 的柱换警示色 |
| `DailyHeatWidget` | 7 个 SVG 方格，填充色按 `ratio` 分 4 档 |
| `NightWidget` | 一条横向占比条，宽度 = `nightRatio`，旁标 `nightMin` 分钟 |
| `QualityWidget` | 四段堆叠条（`efficient / normal / inefficient / missed`）+ 图例 |
| `PenaltyWidget` | 档位徽标 + 两个百分比（`nextWeekTC / weekTC`、`nextWeekLT / weekLT`） |

全部手写 SVG，**不引入任何图表库**。所有 `<path>` 若是连线必须 `fill="none"`。

- [ ] **Step 3: 接进 `MinePage`**

仅当 `data.money?.enabled` 为真时渲染「金钱」分组；否则整组不出现（不占位、不留空标题）。

- [ ] **Step 4: 类型检查与构建**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json`
Run: `./node_modules/.bin/electron-vite build`
Expected: 均无错误

- [ ] **Step 5: 人工验收**

开启金钱系统并造 3 天账本（含 1 天超限、1 条深夜、1 条未完成），验收：
6 个组件都渲染出非零数据；桌面 2 行栅格（2 hero + 4 小卡）；窄屏单列堆叠且不横向溢出。
关闭开关后**整个金钱分组消失**，页面仍剩设置与关于两组。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/mine/ src/renderer/src/pages/MinePage.tsx src/renderer/src/styles/theme.css
git commit -m "feat(mine): add six money widgets rendered from derived stats"
```

---

### Task 8: 日结卡片与结算面板

**Files:**
- Create: `src/renderer/src/components/money/SettleCard.tsx`, `SettlePanel.tsx`
- Modify: `src/renderer/src/pages/WeeklyPage.tsx`
- Modify: `src/renderer/src/state/appStore.ts`（`settleDay` / `addUnplannedEntry` / `confirmNight`）
- Test: `tests/money.test.ts`（补一条 pending 判定的纯函数测试）

**Interfaces:**
- Consumes: `settleDay`（Task 3）、`money.days`（Task 1）
- Produces:
  - `pendingDays(money: MoneyState, today: string): string[]`（在 `shared/money.ts`，返回待结算日期升序）
  - store action：`commitDaySettlement(date: string, entries: LedgerEntry[]): void` /
    `addUnplannedEntry(date: string, entry: LedgerEntry): void` /
    `confirmNight(previousDate: string, answer: { worked: boolean; endMin?: number }): void`

- [ ] **Step 1: 写失败测试 —— 待结算判定**

```ts
it('待结算 = 早于今天且 settledAt 为 null 的日子，按升序', () => {
  expect(pendingDays(moneyWithMixedDays, '2026-09-30')).toEqual(['2026-09-28', '2026-09-29'])
})

it('今天尚未结束，不计入待结算', () => {
  expect(pendingDays(moneyWithTodayOnly, '2026-09-30')).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: FAIL —— `pendingDays is not a function`

- [ ] **Step 3: 实现 `pendingDays`**

过滤 `days` 中 `settledAt === null` 且 `date < today` 的项，按 `date` 升序返回。今天是本地日期字符串、可直接字典序比较。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 `SettleCard` 与 `SettlePanel`**

`SettleCard`：常驻在周计划页顶部，仅在有 `pendingDays` 时出现，文案「有 N 天待结算」。
`SettlePanel` 按**最早优先**逐日结算，对每一天依次问：
① 计划内事件逐条 —— 做了吗 / 实际多久（预填计划时长）；
② 有没有计划外的事 —— 逐条录入标题、时长、象限；
③ **补记**：若前一日 `nightPending`，附加一问「昨夜 23:30 之后还在做事吗」，
   答「是」则回写前一日并重算其 `spentTC` / `overdraft` / `deltaLT`，把 `nightPending` 置 false。

每条实时显示它产生的 TC 消耗与 LT 变化。这是全代码库唯一允许修改已结算快照的地方，**必须在代码里显式注释说明**。

- [ ] **Step 6: 类型检查与构建**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json`
Run: `./node_modules/.bin/electron-vite build`
Expected: 均无错误

- [ ] **Step 7: 人工验收（含 Review Focus 第 1 条）**

造 3 个连续未结算日（含跨一个周日的），打开应用验收：
卡片出现且显示 N=3；面板按最早优先逐日走完；周计划页与「我的」页的数字随之更新；
跨周的那一天结算后，周结算被触发一次且不重复。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/components/money/ src/renderer/src/pages/WeeklyPage.tsx src/renderer/src/state/appStore.ts src/shared/money.ts tests/money.test.ts
git commit -m "feat(money): add settle card, settle panel and night backfill"
```

---

### Task 9: 象限计费气泡

**Files:**
- Create: `src/renderer/src/components/money/QuadrantCostBubble.tsx`
- Modify: `src/renderer/src/pages/QuadrantPage.tsx`（事件完成路径）

**Interfaces:**
- Consumes: `costOfEntry`（Task 2）
- Produces: `QuadrantCostBubble({ anchor, onConfirm, onCancel })`

- [ ] **Step 1: 实现气泡**

两行内联气泡（**非模态**）：第一行「是否计费」（默认「不计费」），第二行小时数输入（**不预填**，见 spec 13.1 决策 2）。
深夜判定用**当前时刻**是否落在 `[nightStartMin, nightEndMin)`（跨零点区间），实时把倍率结果显示在气泡里。
`onConfirm` 产出一条 `kind: 'planned'`、`quadrant` 取自事件的 `LedgerEntry`，追加进当天的 `days` 记录。

- [ ] **Step 2: 注意 —— 象限事件目前没有「完成」动作**

`QuadrantEvent` 没有 `done` 字段（spec 9.1 的前提）。本任务需要在 `QuadrantPage` 的右键/长按菜单里
新增一个「标记完成」入口，作为气泡的触发点。**不要**给 `QuadrantEvent` 加字段 —— 完成状态只存在于账本里。

- [ ] **Step 3: 确认点击穿透**

气泡挂在 `EventCard` 之上、四象限画布的 `event-layer` 之内，必须 `pointer-events: auto`，
且不得让画布的手势（`useCanvasGestures`）在气泡上继续生效。**先看 `useCanvasGestures` 的 `pointerdown` 处理再动手。**

- [ ] **Step 4: 类型检查与构建**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json`
Run: `./node_modules/.bin/electron-vite build`
Expected: 均无错误

- [ ] **Step 5: 人工验收**

在四象限页触发一次计费：气泡出现、默认不计费、填 2 小时确认后当天账本多一条 20 币的条目；
**在 23:30 之后**（改系统时间或用探针注入）触发一次，确认显示 1.5 倍；
气泡打开时拖动画布不应生效。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/money/QuadrantCostBubble.tsx src/renderer/src/pages/QuadrantPage.tsx
git commit -m "feat(money): add quadrant cost bubble with night multiplier"
```

---

### Task 10: 复盘账本区块、导出追加与关闭态验收

**Files:**
- Create: `src/renderer/src/components/money/WeekLedger.tsx`
- Modify: `src/renderer/src/pages/ReviewPage.tsx`
- Test: `tests/money.test.ts`

**Interfaces:**
- Consumes: `WeekSettlement`（Task 4）
- Produces:
  - `composeReviewText(text: string, week: WeekSettlement | undefined): string`（在 `shared/money.ts`）
  - `WeekLedger({ week })` 组件

**为什么要推翻「改 `reviewDoc.ts` + `platformApi.saveReview` 两处」的原方案**：
`ReviewExport` 的字段是 `{ completion, quality, stress, text }`，**不带 money 数据**。
要让它带上就得再加字段，于是又要牵动 `main/index.ts:40` 的 IPC 契约、`main/review.ts:11`
与 `renderer/lib/platformApi.ts:134` 两个消费点 —— 全是新增同步点。

改为**在 `ReviewPage` 一处把账本摘要拼进 `text`**：导出链一行不改，
「同源」退化成「只有一个调用点」，而关闭态的字节一致**自动成立**
（`composeReviewText(text, undefined)` 必须原样返回 `text`）。这是最简解。

- [ ] **Step 1: 写失败测试**

```ts
it('没有周结算记录时原样返回正文字符串', () => {
  expect(composeReviewText('今天还行', undefined)).toBe('今天还行')
})

it('有关闭开关（账本仍在）但不传周结算时同样原样返回', () => {
  expect(composeReviewText('今天还行', undefined)).toBe('今天还行')
})

it('有周结算时追加一段，且包含关键数字', () => {
  const out = composeReviewText('今天还行', mkSettledWeek({ spent: 420 }))
  expect(out.startsWith('今天还行')).toBe(true)
  expect(out).toContain('420')
  expect(out).toContain('超支')
})

it('空正文也能正常追加，不留前导空行', () => {
  expect(composeReviewText('', mkSettledWeek({ spent: 420 })).startsWith('\n')).toBe(false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: FAIL —— `composeReviewText is not a function`

- [ ] **Step 3: 实现 `composeReviewText`**

内部先把 `WeekSettlement` 渲染成若干文本行（关闭态为 0 行）。
**`week` 为 `undefined` 时必须原样返回 `text`，一个字符都不动** —— 这是关闭态导出逐字节一致的唯一保证点。
有内容时以 `\n\n` 分隔追加；正文为空时不留前导空行。

- [ ] **Step 4: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Expected: PASS

- [ ] **Step 5: 实现 `WeekLedger` 并接进复盘页**

在 `ReviewPage` 的三档滑动条**之上**新增「本周账本」区块（spec 8）。展示 `WeekSettlement` 的
周花费/额度、超支额与档位、计划 vs 实际时长、未完成数、计划外数与时长、深夜总时长、超限天数，以及 `notes`。

- [ ] **Step 6: 在 ReviewPage 接入（唯一调用点）**

`ReviewPage.saveWord`（`:60-68`）在调用 `getPlatformApi().saveReview` 之前，
把 `reviewEdit.text` 换成 `composeReviewText(reviewEdit.text, latestWeek)`。
`latestWeek` 取 `data.money?.weeks.at(-1)`，**且仅当 `data.money?.enabled` 为真时才取**。
**不要在 `reviewDoc.ts` 或 `platformApi.saveReview` 里加任何代码** —— 这是本任务的硬约束。

- [ ] **Step 7: 关闭态字节一致（Review Focus 第 5 条）**

在 `tests/money.test.ts` 追加：对同一份正文，`composeReviewText(text, undefined)` 与
「功能从未启用时」的取值完全相同（即 `toBe(text)`），并用 `Buffer.byteLength` 断言字节数相等。

- [ ] **Step 8: 跑测试确认通过**

Run: `./node_modules/.bin/vitest run tests/money.test.ts`
Run: `./node_modules/.bin/vitest run tests/reviewDoc.test.ts`
Expected: 全部 PASS —— 后者全绿正是「导出链未被改动」的证据

- [ ] **Step 9: 全量回归**

```bash
# 逐文件跑，不要合并成多路径（会触发沙箱 EPERM）
for f in tests/*.test.ts; do ./node_modules/.bin/vitest run "$f" || echo "FAILED: $f"; done
```
Expected: 全绿。**基线请现场取，不要用历史数字** —— 执行本任务前逐文件合计应为
`money 170 / dataCodec 28 / platformApi 25 / syncMeta 18 / gestures 27 / weekRules 20` 等，
总数以你实际跑出来的为准（早期版本写的「基线 204」是第一轮开工前的数字，早已过时）。

- [ ] **Step 10: 提交**

```bash
git add src/renderer/src/components/money/WeekLedger.tsx src/renderer/src/pages/ReviewPage.tsx src/shared/money.ts tests/
git commit -m "feat(money): add week ledger block and byte-identical export when disabled"
```

> ⚠️ **注意**：上面**不含** `src/main/reviewDoc.ts` 与 `src/renderer/src/lib/platformApi.ts` ——
> Step 6 已明确禁止改这两个文件。早期版本的计划把它们列进 `git add` 是 R4 裁定之前的残留。

---

### Task 11: 关闭态与完整性终检

**Files:**
- 无新增；本任务是验收任务，产出是一份可复现的检查记录

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 无

- [ ] **Step 1: 类型检查与生产构建**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.web.json`
Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.node.json`
Run: `./node_modules/.bin/electron-vite build`
Run: `./node_modules/.bin/vite build --config vite.web.config.ts`
Expected: 全部无错误

- [ ] **Step 2: 完整性体检**

Run: `node scripts/verify-integrity.mjs`
Expected: 无 FAIL；「模型同步」组不出现 `money` 相关的 WARN

- [ ] **Step 3: 造一份「仅有钱账本」的数据，确认不被判为空（Review Focus 第 2 条相关）**

用 `--appdata` 指向临时目录，写入 `{...四类实体全空, money: { enabled: true, days: [一条已结算日], weeks: [] }}`；
断言 `isEmptyData` 为 `false`（防止该用户的云端数据被当作「空数据」而拒绝上传）。

- [ ] **Step 4: 关闭态全链路验收**

把 `enabled` 置 false 后重启应用，逐条核对 spec 4.3：
待结算卡片不出现、复盘账本区块不渲染、象限不弹气泡、周结算不跑、
「我的」页的金钱分组消失、**账面数据仍在**（再开启后数字不变）、复盘导出与改动前逐字节一致。

- [ ] **Step 5: 探针复核两处布局（只读代码发现不了）**

用 `scripts/liquid-glass-probe.mjs` 的场景框架或新写一个薄探针，断言：
① 手机档 5 格标签均不折行、指示块能滑到第 5 格、`--mobile-nav-height` 仍为 66px；
② 桌面档 `.sidebar` 在 640px 高时底部（云同步按钮 + 寄语）未被挤压或溢出。

- [ ] **Step 6: 汇总检查记录**

把 Step 1–5 的实际输出与预期逐条对照，记录任何不符。**没有验证过的项不得写成「通过」。**

---

## Self-Review

**Spec 覆盖**

| Spec 节 | 覆盖任务 |
| --- | --- |
| 4 开关机制（含 4.3 四条边界） | Task 1（存储）、Task 6（挂载与开关）、Task 10（导出字节一致）、Task 11（终检） |
| 5 数据模型 | Task 1 |
| 6.1 两种货币 / 6.2 三层约束 | Task 2、Task 3 |
| 6.3 计费规则 / 深夜倍率 | Task 2、Task 9 |
| 6.4 娱币规则 | Task 2 |
| 6.5 周结算与档位 | Task 4 |
| 7.1–7.3 日结交互与深夜补记 | Task 8 |
| 7.4 象限气泡 | Task 9 |
| 7.5 周结算触发 | Task 4（`ensureWeekRollover`） |
| 8 复盘汇入 | Task 10 |
| 9.1 五个同步点 | Task 1 |
| 10 测试策略 | 各任务的 Step 1 |
| 11 参数默认值 | Global Constraints + Task 2 |
| 12 我的页与小组件 | Task 6、Task 7 |
| 13 决策记录 | Task 9（不预填）、Task 6（不做重启按钮） |

**类型一致性核对**：`MoneyConfig` / `MoneyState` / `LedgerDay` / `LedgerEntry` / `WeekSettlement` 定义在 Task 1，
Task 2–5、8、10 引用的字段名与之一致；`MoneyStats` 定义在 Task 5，Task 7 只读消费；
跨任务函数名逐一核对无别名（`dayLimitOf` / `settleDay` / `settleWeek` / `ensureWeekRollover` /
`currentQuota` / `selectMoneyStats` / `pendingDays` / `moneySummaryLines`）。

**Review Focus 逐条落点**（每条都钉在某个任务的测试里，不是只写在文档里）

| Review Focus 条目 | 钉在哪个任务的测试 |
| --- | --- |
| 1 跨周未结算 | Task 4 Step 1 的 `跨周滚动：缺失的周按空周处理` |
| 2 源事件已被删除 | Task 5 Step 1 的 `源事件被删除后仍按 title 快照正常计入` |
| 3 `plannedMin` 为 `null` 或 `0` | Task 2 Step 1 的 `plannedMin 为 null 或 0 时返回 0，不产生 NaN` |
| 4 恰好在 23:30 结束 | Task 2 Step 1 的 `nightMinutesOf：区间左闭右开` |
| 5 `enabled: false` 但账本仍在 | Task 10 Step 7 的逐字节相等断言 |

**写计划时发现并已inline修正的两处设计缺陷**（spec 已同步改）：
① `LedgerEntry.lateNight: boolean` 无法表达「部分分钟落在深夜」，改为 `nightMin: number`，
并新增 `nightMinutesOf` —— 否则 spec 6.3 要求的「只对越界分钟数乘倍率」根本实现不了；
② `shared/money.ts` 需要 `mondayOf`，但该函数住在 `renderer/lib/weekRules.ts`，
`shared/` 反向依赖 `renderer/` 是错误方向 ⇒ 见下方架构修正。

**一处需要执行者注意的架构修正**：Task 4 的 Step 3 把 `mondayOf` / `addDays` / `dateKey` 从
`renderer/lib/weekRules.ts` 下沉到 `shared/dateKey.ts`。这是为了让 `shared/money.ts` 不反向依赖 `renderer/`。
该步骤用 `tests/weekRules.test.ts` 原样全绿作为回归保证 —— **这是硬性验收条件，不是可选项。**

---

# R2 任务集（2026-09-30 修订）

**Spec：** `docs/superpowers/specs/2026-09-30-money-system-r2.md`（本文的 R2 部分以它为唯一权威）

## R2 执行前状态

- Task 1–8 已实现并复审通过，分支 `feat/money-system`，HEAD `81a7487`，全量逐文件 **288 通过**。
- R2 的改动**推翻一部分已实现的公式**，因此下面 5 个任务标 **[修正]**、5 个标 **[新增]**。
- ✅ **R2 spec §9.1 的两处语义已定**（逾期扣款 = 80 全额、娱币不动；象限倍率
  Q1 1.5 / Q2 1.0 / Q3 1.2 / Q4 0.5，权重取向「紧急 > 重要」）。
- ⚠️ 仅剩 §9.2 的**休息日基数**未定 —— **只有 R2-E 被它阻塞**；R2-A ~ R2-D、R2-F ~ R2-J 均可开工。

## R2 的 Global Constraints（在主计划之上追加）

- `dailyCapTC` 是**独立配置项**，任何地方**不得**再用 `weeklyTC / 7` 当日上限。
  `560 / 7 = 80` 目前恰好相等，但**仍然不得派生** —— 派生会让「调周总额」静默改掉「日上限」，
  而这两个数是用户分开想的。R2-A 的测试必须钉住这一点（改 `weeklyTC` 不得影响 `dayLimitOf`）。
- 深夜倍率与象限倍率**相乘**，且深夜倍率仍只作用于落在 `[23:30, 06:00)` 内的分钟数。
- 娱币的「刷视频 / 打游戏」两条**只扣娱币、不产生时币消耗**，且**不进** `quality` 四分类。
- 日超限只侵蚀次日额度；**只有周超限才罚下一周**（用户裁定第一条，与已实现一致，不得改）。
- 新增持久化字段仍必须同步 **5 个文件**：`shared/types.ts`、`main/dataCodec.ts`（`normalizeMoney`）、
  `renderer/lib/platformApi.ts`（`validMoney`）、`shared/defaults.ts`、
  `scripts/verify-integrity.mjs`（内含 `validAppData` 与 `firstViolation` **两处**复刻）。
- 写 money 必须写**完整** `MoneyState`（四个顶层字段 + `config` 全键），否则网页端会静默清空用户全部数据。
- `data.money.config` 目前以**引用**持有 `DEFAULT_MONEY_CONFIG`，携带时必须 spread。

---

### Task R2-A: 数值定标与 `dailyCapTC` 独立化 ［修正］

**Files:**
- Modify: `src/shared/types.ts`（`MoneyConfig` + 新类型）
- Modify: `src/shared/money.ts`（`DEFAULT_MONEY_CONFIG`、`dayLimitOf`、`settleWeek`）
- Modify: `src/main/dataCodec.ts`、`src/renderer/src/lib/platformApi.ts`、`scripts/verify-integrity.mjs`（两处复刻）
- Test: `tests/money.test.ts`、`tests/dataCodec.test.ts`、`tests/platformApi.test.ts`

**Interfaces:**
- Produces: `MoneyConfig` 新增字段
  `dailyCapTC: 80`、`videoLTPerHour: 1`、`gameLTPerHour: 1.5`、`restDayFactor: 0.8`、
  `abandonedDayTC: 80`、`latePhoneTC: number`、`latePhoneLT: number`、
  `quadrantMultiplier: { q1: number; q2: number; q3: number; q4: number }`
- 改值：`weeklyTC: 560`、`weeklyLT: 20`

- [ ] Step 1: 写失败测试 —— `dayLimitOf(0, config)` 用 `dailyCapTC` 而非 `weeklyTC / 7`。
      断言 `dayLimitOf(0, DEFAULT_MONEY_CONFIG) === 80`；**并且**把 `weeklyTC` 改成 999 后该值**仍为 80**
      （第二条才是真正的判别器 —— 因为 `560 / 7` 恰好也是 80，只断言 80 区分不出派生与直读）。
- [ ] Step 2: 跑测试确认失败（改动前 `weeklyTC = 350`，当前返回 50）
- [ ] Step 3: 改 `dayLimitOf` 与 `settleWeek` 的 `daySoftCap` 为 `config.dailyCapTC`；保底 = `dailyCapTC × minCapRatio` = 16
- [ ] Step 4: 跑测试确认通过
- [ ] Step 5: 同步 5 个文件的字段集（新增 8 个键），并补 `normalizeMoney` 的逐键回退
- [ ] Step 6: 跑 `tests/money.test.ts` / `tests/dataCodec.test.ts` / `tests/platformApi.test.ts` 三个文件
- [ ] Step 7: `node scripts/verify-integrity.mjs --appdata tmp/vi-probe` 确认无 `money` 相关 FAIL/WARN
- [ ] Step 8: 提交

---

### Task R2-B: 象限倍率接入计费 ［修正］

**Files:**
- Modify: `src/shared/money.ts`（`costOfEntry` 及其调用点）
- Modify: `src/renderer/src/state/appStore.ts`、`src/renderer/src/components/money/SettlePanel.tsx`（见 Step 3）
- Test: `tests/money.test.ts`

**Interfaces:**
- 改签名：`costOfEntry(input: { actualMin: number; nightMin: number; quadrant: Quadrant | null }, config: MoneyConfig): number`
  （`null` = 中性 1.0，**必须与 `q2` 分成两个分支**）
- 公式：`round(((dayMin + nightMin × nightMultiplier) / 60 × tcPerHour) × quadrantMultiplier[`q${quadrant}`])`

- [ ] Step 1: 写失败测试 —— 同样 120 分钟 0 深夜，Q1 得 30（20×1.5）、Q3 得 24（20×1.2）、
      Q2 得 20（20×1.0）、Q4 得 10（20×0.5）；
      并加一条「深夜 + Q1 相乘」的用例（120 分钟全深夜、Q1 ⇒ `round((120×1.5/60×10)×1.5)` = 45）
- [ ] Step 2: 跑测试确认失败
- [ ] Step 3: 实现并把**全部 5 个调用点**一并改掉
      （**漏改任一处就会出现两套口径**，这正是 T4/T5 两轮返工的成因）：
      `money.ts` 的 `settleDay` 与 `selectMoneyStats`（两个 shared 派生口径）、
      `appStore.ts` 的 `carriedOverdraft` 与 `buildNightEntry`、`SettlePanel.tsx` 的 `rowCost`。
      ⚠️ **不可把 `quadrant` 设成可选参数来回避改调用点** —— 那样漏改的点会静默编译通过，
      并在渲染层算出「同一个事件的第二个价格」，正是本任务要消灭的缺陷。
      （R2-B 实测：设为必填后 `tsc -p tsconfig.web.json` 直接报错，强制暴露全部调用点。）
      ⚠️ **计划原文误写为「恰好两个调用点」，实测为 5 个** —— 这是 R2-B 复审独立核实的结果。
- [ ] Step 4: 跑测试确认通过
- [ ] Step 5: 提交

---

### Task R2-C: 娱币的两条纯消费来源 ［新增］

**Files:**
- Modify: `src/shared/types.ts`（`LedgerDay` 加 `videoMin: number`、`gameMin: number`）
- Modify: `src/shared/money.ts`（新函数 `consumptionDeltaLT`；`settleDay` 计入 `deltaLT`）
- Modify: 5 个同步点
- Test: `tests/money.test.ts`

**Interfaces:**
- Produces: `consumptionDeltaLT(input: { videoMin: number; gameMin: number }, config: MoneyConfig): number`
  = `−(videoMin / 60 × videoLTPerHour) − (gameMin / 60 × gameLTPerHour)`

- [ ] Step 1: 写失败测试 —— 刷视频 60 分钟 → `−1`；打游戏 120 分钟 → `−3`；两者合计 → `−4`
- [ ] Step 2/3/4: TDD 循环
- [ ] Step 5: 断言这两项**不进** `quality`、且**不改变** `spentTC`
- [ ] Step 6: 同步 5 个文件；逐文件跑三个测试文件
- [ ] Step 7: 提交

---

### Task R2-D: 日结窗口 7 天、逾期满额、不可重结 ［修正］

**Files:**
- Modify: `src/shared/money.ts`（`ensureLedgerDays`、`pendingDays`、新 `abandonDays`）
- Modify: `src/renderer/src/state/appStore.ts`（开机物化改为全窗口）
- Test: `tests/money.test.ts`

**Interfaces:**
- `ensureLedgerDays` 改为对 `[today − 7, today)` 的**每一天**建未结算空记录（不再要求 `plannedDates`）
- 新纯函数 `abandonExpiredDays(money, today): MoneyState` —— 把早于 `today − 7` 的未结算日
  按 `abandonedDayTC` 全额落账（`spentTC = abandonedDayTC`、`deltaLT` 不变）、`settledAt` 置为到期日

- [ ] Step 1: 写失败测试 —— 8 天前的一天被 `abandonExpiredDays` 落成 `spentTC === 80`、`deltaLT === 0`
- [ ] Step 2/3/4: TDD 循环
- [ ] Step 5: **不可重结**：已有测试覆盖 `commitDaySettlement` 的守卫；补一条断言「已结算日在两次开机后
      数字逐字节不变」（针对「往日时间轴被修改」）
- [ ] Step 6: 逐文件跑测试；提交

---

### Task R2-E: 无计划之日的两条分支（休息日 / 补计划） ［新增］

**Files:**
- Modify: `src/shared/types.ts`（`LedgerDay` 加 `isRestDay: boolean`）
- Modify: `src/shared/money.ts`（新纯函数 `restDayCost`；`settleDay` 支持休息日）
- Modify: 5 个同步点（含 `verify-integrity.mjs` 的两处复刻）
- Modify: `src/renderer/src/components/money/SettlePanel.tsx`（分支入口）
- Modify: `src/renderer/src/pages/WeeklyPage.tsx` + `components/weekly/DayView.tsx`（补计划路径 + 右上角「完成」）
- Test: `tests/money.test.ts`

**Interfaces:**
- Produces:
  - `restDayCost(config: MoneyConfig): number` = `Math.round(config.dailyCapTC × config.restDayFactor)` = **64**
  - `LedgerDay.isRestDay: boolean`（默认 `false`）
  - 休息日结算结果：`spentTC = 64`、`deltaLT = 0`、`entries = []`、`settledAt` 正常写入

**流程（spec R2 §4.3）**

```
无计划日 → 面板先给两条路
  (A) 休息日 → 固定扣 64，结算完成
  (B) 不休息 → 跳该日时间轴 → 右上角「完成」→ 进正常日结页（允许一个块都不放）
```

- [ ] Step 1: 写失败测试 —— 休息日结算得 `spentTC === 64` 且 `deltaLT === 0`；
      同一份输入在 `isRestDay === false` 时得 `spentTC === 0`（对照组，防实现把休息日当成默认）
- [ ] Step 2/3/4: TDD 循环
- [ ] Step 5: **只在无计划之日提供**该选项 —— 面板按「该日是否已有计划事件」决定是否显示入口，
      并加一条断言：有计划的日子的结算数据里不得出现休息日产物
- [ ] Step 6: 实现 (B) 分支的跳转与回程（该日日视图 ⇄ 日结页），「完成」按钮放**右上角**（用户指定位置）；
      **一个事件块都不放**也必须能直接完成并进入日结页（这是必需的兜底，否则计划外的事无处记录）
- [ ] Step 7: 同步 5 个文件；逐文件跑 `tests/money.test.ts` / `tests/dataCodec.test.ts` / `tests/platformApi.test.ts`
- [ ] Step 8: type check + build；隔离 userData 的人工验收，**三条路径都走一遍**
      （休息日 / 放块后完成 / 不放块直接完成），确认真实 `%APPDATA%\象限\plan.json` 未被触碰
- [ ] Step 9: 提交

---

### Task R2-F: 深夜刷手机的次日连带扣款 ［新增，**阻塞于 §9 裁定**］

**Files:**
- Modify: `src/shared/types.ts`（`LedgerDay` 加 `latePhone: boolean`）
- Modify: `src/shared/money.ts`（次日扣款逻辑）
- Modify: 5 个同步点；日结面板加一问
- Test: `tests/money.test.ts`

- [ ] Step 1: 写失败测试 —— 在 D 日答「有」⇒ **D+1** 的 `spentTC` 增加 `latePhoneTC`、`deltaLT` 减少 `latePhoneLT`；
      D 日本身不变（用户明确要求扣**次日**）
- [ ] Step 2–6: TDD + 同步 + 提交

---

### Task R2-G: 两种货币的小图标 ［新增］

**Files:**
- Create: `src/renderer/src/components/money/MoneyIcon.tsx`（`{ kind: 'tc' | 'lt'; size?: number }`，手写 SVG）
- Modify: 余额卡、日结面板、条目行

- [ ] Step 1: 实现两枚 SVG 图标，沿用 `theme.css` 的 `currentColor`，尺寸可传
- [ ] Step 2: 接入余额卡与日结面板；type check + build
- [ ] Step 3: 人工验收（两种尺寸下均清晰、不模糊）；提交

---

### Task R2-H: 日视图事件块显示价值 ［新增］

**Files:**
- Modify: `src/renderer/src/components/weekly/EventBlock.tsx`、`DayView.tsx`
- Test: 无（组件层）；依赖 `costOfEntry` 的纯函数测试已存在

- [ ] Step 1: 在日视图的每个事件块上显示它将要花费的时币数（用 `costOfEntry` 算，**不要另写公式**）
- [ ] Step 2: 确认周视图（`WeekOverview`）**不**显示 —— 用户说的是「周计划的子页面」，即日视图
- [ ] Step 3: type check + build + 人工验收（块高度是否被撑开、窄屏是否溢出）
- [ ] Step 4: 提交

---

### Task R2-I: 「我的」页荧光折线趋势图 ［新增］

**Files:**
- Modify: `src/renderer/src/components/mine/*`（重做图表；`selectMoneyStats` 可能要补趋势数据）
- Modify: `src/renderer/src/styles/theme.css`

- [ ] Step 1: 用手写 SVG 画两条趋势折线（时币一条、娱币一条），蓝色荧光 + 淡粉色荧光
- [ ] Step 2: 荧光用 SVG `filter: drop-shadow` 或双层描边实现，**不引入任何依赖**
- [ ] Step 3: 桌面 12 列 / 手机单列布局复核；`prefers-reduced-motion` 下不做动画
- [ ] Step 4: type check + build + 人工验收（两种主题下均清晰、荧光不过曝）
- [ ] Step 5: 提交

---

### Task R2-J: 日结面板三问集成与回归 ［新增］

**Files:**
- Modify: `src/renderer/src/components/money/SettlePanel.tsx`
- Modify: `tests/money.test.ts`（纯函数部分已在 R2-C/F 覆盖）

- [ ] Step 1: 面板并列问出：① 刷视频时长 ② 打游戏时长 ③ 昨夜 24:00 后是否刷手机
      （与既有的「昨夜 23:30 之后还在做事吗」**并存**，两者语义不同，见 R2 spec §6）
- [ ] Step 2: 每条实时显示它将产生的 LT / TC 变化，口径必须调用既有纯函数，不得在组件里重算
- [ ] Step 3: 逐文件跑全量；`electron-vite build`；隔离 userData 的人工验收
- [ ] Step 4: **关闭态回归**：`money.enabled === false` 时这些新问题一律不出现
- [ ] Step 5: 提交

---

## R2 的执行顺序与依赖

```
R2-A（配置） ──┬─→ R2-B（象限倍率）
               ├─→ R2-C（娱币消费来源）
               ├─→ R2-D（7 天窗口）
               ├─→ R2-E（无计划日两分支：休息日 / 补计划）
               └─→ R2-F（深夜刷手机）
R2-G / R2-H / R2-I / R2-J 见上表各自依赖
```

**三处语义已全部裁定完毕（R2 spec §9），无阻塞项。**

**R2-A 必须先做**：它改了 `MoneyConfig` 的形状，其余任务的测试都会引用新键。

## R2 的收尾待办（2026-10-02 更新）

1. ✅ **已完成** —— 修正主计划里「组件顺序」的自相矛盾。更正的是 **spec**
   `2026-09-29-money-system-design.md` §12.3/§12.4：原表把「惩罚预告」排在最后，同段正文却说
   「最重要的余额与惩罚预告在前」。已按**实际渲染顺序**（以 `MinePage.tsx` 为真源：两个 hero 在前、
   四个小卡在后）重写表格，并顺带把 R2 替换掉的组件 3/4（柱状图 → 时币趋势、热力格 → 娱币趋势）写进表里。
2. ✅ **已完成** —— 更新 `AGENTS.md` 维护点说明，把 `money` 字段纳入；并按这几轮的实测订正了
   三处过时内容：同步清单从「3 个文件」更正为**5 个**；澄清脚本里的子校验器**不是两份**而是
   被两条路径引用；补充 `money` 的**三档降级**契约。
3. ✅ **已完成** —— R3-A 顺带修掉了 `src/renderer/probe/main.tsx` 的 `PAGES` 缺 `mine`
   （改前 `?page=mine` 会静默回退到四象限页）。
4. ⏳ **待用户定夺** —— 平板档 768–1023px 是否补断点。**我的建议：本期不补。** 理由：
   ① 整分支终审已把这项分流为「可发版」；② 补断点是一个**产品外观决策**（三档该怎么排需要你来定），
   不是技术缺陷；③ 本项目有断点相关返工史。**要补的话请说明平板档期望的排布**，我再写任务。

---

### Task R2-K: 手机端底部 dock 的液态玻璃 —— **验证优先，必要时修** ［新增］

**先读：这个玻璃层已经存在，不是待做项。**

| 证据 | 位置 |
| --- | --- |
| 渲染材质层 | `Sidebar.tsx:112-117` —— `<GlassSurface contentClassName="gs-dock-plate" layerClassName="gs-layer--dock" />` |
| 桌面端关闭 | `glass.css:670-672` —— `.gs-layer--dock { display: none }`（桌面 `.sidebar` 身后没有内容可糊） |
| 手机档启用 | `glass.css:674-705` —— `@media (max-width: 767px)` 下 `position: absolute; inset: 0`，材质板 `calc(100vw - 40px) × 56px` |

所以本任务**不是从零实现**，而是三步：

1. **先验证它此刻是否真的生效** —— **存在 ≠ 生效**。用唯一可信口径（见下）。
2. 不达标就修；达标就只记录结论。
3. 无论结果如何，把「手机 dock 玻璃是否活着」这件事**变成可复现的结论**，而不是靠读代码推断。

#### 唯一可信的验证口径

- 条纹插在 dock **之前的页面侧**（dock 身后是时间轴画布，有内容可糊）。
- 同状态抓「材质开 / 材质关」两张，算 **保留率 = `std(开) / std(关)`**。
- **≈0.66 正好 = 1 − 染色 0.34 ⇒ 只剩染色（死）；≤0.2 才算活。**
- 只用**页面级** `page.screenshot({clip})`；元素级截图会把一切判成穿透。
- 采样盒必须**躲开导航文字**。
- 手机档必须把 `forceEngine` 设成 **`fallback`** 再验（键 `quadrant-glass-v1`）。

#### ⚠️ 一处**必须靠实测解决的自相矛盾**（不要靠推理）

本项目既有的规则是「**从材质板往上到 body 的整条祖先链上不能有合成面**（`fixed` / `sticky` /
非 auto 的 `z-index`），任一出现材质就只剩染色」。
而 dock 的材质板挂在 `.sidebar` 之下，**`.sidebar` 在手机档本身就是 `position: fixed`**（见
`glass.css:675` 的注释），且 `glass.css:681-685` 又专门为 dock 调过 `--gs-z`，说「0 与 50 同病，
都会让 dock 的磨砂采不到背景」。

⇒ **两条线索冲突**：按规则，`.sidebar` 是 `fixed` ⇒ 材质应当已死；但代码注释显示他们当时确实处理过
dock 的采样问题、且把它当作活着的在调。**不要用推理下结论，用保留率量。** 这正是本任务存在的理由。

#### 若验证结论是「已死」，可行的修法方向（按代价排序）

1. 确认 `.gs-layer--dock` 的 `--gs-z` 取值与 `.sidebar` 的 stacking context 关系（先量再改）。
2. 若确实是 `fixed` 祖先导致，需把材质板改为**不与 `.sidebar` 共享 stacking context** 的挂载方式 ——
   代价高，且会动到手机 dock 的既有几何（`--mobile-nav-height: 66px`、五等分栅格、
   `glass.css` 的 `.gs-dock-plate` 56px 严格对应），**动之前必须单独评估**。
3. 若结论是「本来就活着」，本任务只产出结论 + 一张开/关对比图，**不改任何代码**。

#### Files / Test

- 视结论而定；预期改动面仅限 `glass.css` / `theme.css`。**不要为了「看起来更玻璃」而改几何常量** ——
  dock 的高度、圆角、五等分栅格都有其他代码依赖（`--mobile-nav-height` 与 `.gs-dock-plate` 的 56px 是一对，
  改一处必须改另一处）。
- 无单测；证据是**保留率实测数字 + 开/关对比截图**。
- 若确实要改代码，改完必须**重跑一次保留率**，并与改动前的数字并列记录。

#### 明确不在本任务范围内

- 桌面端侧栏的玻璃（那里身后没有内容，已被有意关闭，理由是 `Sidebar.tsx:106-107` 写明的）。
- 把「我的」页的小组件卡片玻璃化（spec §12.4 已裁定不做）。
- 日结面板的玻璃（高频浮层，`shader` 档每开一层卡主线程约 1.3 秒，spec §10.2 已裁定倾向不做）。

---

# 第三阶段：设置区整合（2026-10-02 追加）

**为什么做在本分支上**：这三件事都落在本分支刚改过的两处 —— 五页导航（`Sidebar.tsx`）与
「我的」页（`MinePage.tsx`）。换到 `main` 上做会与这两处的改动直接冲突，且「我的」页本身就是本分支的产物。
因此继续在 `feat/money-system` 上推进，合并时机不变（做完整批一起合）。

## 三个阶段的关系

- 第一轮 Task 1–11 + R2-A…R2-J：金钱系统（已完成，两轮终审 clean）。
- **第三阶段 R3-A…R3-C：与金钱无关的设置区整理**（本批）。

## R3 的 Global Constraints

- **不新增任何 npm 依赖。**
- **测试逐文件跑**；本批以人工验收为主（项目无 React 组件测试设施）。
- 不要用 `npm run <script>`，直接调 `./node_modules/.bin/<bin>`。CI 锁 **Node 20**。
- **不得破坏导航几何**：`.nav` 是五等分 grid，指示块宽 `calc((100% - 8px) / 5)`，
  `--mobile-nav-height` 与 `glass.css` 的 `.gs-dock-plate` 56px 是一对。**动任何一处必须同时核另一处。**
- **关闭态零副作用**（spec 4.3）在本批同样适用：这里改的是侧栏与「我的」页，与金钱无关，
  但仍不得让 `money.enabled !== true` 时的既有行为发生任何变化。

---

### Task R3-A: 把「外观」入口整合进「我的」的设置组 ［新增］

**现状**（先读，别猜）：
- `Sidebar.tsx:162` 有一个 `className="nav-item appearance-button desktop-only"` 的按钮，
  点击 `setAppearanceOpen(true)` 打开 `GlassSettingsDialog`。
- 它的注释（`Sidebar.tsx:150-161`）写明「**手机档整条隐藏**（desktop-only）」，
  理由是「dock 是五等分 grid，五格已被五个页面占满」「外观设置需要宽屏才能预览」。

**要做的**：
1. 把「外观」从侧栏**移除**，改为在「我的」页的**设置组**里给一个入口，打开同一个 `GlassSettingsDialog`。
2. `GlassSettingsDialog` 的挂载与开关状态一并迁走（现在住在 `Sidebar` 里）。
3. 侧栏的 `appearance-button` 与它专用的 `desktop-only` 用法**一并删除** ——
   删掉之后**桌面与手机的导航项数完全相同（都是 5 个页面）**，这是本任务的附带收益。

**⚠️ 一处必须由我裁定、不得自行决定的取舍**：**手机档现在要不要有外观入口？**

原设计把它从手机档藏起来，理由是「需要宽屏才能预览」。但那条理由针对的是**dock 的五格栅格**，
而不是「手机上无法渲染设置对话框」。既然它进了「我的」的设置组、不再占 dock 的格子，
**裁定：两个档位都显示**（手机档从此第一次有了外观设置）。代价：需要在窄屏实测对话框本身可用
（不是「好看」，是**可用** —— 能滚动、能点到每一项、能关掉）。若实测发现它在窄屏根本不可用，
**不要擅自把它重新藏起来**，把证据带回来，我再裁。

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`（移除按钮 + 迁移对话框挂载）
- Modify: `src/renderer/src/pages/MinePage.tsx`（设置组加入口）
- Modify: `src/renderer/src/styles/theme.css`（若 `.appearance-button` 有专属规则则一并清理）
- Test: 无（组件层）；证据是人工验收

- [ ] Step 1: 迁移 `GlassSettingsDialog` 的挂载与开关状态到 `MinePage`（或上提到共同祖先，二者择一并在报告里说明理由）
- [ ] Step 2: 「我的」设置组加入口；侧栏移除按钮
- [ ] Step 3: 清理变成死代码的 CSS 类
- [ ] Step 4: 核验导航几何**未被破坏**：桌面与手机都恰好 5 个页面项、指示块能滑到第 5 格、
      手机 dock 不折行、`--mobile-nav-height` 仍 66px
- [ ] Step 5: 人工验收：桌面与手机**两个档位**都能从「我的」打开外观对话框并正常关闭；
      窄屏下对话框可用（如实记录哪一项点不到就写哪一项）
- [ ] Step 6: 提交

---

### Task R3-B: 桌面端云同步可切手动 / 自动 ［新增］

**现状**（先读，别猜）：
- `Sidebar.tsx:168-187` 是**桌面专属**的两个手动按钮：`上传到云端`（push）/ `从云端恢复`（pull），
  未登录时显示单个「登录云端」。
- `appStore` 有 `syncOnResume`，但在桌面端**提前 return**；`App.tsx` 的定时/可见性对账是**网页端专有**
  （`isDesktopRuntime` 门）。⇒ **网页端本来就是自动的，桌面端只有手动。**

**要做的**：给桌面端一个**手动 / 自动**开关（网页端的行为不变），默认沿用现状（手动）。

**⚠️ 这是本批唯一有数据风险的任务，必须先想清楚再动手。** 自动同步意味着**在没有用户确认的情况下**
拉取云端数据，而本项目的云端合入逻辑里有「本地为空则采纳云端」「覆盖保护」等分支
（`syncMeta.adopt-cloud` / `appStore` 的覆盖保护）。**开自动之前必须先答这三个问题**，并写进报告：

1. **自动同步的触发时机是什么？**（定时轮询 / 窗口重新可见 / 本地有未推送改动时 / 以上组合）
   —— 选一种并说明为什么，不要全上。
2. **自动拉取会不会覆盖本地尚未推送的改动？** 现有保护是否足够？**给出你会怎么验证这一点。**
3. **冲突时谁赢？** 明确的规则，不要「看情况」。

**设置存哪里**：优先放进已有的 `SyncMeta`（它已经是同步专用状态，且已有 `defaultSyncMeta` 与测试），
**不要**塞进 `AppData`。动手前先确认 `SyncMeta` 是否有校验器同步点 —— **有就一并改，没有就在报告里说明**。

**Files:**
- Modify: `src/shared/types.ts`（`SyncMeta` 加模式字段，若走这条路）
- Modify: `src/shared/defaults.ts`、`src/renderer/src/lib/syncMeta.ts`（默认值与判定）
- Modify: `src/renderer/src/state/appStore.ts`、`src/renderer/src/App.tsx`（自动路径接通桌面端）
- Modify: `src/renderer/src/pages/MinePage.tsx`（开关 UI，放设置组）
- Modify: `src/renderer/src/components/Sidebar.tsx`（手动模式下的按钮呈现）
- Test: `tests/syncMeta.test.ts`（判定逻辑是纯函数，要测）

- [ ] Step 1: **先回答上面三个问题并写进报告**，再写代码
- [ ] Step 2: 纯逻辑 TDD（判定「此刻该不该自动同步」的函数）
- [ ] Step 3: 接通桌面端的自动路径
- [ ] Step 4: 「我的」设置组加开关；默认**手动**（不改变现状）
- [ ] Step 5: 逐文件跑测试 + type check + build
- [ ] Step 6: 隔离 userData 的人工验收，**重点验数据安全**：自动模式下本地有未推送改动时，
      云端拉取不得静默覆盖；切换开关不得丢数据
- [ ] Step 7: 提交

---

### Task R3-C: 手动两个按钮的间距 ［新增，**可先做**］

> ⚠️ **更正**：初稿把本任务标为「依赖 R3-B」，**那是错的** —— 那两个手动按钮**现在就是常态可见的**
> （手动就是当前行为），所以间距可以直接调，不必等 R3-B 引入模式开关。**先做 R3-C、最后做 R3-B**
> 反而更好：等 R3-B 去条件显隐时，间距已经是对的。

**现状**：两个手动按钮用的是和导航项同一个 `nav-item` 类，因此继承导航的间距 —— 在一列五个页面项
下面挂两个功能按钮，间距显得过大。

**要做的**：把这两个按钮的**相互间距**调到合适。**「合适」不由你拍** —— 先量出当前值，
再给出你选的数值和依据（与导航项的间距对比、与下方寄语/同步消息的间距对比），改完实测。

**不要碰导航项的间距**（那会影响五等分布局与指示块），只动这两个按钮之间的关系。

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` / `src/renderer/src/styles/theme.css`
- Test: 无；证据是间距实测值 + 截图

- [ ] Step 1: 量出当前两按钮之间的间距，记下数值
- [ ] Step 2: 调到合适值（说明依据），确认不影响导航项与指示块
- [ ] Step 3: 人工验收：桌面 640px 高时底部（两按钮 + 寄语/同步消息）不挤压、不溢出
- [ ] Step 4: 提交

---

## R3 的执行顺序（2026-10-02 更正）

```
R3-A（外观迁进「我的」）  ── 独立，可先做          ✅ 已完成
R3-C（手动两按钮间距）    ── 独立，可先做          ← 下一步
R3-B（云同步手动/自动）    ── 数据风险最高，用户指定放最后
```

**用户指定的顺序：R3-B 放最后，其余全部做完再动它。**

---

### Task R3-D: 象限计费气泡的液态玻璃 ［新增，**依赖 R2-K 的实测结论**］

### Task R3-E: 日结面板的液态玻璃 ［新增，**依赖 R2-K 的实测结论**］

> **为什么两个都标「依赖 R2-K」**：R2-K 要先量出**既有**手机 dock 宿主到底是活是死
> （存在 ≠ 生效，唯一口径是保留率）。**若既有宿主量出来是死的，说明这套接线有问题，
> 此时往上加新宿主就是往沙子上盖楼** —— 必须先修地基，再谈新增。R2-K 结论为「活」才直接开工。

#### 用户裁决（2026-10-02）

**两个宿主都做。** 并且用户明确：**不要关注 `shader` 档，这一档位基本不会用到。**

⇒ spec §10.2 原先以「`shader` 档每开一层卡主线程约 1.3 秒」为由判定日结面板**倾向不做**的那条
**已作废并在 spec 里更正**。1.3 秒是 `shader` 档的代价，用户实际用的档位不是它。

⚠️ **但要把这笔代价如实记进代码注释**：若将来有人误切到 `shader` 档，日结面板每次打开会付约 1.3 秒。
接受的边界是「用户不会用那一档」；若这一前提变了，正确处置是**在 `shader` 档下降级为不玻璃化**，
而不是把功能撤掉。

#### 每个宿主都必须逐条走完这 6 条约束（不可省）

1. **材质板是面板的兄弟**，挂在锚点层；不能进库子树，锚点也不能带 `transform`。
2. 从材质板往上到 `body` 的整条祖先链上**不能有合成面**：`fixed` / `sticky` /
   **非 auto 的 `z-index`** 任一出现，材质就只剩染色。层级统一走 `--gs-z`。
3. 位移滤镜**只能写在 `backdrop-filter` 的 `url()` 里**；挂成材质板自己的 `filter:` 会让材质整个消失。
4. `url(#滤镜)` **绝不能进玻璃层的 `backdrop-filter`** —— 它会替换前一步 `blur()` 的输出，表现为整块变透明。
5. 浮层盒子**不能用 `inset: 0` 定高**，要 `height: max(100%, var(--app-height, 0px))`。
6. 手机端走 `fallback` 档；改结构后必须把 `forceEngine` 设成 `fallback` 再验（键 `quadrant-glass-v1`）。

#### 验证口径（唯一可信）

**保留率**：条纹插在被测浮层**之前的页面侧** → 同状态抓「材质开 / 材质关」两张 →
`std(开) / std(关)`。**≈0.66 正好 = 1 − 染色 0.34 ⇒ 只剩染色（死）；≤0.2 才算活。**
只用**页面级** `page.screenshot({clip})`；采样盒躲开文字；**一次只加一个宿主并单独验证**。

#### 各宿主的额外注意

- **R3-D（象限计费气泡）**：它挂在四象限画布内、`useCanvasGestures` 的地盘上。加玻璃层
  **不得改变任何指针行为**（气泡上的拖拽/长按仍必须被隔离）。另外它的定位在事件卡上方，
  要确认材质板的锚点与气泡一起移动、不错位。
- **R3-E（日结面板）**：它是**每天开一次**的浮层，且是本项目里少见的**高频**宿主。
  除保留率外，还要**实测打开一次的耗时**并在报告里给出数字（不是为了 shader 档，
  是为了知道 standard/fallback 档下的真实代价）。
- 两者都**不得**因此改动既有几何（面板尺寸、行高、`--gs-menu-row` 之类）。

- [ ] Step 1: 等 R2-K 结论；若为「死」则先停在 R2-K，不要开工
- [ ] Step 2: 逐条走完 6 条约束，把每条的落点写进报告
- [ ] Step 3: 量保留率（开/关两张 + `std` 比值），给出数字
- [ ] Step 4: R3-D 额外验证指针行为零变化；R3-E 额外给出打开耗时
- [ ] Step 5: 提交（**两个宿主分两次提交、分两次复审**，不要合并成一次）
