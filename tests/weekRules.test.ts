import { describe, expect, it } from 'vitest'
import type { WeekEvent, WeekPreset } from '../src/shared/types'
import {
  clampEndForDuration,
  clampEventStart,
  clampEventTimes,
  clampStartForDuration,
  createPreset,
  createWeekEvent,
  dateKey,
  deletePresetFromList,
  eventsOnDate,
  formatDateRange,
  formatDuration,
  minuteFromOffsetY,
  minutesToLabel,
  mondayOf,
  moveWeekEventInList,
  snapEventStart,
  snapToHour,
  streakNumber,
  updatePresetInList,
  updateWeekEventInList,
  validateEventTimes,
  weekDays,
  weekIndexFromAnchor
} from '../src/renderer/src/lib/weekRules'

function preset(over: Partial<WeekPreset> = {}): WeekPreset {
  return {
    id: 'p1',
    title: '健身',
    color: '#8CD9C1',
    quadrant: 2,
    durationMin: 90,
    remark: '',
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over
  }
}

function event(over: Partial<WeekEvent> = {}): WeekEvent {
  return {
    id: 'e1',
    date: '2026-08-14',
    title: '考核',
    color: '#8AB4F8',
    quadrant: 1,
    startMin: 480,
    endMin: 570,
    remark: '',
    showInQuadrant: false,
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over
  }
}

describe('weekRules', () => {
  it('computes monday of a date and the seven day keys', () => {
    expect(dateKey(mondayOf(new Date(2026, 7, 14)))).toBe('2026-08-10')
    expect(weekDays(mondayOf(new Date(2026, 7, 14))).map(dateKey)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16'
    ])
  })

  it('counts weeks since anchor with manual offset, floored at 1', () => {
    const anchor = mondayOf(new Date(2026, 7, 10))
    expect(weekIndexFromAnchor(anchor)).toBe(0)
    expect(streakNumber(anchor, 0)).toBe(1)
    const next = mondayOf(new Date(2026, 7, 17))
    expect(weekIndexFromAnchor(next)).toBe(1)
    expect(streakNumber(next, 2)).toBe(4)
    expect(streakNumber(mondayOf(new Date(2026, 6, 27)), -5)).toBe(1)
  })

  it('snaps minutes to the nearest hour', () => {
    expect(snapToHour(449)).toBe(420)
    expect(snapToHour(450)).toBe(480)
    expect(snapToHour(1410)).toBe(1440)
  })

  it('converts timeline offsets to minutes from midnight', () => {
    expect(minuteFromOffsetY(0, 48)).toBe(420)
    expect(minuteFromOffsetY(48, 48)).toBe(480)
    expect(clampEventStart(minuteFromOffsetY(48, 48), 90)).toBe(480)
  })

  it('clamps event start inside day and keeps whole-hour end fit', () => {
    expect(clampEventStart(400, 60)).toBe(420)
    expect(clampEventStart(1380, 90)).toBe(1320)
    expect(clampEventStart(830, 600)).toBe(840)
  })

  it('clamps arbitrary start/end for direct events', () => {
    expect(clampEventTimes(600, 660)).toEqual({ startMin: 600, endMin: 660 })
    expect(clampEventTimes(1320, 1440)).toEqual({ startMin: 1320, endMin: 1440 })
    expect(clampEventTimes(600, 1380)).toEqual({ startMin: 600, endMin: 1200 })
    expect(clampEventTimes(1000, 900)).toEqual({ startMin: 1000, endMin: 1005 })
  })

  it('creates a preset and a copied day event from it', () => {
    const p = createPreset('健身', '#8CD9C1', 2, 90, '')
    expect(p.durationMin).toBe(90)
    expect(p.id).not.toBe('')
    const e = createWeekEvent('2026-08-14', p, 455)
    expect(e.startMin).toBe(480)
    expect(e.endMin).toBe(570)
    expect(e.title).toBe('健身')
    expect(e.presetId).toBe(p.id)
    expect(e.id).not.toBe(p.id)
  })

  it('updates and deletes presets', () => {
    const list = [preset()]
    expect(updatePresetInList(list, 'p1', { durationMin: 205 })[0].durationMin).toBe(205)
    expect(updatePresetInList(list, 'p1', { durationMin: 999 })[0].durationMin).toBe(600)
    expect(deletePresetFromList(list, 'p1')).toHaveLength(0)
  })

  it('moves an event, preserving duration and clamping to the day on a 5-minute grid', () => {
    const list = [event()]
    const moved = moveWeekEventInList(list, 'e1', 955)[0]
    expect(moved.startMin).toBe(955)
    expect(moved.endMin).toBe(1045)
    expect(moveWeekEventInList(list, 'e1', 1380)[0].startMin).toBe(1350)
    expect(moveWeekEventInList(list, 'e1', 400)[0].startMin).toBe(420)
  })

  it('validates event times without silently fixing an inverted range', () => {
    expect(validateEventTimes(600, 660)).toBeNull()
    expect(validateEventTimes(1380, 420)).toBe('截止时间需晚于开始时间')
    expect(validateEventTimes(600, 600)).toBe('截止时间需晚于开始时间')
    expect(validateEventTimes(420, 1440)).toBe('时长不能超过10小时')
  })

  it('clamps start and end while keeping a duration constant', () => {
    expect(clampStartForDuration(455, 60)).toBe(455)
    expect(clampStartForDuration(1400, 60)).toBe(1380)
    expect(clampStartForDuration(400, 60)).toBe(420)
    expect(clampEndForDuration(480, 60)).toBe(480)
    expect(clampEndForDuration(300, 60)).toBe(480)
    expect(clampEndForDuration(1500, 60)).toBe(1440)
  })

  it('snaps a dragged event flush against the nearest existing event', () => {
    const a = event({ id: 'a', startMin: 480, endMin: 540 })
    const b = event({ id: 'b', startMin: 720, endMin: 780 })
    expect(snapEventStart([a, b], 60, 600)).toBe(540)
    expect(snapEventStart([a, b], 60, 660)).toBe(660)
  })

  it('reverts when a dragged event is squeezed between two events', () => {
    const a = event({ id: 'a', startMin: 480, endMin: 540 })
    const b = event({ id: 'b', startMin: 600, endMin: 660 })
    expect(snapEventStart([a, b], 120, 570)).toBeNull()
  })

  it('snaps to day edges around a single event', () => {
    const a = event({ id: 'a', startMin: 480, endMin: 540 })
    expect(snapEventStart([a], 30, 450)).toBe(450)
    expect(snapEventStart([a], 30, 1000)).toBe(540)
  })

  it('picks the closer side when released inside an event', () => {
    const wide = event({ id: 'wide', startMin: 480, endMin: 600 })
    expect(snapEventStart([wide], 30, 500)).toBe(450)
    expect(snapEventStart([wide], 30, 590)).toBe(600)
  })

  it('reverts when there is no room above the first event', () => {
    const first = event({ id: 'first', startMin: 480, endMin: 540 })
    expect(snapEventStart([first], 120, 450)).toBeNull()
  })

  it('reverts when there is no room after the last event', () => {
    const last = event({ id: 'last', startMin: 1380, endMin: 1440 })
    expect(snapEventStart([last], 60, 1420)).toBeNull()
  })

  it('reverts when snapping inside an event is blocked on both sides', () => {
    const a = event({ id: 'a', startMin: 480, endMin: 540 })
    const b = event({ id: 'b', startMin: 600, endMin: 660 })
    expect(snapEventStart([a, b], 90, 520)).toBeNull()
  })

  it('keeps whole-hour snapping when the day has no other events', () => {
    expect(snapEventStart([], 60, 455)).toBe(480)
    expect(snapEventStart([], 90, 1380)).toBe(1320)
  })

  it('updates an event and re-clamps its times', () => {
    const updated = updateWeekEventInList([event()], 'e1', { startMin: 1000 })[0]
    expect(updated.startMin).toBe(1000)
    expect(updated.endMin).toBe(1090)
    expect(updateWeekEventInList([event()], 'e1', { endMin: 100 })[0].endMin).toBe(485)
  })

  it('formats labels', () => {
    expect(minutesToLabel(420)).toBe('7:00')
    expect(minutesToLabel(555)).toBe('9:15')
    expect(minutesToLabel(1440)).toBe('24:00')
    expect(formatDuration(30)).toBe('30分钟')
    expect(formatDuration(60)).toBe('1小时')
    expect(formatDuration(90)).toBe('1.5小时')
    expect(formatDuration(85)).toBe('1小时25分钟')
    expect(formatDuration(600)).toBe('10小时')
    expect(formatDateRange(mondayOf(new Date(2026, 7, 14)))).toBe('8月10日-8月16日')
  })

  it('filters and sorts events of a date', () => {
    const a = event({ id: 'a', startMin: 900 })
    const b = event({ id: 'b', startMin: 480, date: '2026-08-15' })
    const c = event({ id: 'c', startMin: 600 })
    expect(eventsOnDate([a, b, c], '2026-08-14').map((e) => e.id)).toEqual(['c', 'a'])
  })
})
