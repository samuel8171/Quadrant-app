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
import { costOfEntry, leisureDelta, nightMinutesOf, pendingDays } from '../../../../shared/money'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { useAppStore } from '../../state/appStore'

/**
 * 结算面板：按**最早优先**逐日走完所有待结算的日子（spec 7.1 / 7.2）。
 *
 * 每一天依次问三件事：① 计划内事件逐条「做了吗 / 实际多久」；② 有没有计划外的事；
 * ③ 深夜补记（见 `DayForm` 与 `confirmNight`）。每条实时显示它产生的 TC / LT，
 * 让规则当场可解释，而不是结算完给一个黑箱数字。
 *
 * 面板**不玻璃化**（不加 `.gs-*`、不加 `backdrop-filter`）：普通面板色 + `var(--border)`
 * 已经够用，而每新增一个玻璃材质宿主都要重新满足「祖先链上不能有 fixed / sticky /
 * 非 auto 的 z-index」这条约束，本项目为此返工过多次（见 spec 12.4）。
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

/** 行产生的 TC 消耗（未做恒为 0）。 */
function rowCost(row: Row, config: MoneyConfig): number {
  if (!row.done) return 0
  return costOfEntry({ actualMin: row.actualMin, nightMin: nightMinOf(row, config) }, config)
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

interface DayFormProps {
  date: string
  day: LedgerDay | undefined
  events: WeekEvent[]
  config: MoneyConfig
  /** 昨日账本（若已结算且 `nightPending` 则要补记）。 */
  previous: LedgerDay | undefined
  total: number
  onCommitted: () => void
}

function DayForm({
  date,
  day,
  events,
  config,
  previous,
  total,
  onCommitted
}: DayFormProps): JSX.Element {
  const commitDaySettlement = useAppStore((s) => s.commitDaySettlement)
  const addUnplannedEntry = useAppStore((s) => s.addUnplannedEntry)
  const confirmNight = useAppStore((s) => s.confirmNight)

  // 初始行只在本组件挂载时算一次 —— 外层用 `key={date}` 保证换一天就重挂载。
  const [rows, setRows] = useState<Row[]>(() => buildRows(day, events))
  const [newTitle, setNewTitle] = useState('')
  const [newMin, setNewMin] = useState('30')
  const [newQuadrant, setNewQuadrant] = useState<Quadrant>(2)
  const [nightWorked, setNightWorked] = useState(false)
  const [nightEndMin, setNightEndMin] = useState(60)

  const needsBackfill = previous !== undefined && previous.settledAt !== null && previous.nightPending
  const needed = rows.filter((r) => r.kind === 'planned')
  const extra = rows.filter((r) => r.kind === 'unplanned')
  const totalCost = rows.reduce((sum, r) => sum + rowCost(r, config), 0)
  const totalDelta = rows.reduce((sum, r) => sum + rowDelta(r, config), 0)

  const patchRow = (id: string, patch: Partial<Row>): void => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
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

  const commitEntries = (entries: LedgerEntry[]): void => {
    /*
     * 顺序是**先补记、后结算当天**，不能反。
     *
     * `commitDaySettlement` 结算完会立刻补一次周结算，而周结算只读各日的冻结快照。
     * 若先结算当天、再补记昨天，昨天的 spentTC 是在本周已经冻结之后才变的 ——
     * 那一周的账会永久少掉这笔深夜做事（周快照一经写入不许改）。
     * 反过来先补记，本周的账在滚动那一刻就已经是最终值。
     */
    if (needsBackfill) {
      // 补记回写的是**昨天**那一条已结算快照（全库唯一允许改动它的路径）。
      confirmNight(dateKey(addDays(parseDateKey(date), -1)), {
        worked: nightWorked,
        endMin: nightWorked ? nightEndMin : undefined
      })
    }
    commitDaySettlement(date, entries)
    onCommitted()
  }

  const commit = (): void => commitEntries(rows.map((r) => toEntry(r, config)))

  /**
   * 「那天我什么都没做」：走与正常结算**完全同一条** `commitDaySettlement` 路径，
   * 只是把每一条计划内条目都记成 `done: false` / `actualMin: 0` ——
   * 于是 `spentTC` 自然为 0、娱币按 `missPenaltyLT` 逐条扣，没有任何旁路、也没有单独的快照分支。
   *
   * 它的真正职责是**解开死锁**：周结算会推迟含未结算日的周（见 `ensureWeekRollover`），
   * 若某天既不结算也不清掉，那一周的滚动就永远停在那里。面板里临时录入的计划外条目一并丢弃 ——
   * 那天什么都没做，也就没有计划外的事。
   */
  const commitNothingDone = (): void =>
    commitEntries(needed.map((r) => toEntry({ ...r, done: false, actualMin: 0 }, config)))

  return (
    <div className="settle-day">
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

      {needsBackfill && (
        <div className="settle-section settle-backfill">
          <h3 className="settle-section-title">③ 补记昨天</h3>
          <p className="settle-backfill-q">
            昨夜 23:30 之后还在做事吗？（昨天 23:20 结算时深夜窗口还没开）
          </p>
          <div className="settle-backfill-answer">
            <label>
              <input
                type="radio"
                name={`night-${date}`}
                checked={!nightWorked}
                onChange={() => setNightWorked(false)}
              />
              否
            </label>
            <label>
              <input
                type="radio"
                name={`night-${date}`}
                checked={nightWorked}
                onChange={() => setNightWorked(true)}
              />
              是，持续到
            </label>
            <select
              value={nightEndMin}
              disabled={!nightWorked}
              onChange={(e) => setNightEndMin(Number(e.target.value))}
            >
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((m) => (
                <option key={m} value={m}>
                  {String(Math.floor(m / 60)).padStart(2, '0')}:{String(m % 60).padStart(2, '0')}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <footer className="settle-foot">
        <span className="settle-total">
          这一天：<b>{totalCost}</b> 币 · {signed(totalDelta)} LT
        </span>
        <button type="button" className="settle-nothing" onClick={commitNothingDone}>
          {needed.length > 0
            ? `那天我什么都没做（计划内 ${needed.length} 条全记未完成，娱币 −${needed.length * config.missPenaltyLT}）`
            : '那天我什么都没做'}
        </button>
        <button type="button" className="settle-commit" onClick={commit}>
          {total > 1 ? '结算这一天，下一天 →' : '结算这一天'}
        </button>
      </footer>
    </div>
  )
}

interface Props {
  onClose: () => void
}

export default function SettlePanel({ onClose }: Props): JSX.Element | null {
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
  const previous = money.days.find(
    (d) => d.date === dateKey(addDays(parseDateKey(date), -1))
  )

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
          previous={previous}
          total={pending.length}
          onCommitted={handleCommitted}
        />
      </div>
    </div>
  )
}
