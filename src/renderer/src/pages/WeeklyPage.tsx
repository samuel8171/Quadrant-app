import { useState } from 'react'
import DayView from '../components/weekly/DayView'
import WeekOverview from '../components/weekly/WeekOverview'
import { addDays, dateKey, mondayOf, parseDateKey } from '../lib/weekRules'

type WeeklyView = { kind: 'week'; monday: Date } | { kind: 'day'; date: string }

export default function WeeklyPage(): JSX.Element {
  const [view, setView] = useState<WeeklyView>({ kind: 'week', monday: mondayOf(new Date()) })

  if (view.kind === 'day') {
    const day = parseDateKey(view.date)
    return (
      <DayView
        date={day}
        onBack={() => setView({ kind: 'week', monday: mondayOf(day) })}
        onShiftDay={(n) => setView({ kind: 'day', date: dateKey(addDays(day, n)) })}
      />
    )
  }

  return (
    <WeekOverview
      monday={view.monday}
      onOpenDay={(key) => setView({ kind: 'day', date: key })}
      onShift={(weeks) =>
        setView({ kind: 'week', monday: addDays(view.monday, weeks * 7) })
      }
    />
  )
}
