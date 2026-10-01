import { useMemo, useState } from 'react'
import type {
  LedgerDay,
  LedgerEntry,
  LedgerEntryKind,
  MoneyConfig,
  Quadrant,
  WeekEvent
} from '../../../../shared/types'
import { addDays, dateKey, parseDateKey } from '../../../../shared/dateKey'
import {
  consumptionDeltaLT,
  costOfEntry,
  isFreeUnplannedSettlement,
  leisureDelta,
  nightMinutesOf,
  openNightsBefore,
  pendingDays,
  previousLatePhone,
  restDayCost
} from '../../../../shared/money'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { useAppStore } from '../../state/appStore'
import MoneyIcon from './MoneyIcon'

/**
 * 结算面板：按**最早优先**逐日走完所有待结算的日子（spec 7.1 / 7.2）。
 *
 * 每一天依次问这几件事：① 计划内事件逐条「做了吗 / 实际多久」；② 有没有计划外的事；
 * ③ 今天刷视频 / 打游戏用了多久（只扣娱币）；④ 昨天 24:00 之后有没有刷手机（定额扣
 * **次日**）；⑤ 深夜补记（见 `DayForm` 与 `confirmNight`）。每条实时显示它产生的 TC / LT，
 * 让规则当场可解释，而不是结算完给一个黑箱数字。
 *
 * ⚠️ ④ 与 ⑤ 长得像、实则不同：④ 问的是**刷手机**（定额扣次日时币 + 娱币），
 * ⑤ 问的是**做事**（按时长 × 深夜倍率算时币）。两者在同一次日结里**并列问出**，
 * 谁也不替代谁，④ 的说明文字把区别点明，免得用户以为被问了同一件事两遍。
 *
 * ⑤ 补记**一次问遍所有**早于当天的未收尾深夜（最早优先），而不是只问最新的那一个：
 * 只挑最新会让更旧的那个永远选不中、把它所在的那一周永久堵死。判定住在
 * `openNightsBefore`（shared 纯函数），面板只负责逐条渲染与逐条清理。
 *
 * 面板**不玻璃化**（不加 `.gs-*`、不加 `backdrop-filter`）：普通面板色 + `var(--border)`
 * 已经够用，而每新增一个玻璃材质宿主都要重新满足「祖先链上不能有 fixed / sticky /
 * 非 auto 的 z-index」这条约束，本项目为此返工过多次（见 spec 12.4）。
 *
 * **无计划之日另给两条路**（spec R2 §4.3）：这类日子不显示「那天我什么都没做」，
 * 而是给「休息日（固定扣 64）」与「去这一天的时间轴补计划」两个按钮（见 `DayForm` 的
 * `settle-branch` 块）。它同样不能以 0 花费结算 —— 守卫见 `isFreeUnplannedSettlement`。
 */

/** 面板里的一条待确认记录：计划内/计划外统一成同一种可编辑行。 */
interface Row {
  id: string
  kind: LedgerEntryKind
  sourceId: string | null
  title: string
  quadrant: Quadrant | null
  plannedMin: number | null
  actualMin: number
  done: boolean
  /**
   * 来自周计划事件的开始时刻（分钟）→ 深夜分钟可随「实际多久」实时重算；
   * 账本里的旧条目没有开始时刻，只能沿用记录时定下的 `fixedNightMin`。
   */
  startMin: number | null
  fixedNightMin: number
}

/** 行落在深夜区间内的分钟数：有开始时刻就重算，否则沿用记录时的值（未做恒为 0）。 */
function nightMinOf(row: Row, config: MoneyConfig): number {
  if (!row.done) return 0
  if (row.startMin === null) return row.fixedNightMin
  return nightMinutesOf({ startMin: row.startMin, actualMin: row.actualMin }, config)
}

/** 行产生的 TC 消耗（未做恒为 0；象限倍率随行携带，与 `settleDay` 同口径）。 */
function rowCost(row: Row, config: MoneyConfig): number {
  if (!row.done) return 0
  return costOfEntry({ actualMin: row.actualMin, nightMin: nightMinOf(row, config), quadrant: row.quadrant }, config)
}

/** 行产生的 LT 净变化（判定顺序与 `leisureDelta` 同源）。 */
function rowDelta(row: Row, config: MoneyConfig): number {
  return leisureDelta(
    { kind: row.kind, done: row.done, actualMin: row.done ? row.actualMin : 0, plannedMin: row.plannedMin },
    config
  )
}

/** 把一条可编辑行固化成账本条目（镜像字段也一并算好，便于阅读）。 */
function toEntry(row: Row, config: MoneyConfig): LedgerEntry {
  const actualMin = row.done ? row.actualMin : 0
  const nightMin = nightMinOf(row, config)
  return {
    id: row.id,
    kind: row.kind,
    sourceId: row.sourceId,
    title: row.title,
    quadrant: row.quadrant,
    plannedMin: row.plannedMin,
    actualMin,
    done: row.done,
    nightMin,
    costTC: rowCost(row, config),
    deltaLT: rowDelta(row, config)
  }
}

/**
 * 组装某一天的初始行集：**账本里已记录的先上，再补上当天有、账本里还没有的计划**。
 *
 * 两条来源都要，缺一不可：
 * - 只读账本 → 种子数据或象限页记下的条目会漏掉当天新加的计划；
 * - 只读计划 → 象限页（Task 9）已经记下的完成事项会被覆盖丢失。
 * 计划事件按 `sourceId` 去重，避免与账本里的同一条重复问两遍。
 */
function buildRows(day: LedgerDay | undefined, events: WeekEvent[]): Row[] {
  const rows: Row[] = []
  const recorded = new Set<string>()
  if (day) {
    for (const entry of day.entries) {
      if (entry.kind === 'planned' && entry.sourceId) recorded.add(entry.sourceId)
      rows.push({
        id: entry.id,
        kind: entry.kind,
        sourceId: entry.sourceId,
        title: entry.title,
        quadrant: entry.quadrant,
        plannedMin: entry.plannedMin,
        actualMin: entry.actualMin,
        done: entry.done,
        startMin: null,
        fixedNightMin: entry.nightMin
      })
    }
  }
  for (const event of events) {
    if (recorded.has(event.id)) continue
    const plannedMin = Math.max(0, event.endMin - event.startMin)
    rows.push({
      id: crypto.randomUUID(),
      kind: 'planned',
      sourceId: event.id,
      title: event.title,
      quadrant: event.quadrant,
      plannedMin,
      actualMin: plannedMin,
      done: true,
      startMin: event.startMin,
      fixedNightMin: 0
    })
  }
  return rows
}

/** 有符号数字的显示：奖励 / 惩罚都要能一眼看出方向（0 不带符号）。 */
const signed = (value: number): string => `${value > 0 ? '+' : ''}${value}`

/** 输入框里的文本 → 非负整数分钟：空串 / 非数字 / 负数一律取 0。 */
function toMinutes(value: string): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 深夜补记的问句。目标就是日历上的昨天时用「昨夜」（常态），隔了空洞则点名日期，
 * 免得用户以为问的是昨天。
 */
function nightQuestion(date: string, openDate: string): string {
  const isYesterday = openDate === dateKey(addDays(parseDateKey(date), -1))
  return isYesterday
    ? '昨夜 23:30 之后还在做事吗？（昨天 23:20 结算时深夜窗口还没开）'
    : `${openDate} 23:30 之后还在做事吗？（那天 23:20 结算时深夜窗口还没开）`
}

/** 某一天深夜问的默认答案：没做事、持续到 01:00（仅在用户改选「是」后生效）。 */
const DEFAULT_NIGHT_ANSWER = { worked: false, endMin: 60 }

interface DayFormProps {
  date: string
  day: LedgerDay | undefined
  events: WeekEvent[]
  config: MoneyConfig
  /**
   * **所有**早于 `date` 的「已结算、但仍挂着 `nightPending`」的日账本，最早优先。
   * 一次结算要把它们逐条问完、逐条清掉 —— 只问最新的那一个会让更旧的永远选不中
   * （见 `openNightsBefore` 的说明）。空数组表示没有待补记的深夜。
   */
  openNights: LedgerDay[]
  /**
   * **前一日**记录下的「昨夜刷手机」答案，决定**本日**是否被连带扣款。
   * 由宿主的 `previousLatePhone(money.days, date)` 现查（唯一的查找真源），
   * 面板只读不算 —— 它既用于把本日总账显示准，也用于提醒用户这笔钱从何而来。
   */
  carriedLatePhone: boolean
  total: number
  onCommitted: () => void
  /** 分支 B：跳到 `date` 那天的**时间轴**补计划（spec R2 §4.3，由宿主的日视图承接）。 */
  onOpenDay: (date: string) => void
}

function DayForm({
  date,
  day,
  events,
  config,
  openNights,
  carriedLatePhone,
  total,
  onCommitted,
  onOpenDay
}: DayFormProps): JSX.Element {
  const commitDaySettlement = useAppStore((s) => s.commitDaySettlement)
  const addUnplannedEntry = useAppStore((s) => s.addUnplannedEntry)
  const confirmNight = useAppStore((s) => s.confirmNight)
  const markRestDay = useAppStore((s) => s.markRestDay)

  // 初始行只在本组件挂载时算一次 —— 外层用 `key={date}` 保证换一天就重挂载。
  const [rows, setRows] = useState<Row[]>(() => buildRows(day, events))
  const [newTitle, setNewTitle] = useState('')
  const [newMin, setNewMin] = useState('30')
  const [newQuadrant, setNewQuadrant] = useState<Quadrant>(2)
  // 每个未收尾深夜各自一份答案（key = 那一天自己的日期），默认「否」。
  const [nightAnswers, setNightAnswers] = useState<
    Record<string, { worked: boolean; endMin: number }>
  >(() => Object.fromEntries(openNights.map((night) => [night.date, DEFAULT_NIGHT_ANSWER])))

  /*
   * 本日三问的答案（spec R2 §7 第 4 项）。
   *
   * 前两问是**本日纯消费**（只扣娱币、不花时币），第三问是**本日对「昨晚」的回答**，
   * 它记在本日、扣在**次**日。三者都是日级输入，随提交一起交给 `commitDaySettlement`
   * —— 不是条目，所以不放进 `rows`。
   */
  const [videoMin, setVideoMin] = useState(0)
  const [gameMin, setGameMin] = useState(0)
  const [latePhone, setLatePhone] = useState(false)

  const needed = rows.filter((r) => r.kind === 'planned')
  const extra = rows.filter((r) => r.kind === 'unplanned')
  const totalCost = rows.reduce((sum, r) => sum + rowCost(r, config), 0)
  const totalDelta = rows.reduce((sum, r) => sum + rowDelta(r, config), 0)
  /**
   * 这一天**有没有计划内的事件** —— 决定走哪条路（spec R2 §4.3 / §9.2）。
   *
   * `needed` 同时含「当天周计划里的事件」与「账本里已记录的计划内条目」，
   * 两者都是「这一天被计划过」的证据，所以由它派生而不是只看 `events`。
   */
  const hasPlan = needed.length > 0
  /** 休息日的固定扣款，从 config 现算（不写死 64）。 */
  const restCost = restDayCost(config)

  /*
   * 三问的实时数字 —— 一律走既有纯函数，组件里不写任何公式（spec R2 §7 第 4 项）。
   *
   * - 前两问各自的花费由 `consumptionDeltaLT` 单独算（只传一项、另一项为 0），
   *   于是「刷视频这一问」显示的正是它自己的 −LT，而不是两问的合计；
   * - 合计同样由同一个纯函数给出，用于底部总账；
   * - 第三问的扣款是定额（`config.latePhoneTC` / `config.latePhoneLT`），
   *   `settleDay` 也是直读这两个 config 值，这里照读即同源，没有第二套算法。
   */
  const videoDelta = consumptionDeltaLT({ videoMin, gameMin: 0 }, config)
  const gameDelta = consumptionDeltaLT({ videoMin: 0, gameMin }, config)
  const consumptionDelta = consumptionDeltaLT({ videoMin, gameMin }, config)
  const carriedTC = carriedLatePhone ? config.latePhoneTC : 0
  const carriedLT = carriedLatePhone ? config.latePhoneLT : 0

  /*
   * 本日总账 = 条目 + 两条纯消费 + **前一日**带来的连带扣款。
   * 刷手机这一问本身**不进**本日总账：它记在本日、扣在次日（见 ④ 的说明与
   * `settleDay` 的 latePhone / previousLatePhone 两个入参）。
   */
  const dayCost = totalCost + carriedTC
  const dayDelta = totalDelta + consumptionDelta - carriedLT

  /*
   * 免费的无计划日守卫（spec R2 §4.3 / §9.2）：提交按钮只要「有内容」就会出现，
   * 而计划外事项的时长可以被改成 0（或短到计费后仍是 0 币），从而把 spentTC 抹平、
   * 绕开休息日的固定扣款。规则住在纯函数里，store 的提交闸门读同一条规则。
   */
  const entryList = rows.map((r) => toEntry(r, config))
  const freeUnplanned = isFreeUnplannedSettlement(entryList, config)

  const patchRow = (id: string, patch: Partial<Row>): void => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const patchNightAnswer = (
    openDate: string,
    patch: Partial<{ worked: boolean; endMin: number }>
  ): void => {
    setNightAnswers((answers) => ({
      ...answers,
      [openDate]: { ...(answers[openDate] ?? DEFAULT_NIGHT_ANSWER), ...patch }
    }))
  }

  const addUnplanned = (): void => {
    const title = newTitle.trim()
    const actualMin = Math.round(Number(newMin))
    if (!title || !Number.isFinite(actualMin) || actualMin <= 0) return
    const id = crypto.randomUUID()
    const row: Row = {
      id,
      kind: 'unplanned',
      sourceId: null,
      title,
      quadrant: newQuadrant,
      plannedMin: null,
      actualMin,
      done: true,
      startMin: null,
      fixedNightMin: 0
    }
    // 立刻落盘：计划外事项是账本里最有价值的一类信息，不该因为中途关掉面板就丢。
    addUnplannedEntry(date, toEntry(row, config))
    setRows((rs) => [...rs, row])
    setNewTitle('')
  }

  /**
   * 回答**所有**未收尾的深夜那一问（最早优先），逐条清掉各自的 `nightPending`。
   *
   * 从最早开始答是有意义的：`confirmNight` 会重算那一天的快照，而更旧的那一天可能是
   * `carriedOverdraft` 依赖的前一日；先答旧的，后答的那一天读到的就是已经落定的前一日。
   */
  const answerOpenNights = (): void => {
    for (const night of openNights) {
      const answer = nightAnswers[night.date] ?? DEFAULT_NIGHT_ANSWER
      confirmNight(night.date, {
        worked: answer.worked,
        endMin: answer.worked ? answer.endMin : undefined
      })
    }
  }

  const commitEntries = (entries: LedgerEntry[]): void => {
    /*
     * 顺序是**先补记、后结算当天**，不能反。
     *
     * `commitDaySettlement` 结算完会立刻补一次周结算，而周结算只读各日的冻结快照。
     * 若先结算当天、再补记那一天的深夜，被补记那天的 spentTC 是在本周已经冻结之后才变的 ——
     * 那一周的账会永久少掉这笔深夜做事（周快照一经写入不许改）。
     * 反过来先补记（所有未收尾的深夜都先答完），本周的账在滚动那一刻就已经是最终值。
     */
    answerOpenNights()
    commitDaySettlement(date, entries, { videoMin, gameMin, latePhone })
    onCommitted()
  }

  const commit = (): void => commitEntries(entryList)

  /**
   * 「那天我什么都没做」：结算本身走与正常结算**完全同一条** `commitDaySettlement`，
   * 只是把每一条计划内条目都记成 `done: false` / `actualMin: 0` —— 于是 `spentTC` 为 0、
   * 娱币按 `missPenaltyLT` 逐条扣，没有旁路、没有单独的快照分支。
   *
   * 它还要**真正解开周推迟**的结（见 `ensureWeekRollover`）：周结算会推迟含未结算日、
   * 或含 `nightPending` 的周。此前这里只落一条 `nightPending: true` 的日账本，
   * 于是「把一周每天都清空」也解不开 —— 最后一天始终挂着 `nightPending`。现在补上最后一步：
   * 一天既然什么都没做，当晚 23:30 之后也不可能有做事，于是对**当天自己**再调
   * `confirmNight(date, { worked: false })`，把这一天的深夜问记成「否」、清掉 `nightPending`。
   * 更早的未收尾深夜同样先由 `answerOpenNights` 逐条答掉（它们也在 ⑤ 里被问过）。
   * 面板里临时录入的计划外条目一并丢弃 —— 那天什么都没做，也就没有计划外的事。
   *
   * ⚠️ 但**三问的答案照样带过去**，不随「什么都没做」一起丢弃：按钮的契约是「计划内条目
   * 全记未完成」（见它的文案），而两条纯消费与「昨晚刷手机」是独立的日级事实 ——
   * 当天没做计划内的事，不代表没刷视频、更不代表昨晚没刷手机。静默丢弃它们就是数据丢失。
   */
  const commitNothingDone = (): void => {
    const entries = needed.map((r) => toEntry({ ...r, done: false, actualMin: 0 }, config))
    answerOpenNights()
    commitDaySettlement(date, entries, { videoMin, gameMin, latePhone })
    confirmNight(date, { worked: false })
    onCommitted()
  }

  /**
   * 分支 A：把这一天**申报为休息日**并当场结算（spec R2 §4.3 / §9.2）。
   *
   * 与 `commitNothingDone` 同序：先把更早的未收尾深夜逐条答完，再结算当天 ——
   * 顺序反了会让本周在周滚动冻结之后才被改动（见 `commitEntries` 的注释）。
   * 休息日的 `nightPending` 由 `settleDay` 置为 false，因此它自己不是阻塞项。
   *
   * ⚠️ 休息日的契约是 `entries = []`：若用户在 ② 里已经记了计划外的事，再点这里会把它们
   * **一并丢弃**（申报休息日 = 「这天什么都没做」，与「记了事」自相矛盾）。按钮文案在
   * 这种情况下会当场把代价说出来，不让它变成一次静默的数据丢失。
   * 同理，③ 里填的刷视频 / 打游戏时长也会被 `settleDay` 的休息日分支归 0（休息日没有消费），
   * 按钮文案一并点明；但 ④ 的「昨晚刷手机」**照记不误**（它记的是昨晚，见 `markRestDay`）。
   */
  const commitRestDay = (): void => {
    answerOpenNights()
    markRestDay(date, { videoMin, gameMin, latePhone })
    onCommitted()
  }

  /** 休息按钮上如实列出的丢弃项，避免「申报休息日」变成一次静默的数据丢失。 */
  const restDiscards: string[] = []
  if (extra.length > 0) restDiscards.push(`${extra.length} 条计划外事项`)
  if (videoMin > 0 || gameMin > 0) restDiscards.push('已填的娱乐时长')

  return (
    <div className="settle-day">
      {/*
        * 无计划之日 = 两条路（spec R2 §4.3 / §9.2）。只在**这一天没有任何计划内事件**
        * 时出现；有计划的日子仍走既有的逐条流程，一个字都不变。
        *
        * ⚠️ 与「那天我什么都没做」的**刻意不对称**，将来不要「顺手修正」：
        * - 有计划的日子保留那条免费路（spentTC = 0），代价由娱币的 missPenaltyLT 出 ——
        *   你承诺了却没做，娱币才是为「失约」付账的东西；
        * - 没有计划的日子**不给**免费路：它的便宜路是申报休息日（固定 64）。
        *   用户的原话把两者分得很清楚：休息日是「你烧掉了一份容量」，失约是「你破了承诺」。
        * 所以这里不仅藏掉「什么都没做」，也藏掉空日的「结算」按钮 ——
        * 少了后者，0 花费仍会从提交按钮漏出去，整条规则就形同虚设。
        */}
      {!hasPlan && (
        <div className="settle-section settle-branch">
          <h3 className="settle-section-title">这一天没有安排计划</h3>
          <p className="settle-branch-hint">
            休息日是「这天不安排、也没做事」的主动申报：固定扣 {restCost} 币、娱币不动。
            不休息就去这一天的时间轴补上事件块；一个都不放也行，回来直接在下面记计划外的事。
          </p>
          <div className="settle-branch-actions">
            <button type="button" className="settle-rest" onClick={commitRestDay}>
              {`休息日（固定扣 ${restCost} 币${
                restDiscards.length > 0 ? `，丢弃已记的${restDiscards.join('、')}` : ''
              }）`}
            </button>
            <button
              type="button"
              className="settle-gobackfill"
              onClick={() => onOpenDay(date)}
            >
              不休息，去这一天的时间轴
            </button>
          </div>
        </div>
      )}

      <div className="settle-section">
        <h3 className="settle-section-title">① 计划内的事</h3>
        {needed.length === 0 && <p className="settle-empty">这一天没有计划内的事件</p>}
        <ul className="settle-rows">
          {needed.map((row) => (
            <li key={row.id} className={row.done ? 'settle-row' : 'settle-row missed'}>
              <label className="settle-row-done">
                <input
                  type="checkbox"
                  checked={row.done}
                  onChange={(e) => patchRow(row.id, { done: e.target.checked })}
                />
                <span className="settle-row-title">{row.title}</span>
              </label>
              {row.done ? (
                <span className="settle-row-input">
                  <input
                    type="number"
                    min={0}
                    value={row.actualMin}
                    onChange={(e) => patchRow(row.id, { actualMin: Math.max(0, Number(e.target.value)) })}
                  />
                  <span className="settle-unit">分钟</span>
                  {row.plannedMin !== null && (
                    <span className="settle-plan">计划 {row.plannedMin}</span>
                  )}
                </span>
              ) : (
                <span className="settle-miss">没做</span>
              )}
              <span className="settle-row-cost">
                <MoneyIcon kind="tc" size={12} />
                <b>{rowCost(row, config)}</b> 币
                <em>{signed(rowDelta(row, config))} LT</em>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="settle-section">
        <h3 className="settle-section-title">② 计划外的事</h3>
        <ul className="settle-rows">
          {extra.map((row) => (
            <li key={row.id} className="settle-row">
              <span className="settle-row-title">
                {row.title}
                <span className="settle-quad">
                  {row.quadrant ? QUADRANT_META[row.quadrant].label : '无象限'}
                </span>
              </span>
              <span className="settle-row-input">
                <input
                  type="number"
                  min={0}
                  value={row.actualMin}
                  onChange={(e) => patchRow(row.id, { actualMin: Math.max(0, Number(e.target.value)) })}
                />
                <span className="settle-unit">分钟</span>
              </span>
              <span className="settle-row-cost">
                <MoneyIcon kind="tc" size={12} />
                <b>{rowCost(row, config)}</b> 币
                <em>{signed(rowDelta(row, config))} LT</em>
              </span>
              <button
                type="button"
                className="settle-row-remove"
                aria-label={`移除 ${row.title}`}
                onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="settle-add">
          <input
            type="text"
            className="settle-add-title"
            placeholder="做了什么"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <input
            type="number"
            className="settle-add-min"
            min={0}
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
          />
          <span className="settle-unit">分钟</span>
          <select
            value={newQuadrant}
            onChange={(e) => setNewQuadrant(Number(e.target.value) as Quadrant)}
          >
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {QUADRANT_META[q as Quadrant].label}
              </option>
            ))}
          </select>
          <button type="button" className="settle-add-button" onClick={addUnplanned}>
            添加
          </button>
        </div>
      </div>

      {/*
        * ③ 今天的两条娱乐消费（spec R2 §5 / §7 第 4 项）。
        * 它们**只扣娱币、不花时币**，也不进周计划、不进 `quality` 四分类 ——
        * 所以这里没有象限选择，也没有「做了什么」的标题，只有时长。底部的实时数字
        * 走 `consumptionDeltaLT`，组件里不写公式。
        */}
      <div className="settle-section">
        <h3 className="settle-section-title">③ 今天的娱乐消费</h3>
        <p className="settle-hint">
          刷视频与打游戏只扣娱币，不产生任何时币消耗。
        </p>
        <ul className="settle-rows">
          <li className="settle-row">
            <span className="settle-row-title">刷视频</span>
            <span className="settle-row-input">
              <input
                type="number"
                min={0}
                value={videoMin}
                onChange={(e) => setVideoMin(toMinutes(e.target.value))}
              />
              <span className="settle-unit">分钟</span>
            </span>
            <span className="settle-row-cost">
              <MoneyIcon kind="lt" size={12} />
              <b>{signed(videoDelta)}</b> LT
            </span>
          </li>
          <li className="settle-row">
            <span className="settle-row-title">打游戏</span>
            <span className="settle-row-input">
              <input
                type="number"
                min={0}
                value={gameMin}
                onChange={(e) => setGameMin(toMinutes(e.target.value))}
              />
              <span className="settle-unit">分钟</span>
            </span>
            <span className="settle-row-cost">
              <MoneyIcon kind="lt" size={12} />
              <b>{signed(gameDelta)}</b> LT
            </span>
          </li>
        </ul>
      </div>

      {/*
        * ④ 昨夜刷手机（spec R2 §6 / §7 第 4 项）。
        * 与 ⑤ 的「昨夜 23:30 之后还在做事吗」是**两个不同**的追问，两个都保留：
        * 那一问问的是**做事**（按时长 × 深夜倍率算时币），本问问的是**刷手机**
        * （定额扣**次日**的时币与娱币）。下方一句话把区别点明，免得用户以为被问了同一件事。
        */}
      <div className="settle-section">
        <h3 className="settle-section-title">④ 昨夜刷手机</h3>
        <p className="settle-backfill-q">昨天 24:00 之后还有没有刷手机？</p>
        <div className="settle-backfill-answer">
          <label>
            <input
              type="radio"
              name={`late-phone-${date}`}
              checked={!latePhone}
              onChange={() => setLatePhone(false)}
            />
            否
          </label>
          <label>
            <input
              type="radio"
              name={`late-phone-${date}`}
              checked={latePhone}
              onChange={() => setLatePhone(true)}
            />
            有
          </label>
          <span className="settle-row-cost">
            {latePhone ? (
              <>
                次日加扣 <MoneyIcon kind="tc" size={12} />
                <b>{config.latePhoneTC}</b> 币 · <MoneyIcon kind="lt" size={12} />
                {signed(-config.latePhoneLT)} LT
              </>
            ) : (
              '不扣'
            )}
          </span>
        </div>
        <p className="settle-hint">
          这一问问的是<strong>刷手机</strong>，与「昨夜 23:30 之后还在做事吗」是两个不同的问题：
          做事按时长 × 深夜倍率算时币，刷手机是定额扣<strong>次日</strong>的时币与娱币。
        </p>
      </div>

      {openNights.length > 0 && (
        <div className="settle-section settle-backfill">
          <h3 className="settle-section-title">
            ⑤ 补记
            {openNights.length > 1 ? ` ${openNights.length} 个深夜（最早优先）` : ''}
          </h3>
          {openNights.map((night) => {
            const answer = nightAnswers[night.date] ?? DEFAULT_NIGHT_ANSWER
            return (
              <div key={night.date} className="settle-backfill-item">
                <p className="settle-backfill-q">
                  {openNights.length > 1 && (
                    <b className="settle-backfill-date">{night.date}</b>
                  )}
                  {nightQuestion(date, night.date)}
                </p>
                <div className="settle-backfill-answer">
                  <label>
                    <input
                      type="radio"
                      name={`night-${date}-${night.date}`}
                      checked={!answer.worked}
                      onChange={() => patchNightAnswer(night.date, { worked: false })}
                    />
                    否
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`night-${date}-${night.date}`}
                      checked={answer.worked}
                      onChange={() => patchNightAnswer(night.date, { worked: true })}
                    />
                    是，持续到
                  </label>
                  <select
                    value={answer.endMin}
                    disabled={!answer.worked}
                    onChange={(e) =>
                      patchNightAnswer(night.date, { endMin: Number(e.target.value) })
                    }
                  >
                    {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((m) => (
                      <option key={m} value={m}>
                        {String(Math.floor(m / 60)).padStart(2, '0')}:
                        {String(m % 60).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <footer className="settle-foot">
        <span className="settle-total">
          这一天：<MoneyIcon kind="tc" size={12} /> <b>{dayCost}</b> 币 ·{' '}
          <MoneyIcon kind="lt" size={12} /> {signed(dayDelta)} LT
          {carriedLatePhone && (
            <span className="settle-carry">
              （含昨夜刷手机连带 {config.latePhoneTC} 币 / {signed(-config.latePhoneLT)} LT）
            </span>
          )}
        </span>
        {/* 免费路只留给「有计划却被放弃」的那一天，见上面分支块的注释。 */}
        {hasPlan && (
          <button type="button" className="settle-nothing" onClick={commitNothingDone}>
            {`那天我什么都没做（计划内 ${needed.length} 条全记未完成，娱币 −${needed.length * config.missPenaltyLT}；深夜也记为空）`}
          </button>
        )}
        {/*
          * 无计划之日若会被结算成 0 花费，**不显示**提交按钮，并说明原因。
          *
          * 病根：按钮只要「有内容」就会出现，而计划外事项的时长可以被改成 0（或短到计费后
          * 仍是 0 币），从而把 spentTC 抹平、绕开休息日的固定扣款。这条规则与上面分支块注释
          * 里说的「无计划之日不给免费路」是同一件事的两半：藏按钮只是 UI，真正把关的是
          * store 里的 `isFreeUnplannedSettlement`。判据住在纯函数里，两处读同一条规则。
          */}
        {freeUnplanned && extra.length > 0 && (
          <p className="settle-guard">
            这一天的时币花费是 0，不能这样结算：没有计划的一天要么申报休息日（固定扣{' '}
            {restCost} 币），要么填写实际做了多久。把时长删成 0（或短到计费后仍是 0 币）
            并不免费 —— 那正是这条规则要挡住的路。
          </p>
        )}
        {(hasPlan || extra.length > 0) && !freeUnplanned && (
          <button type="button" className="settle-commit" onClick={commit}>
            {total > 1 ? '结算这一天，下一天 →' : '结算这一天'}
          </button>
        )}
      </footer>
    </div>
  )
}

interface Props {
  onClose: () => void
  /** 分支 B 的出口：请宿主把视图切到 `date` 那天的日视图（spec R2 §4.3）。 */
  onOpenDay: (date: string) => void
}

export default function SettlePanel({ onClose, onOpenDay }: Props): JSX.Element | null {
  const money = useAppStore((s) => s.data.money)
  const weekEvents = useAppStore((s) => s.data.weekEvents)
  const today = dateKey(new Date())

  const pending = useMemo(
    () => (money?.enabled === true ? pendingDays(money, today) : []),
    [money, today]
  )

  if (!money || money.enabled !== true || pending.length === 0) return null

  // 永远结算最早的那一天：结算完成后 pending 会自减，同一条路径自然推进到次日。
  const date = pending[0]
  const day = money.days.find((d) => d.date === date)
  const events = weekEvents.filter((event) => event.date === date)
  // 所有早于这一天的未收尾深夜，最早优先 —— 一次结算全部问完（不是只问最新的那一个）。
  const openNights = openNightsBefore(money.days, date)
  // 前一日「昨夜刷手机」的答案决定本日是否被连带扣款：由纯函数现查（不另写一套查找）。
  const carriedLatePhone = previousLatePhone(money.days, date)

  const handleCommitted = (): void => {
    const fresh = useAppStore.getState().data.money
    if (!fresh || fresh.enabled !== true || pendingDays(fresh, today).length === 0) onClose()
  }

  return (
    <div className="settle-overlay" role="dialog" aria-modal="true" aria-label="日结">
      <div className="settle-panel">
        <header className="settle-head">
          <div className="settle-head-text">
            <h2 className="settle-title">日结</h2>
            <p className="settle-sub">
              待结算 {pending.length} 天 · 正在结算 {date}
            </p>
          </div>
          <button type="button" className="settle-close" onClick={onClose} aria-label="关闭日结">
            ×
          </button>
        </header>
        <DayForm
          key={date}
          date={date}
          day={day}
          events={events}
          config={money.config}
          openNights={openNights}
          carriedLatePhone={carriedLatePhone}
          total={pending.length}
          onCommitted={handleCommitted}
          onOpenDay={onOpenDay}
        />
      </div>
    </div>
  )
}
