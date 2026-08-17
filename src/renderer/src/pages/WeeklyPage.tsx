import { useState } from 'react'
import DayView from '../components/weekly/DayView'
import WeekOverview from '../components/weekly/WeekOverview'
import { addDays, dateKey, mondayOf, parseDateKey } from '../lib/weekRules'

type WeeklyView = { kind: 'week'; monday: Date } | { kind: 'day'; date: string }

export default function WeeklyPage(): JSX.Element {
  const [view, setView] = useState<WeeklyView>({ kind: 'week', monday: mondayOf(new Date()) })
  const [closing, setClosing] = useState(false)
  const [backAnim, setBackAnim] = useState(false)
  const [weekSlide, setWeekSlide] = useState<'left' | 'right' | null>(null)
  const [daySlide, setDaySlide] = useState<'left' | 'right' | null>(null)

  const openDay = (key: string): void => {
    setBackAnim(false)
    setDaySlide(null)
    setView({ kind: 'day', date: key })
  }

  const closeDay = (): void => {
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

  if (view.kind === 'day') {
    const day = parseDateKey(view.date)
    return (
      <DayView
        date={day}
        onBack={closeDay}
        onShiftDay={shiftDay}
        className={closing ? 'day-close' : 'day-open'}
        slideClass={daySlide ? `day-slide-${daySlide}` : undefined}
        onAnimationEnd={(e) => {
          if (closing && e.animationName === 'day-close') finishClose()
        }}
      />
    )
  }

  return (
    <WeekOverview
      monday={view.monday}
      onOpenDay={openDay}
      onShift={shiftWeek}
      className={backAnim ? 'page-enter-left' : undefined}
      slideClass={weekSlide ? `week-slide-${weekSlide}` : undefined}
    />
  )
}
