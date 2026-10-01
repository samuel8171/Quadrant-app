import { useMemo, useState } from 'react'
import DayView from '../components/weekly/DayView'
import WeekOverview from '../components/weekly/WeekOverview'
import SettleCard from '../components/money/SettleCard'
import SettlePanel from '../components/money/SettlePanel'
import { addDays, dateKey, mondayOf, parseDateKey } from '../lib/weekRules'
import { pendingDays } from '../../../shared/money'
import { useAppStore } from '../state/appStore'

type WeeklyView = { kind: 'week'; monday: Date } | { kind: 'day'; date: string }

/**
 * 周计划页 —— 同时是**日结卡片的宿主**（spec 7.1：卡片常驻在周计划页顶部）。
 *
 * 卡片只在这一页出现：它是「时间即金钱」唯一的日常入口，挂在用户每天都会打开的
 * 视图上比单开一个页面更贴合使用动线。周视图与日视图都要显示它（这里用一个
 * `.weekly-shell` 包住两者），否则从周视图点进某一天卡片就消失了。
 */
export default function WeeklyPage(): JSX.Element {
  const [view, setView] = useState<WeeklyView>({ kind: 'week', monday: mondayOf(new Date()) })
  const [closing, setClosing] = useState(false)
  const [backAnim, setBackAnim] = useState(false)
  const [weekSlide, setWeekSlide] = useState<'left' | 'right' | null>(null)
  const [daySlide, setDaySlide] = useState<'left' | 'right' | null>(null)
  const [settleOpen, setSettleOpen] = useState(false)
  /**
   * 非 null = 正在为日结的**分支 B** 补计划：这一天的日视图要多出一个右上角「完成」，
   * 点它回到日结页（spec R2 §4.3）。离开日视图时清掉，正常浏览日视图不再显示该按钮。
   */
  const [backfill, setBackfill] = useState<string | null>(null)

  const money = useAppStore((s) => s.data.money)

  /*
   * 待结算天数。`money` 的引用只要没变（store 每次改动都换新对象）就不重算，
   * 所以周视图/日视图之间的切换、动画重渲染都不会反复跑选择器。
   * 关闭开关或从未启用时恒为 0，卡片随之不渲染。
   */
  const pendingCount = useMemo(
    () => (money?.enabled === true ? pendingDays(money, dateKey(new Date())).length : 0),
    [money]
  )

  const openDay = (key: string): void => {
    setBackAnim(false)
    setDaySlide(null)
    setView({ kind: 'day', date: key })
  }

  const closeDay = (): void => {
    setBackfill(null)
    setClosing(true)
  }

  const finishClose = (): void => {
    if (view.kind !== 'day') return
    const day = parseDateKey(view.date)
    setClosing(false)
    setBackAnim(true)
    setView({ kind: 'week', monday: mondayOf(day) })
  }

  const shiftDay = (n: number): void => {
    if (view.kind !== 'day') return
    setDaySlide(n > 0 ? 'left' : 'right')
    setView({ kind: 'day', date: dateKey(addDays(parseDateKey(view.date), n)) })
  }

  const shiftWeek = (weeks: number): void => {
    if (view.kind !== 'week') return
    setWeekSlide(weeks > 0 ? 'left' : 'right')
    setView({ kind: 'week', monday: addDays(view.monday, weeks * 7) })
  }

  /**
   * 日结分支 B 的去程（spec R2 §4.3）：面板收起、视图切到该日的**时间轴**（日视图）。
   * 复用既有编辑器，不新建界面；`backfill` 让日视图多出一个右上角「完成」。
   */
  const openDayForBackfill = (date: string): void => {
    setBackfill(date)
    setSettleOpen(false)
    setBackAnim(false)
    setDaySlide(null)
    setView({ kind: 'day', date })
  }

  /** 日结分支 B 的回程：关掉补计划态、把日结面板重新打开（它仍会落在最早的那一天）。 */
  const finishBackfill = (): void => {
    setBackfill(null)
    setSettleOpen(true)
  }

  const content =
    view.kind === 'day' ? (
      <DayView
        date={parseDateKey(view.date)}
        onBack={closeDay}
        onShiftDay={shiftDay}
        onComplete={backfill ? finishBackfill : undefined}
        className={closing ? 'day-close' : 'day-open'}
        slideClass={daySlide ? `day-slide-${daySlide}` : undefined}
        onAnimationEnd={(e) => {
          if (closing && e.animationName === 'day-close') finishClose()
        }}
      />
    ) : (
      <WeekOverview
        monday={view.monday}
        onOpenDay={openDay}
        onShift={shiftWeek}
        className={backAnim ? 'page-enter-left' : undefined}
        slideClass={weekSlide ? `week-slide-${weekSlide}` : undefined}
      />
    )

  return (
    <div className="weekly-shell">
      <SettleCard count={pendingCount} onOpen={() => setSettleOpen(true)} />
      {content}
      {settleOpen && (
        <SettlePanel onClose={() => setSettleOpen(false)} onOpenDay={openDayForBackfill} />
      )}
    </div>
  )
}
