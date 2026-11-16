import { defaultData } from './defaults'
import { DEFAULT_MONEY_CONFIG } from './money'
import type { AppData, LocalSnapshot } from './types'

export const LOCAL_SNAPSHOT_META_KEY = '__quadrantLocalSnapshot'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasStringFields(value: unknown, fields: string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string')
}

function validPhotos(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((id) => typeof id === 'string'))
}

const MONEY_NUMERIC_KEYS = [
  'weeklyTC',
  'dailyCapTC',
  'tcPerHour',
  'nightStartMin',
  'nightEndMin',
  'nightMultiplier',
  'minCapRatio',
  'weeklyLT',
  'rewardLT',
  'penaltyLT',
  'missPenaltyLT',
  'videoLTPerHour',
  'gameLTPerHour',
  'restDayFactor',
  'abandonedDayTC',
  'latePhoneTC',
  'latePhoneLT'
] as const

const QUADRANT_MULTIPLIER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const

const WEEK_SETTLEMENT_NUMERIC_KEYS = [
  'weekTC',
  'spentTC',
  'weekOver',
  'plannedMin',
  'actualMin',
  'doneCount',
  'missCount',
  'unplannedCount',
  'unplannedMin',
  'nightMin',
  'overLimitDays',
  'nextWeekTC',
  'nextWeekLT'
] as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validLedgerEntry(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
  if (value.kind !== 'planned' && value.kind !== 'unplanned') return false
  if (typeof value.done !== 'boolean') return false
  if (value.sourceId !== null && typeof value.sourceId !== 'string') return false
  if (value.plannedMin !== null && !isFiniteNumber(value.plannedMin)) return false
  if (!isFiniteNumber(value.actualMin) || !isFiniteNumber(value.nightMin)) return false
  if (!isFiniteNumber(value.costTC) || !isFiniteNumber(value.deltaLT)) return false
  return value.quadrant === null || [1, 2, 3, 4].includes(value.quadrant as number)
}

function validOptionalMinutes(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value)
}

function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function validOptionalDateKey(value: unknown): boolean {
  return value === undefined || isDateKey(value)
}

function validLedgerDay(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isDateKey(value.date)) return false
  if (value.settledAt !== null && typeof value.settledAt !== 'string') return false
  if (typeof value.nightPending !== 'boolean') return false
  if (!validOptionalMinutes(value.videoMin) || !validOptionalMinutes(value.gameMin)) return false
  if (!validOptionalBoolean(value.isRestDay) || !validOptionalBoolean(value.latePhone)) return false
  if (!isFiniteNumber(value.dayLimit) || !isFiniteNumber(value.spentTC)) return false
  if (!isFiniteNumber(value.overdraft) || !isFiniteNumber(value.deltaLT)) return false
  return Array.isArray(value.entries) && value.entries.every(validLedgerEntry)
}

function validWeekSettlement(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isDateKey(value.weekStart) || !isDateKey(value.weekEnd)) return false
  if (![0, 1, 2, 3].includes(value.penaltyTier as number)) return false
  if (!Array.isArray(value.notes) || !value.notes.every((note) => typeof note === 'string')) {
    return false
  }
  return WEEK_SETTLEMENT_NUMERIC_KEYS.every((key) => isFiniteNumber(value[key]))
}

function validQuadrantMultiplier(value: unknown): boolean {
  return isRecord(value) && QUADRANT_MULTIPLIER_KEYS.every((key) => isFiniteNumber(value[key]))
}

function validMoney(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.enabled !== 'boolean') return false
  if (!validOptionalDateKey(value.enabledAt)) return false
  const config = value.config
  if (!isRecord(config) || !MONEY_NUMERIC_KEYS.every((key) => isFiniteNumber(config[key]))) {
    return false
  }
  if (!validQuadrantMultiplier(config.quadrantMultiplier)) return false
  if (!Array.isArray(value.days) || !value.days.every(validLedgerDay)) return false
  if (!Array.isArray(value.weeks) || !value.weeks.every(validWeekSettlement)) return false
  return true
}

function validGoal(value: unknown): value is AppData['goals'][number] {
  return isRecord(value) && hasStringFields(value, ['id', 'title', 'type', 'remark', 'createdAt']) &&
    (value.type === 'long' || value.type === 'short') && typeof value.done === 'boolean' &&
    isFiniteNumber(value.order) &&
    Array.isArray(value.groupTitles) && value.groupTitles.every((title) => typeof title === 'string') &&
    Array.isArray(value.subtasks) && value.subtasks.every((task) => isRecord(task) &&
      hasStringFields(task, ['id', 'title', 'remark']) && typeof task.done === 'boolean' &&
      isFiniteNumber(task.group) && isFiniteNumber(task.order))
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function validEvent(value: unknown): value is AppData['events'][number] {
  return isRecord(value) && hasStringFields(value, ['id', 'text', 'remark', 'createdAt']) &&
    [1, 2, 3, 4].includes(value.quadrant as number) && validPhotos(value.photos) &&
    isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.width) &&
    optionalString(value.deadline) && optionalString(value.escalateAt)
}

function validPreset(value: unknown): value is AppData['weekPresets'][number] {
  return isRecord(value) && hasStringFields(value, ['id', 'title', 'color', 'remark', 'createdAt']) &&
    [1, 2, 3, 4].includes(value.quadrant as number) && isFiniteNumber(value.durationMin)
}

function validWeekEvent(value: unknown): value is AppData['weekEvents'][number] {
  return isRecord(value) && hasStringFields(value, ['id', 'title', 'color', 'remark', 'createdAt']) &&
    isDateKey(value.date) && [1, 2, 3, 4].includes(value.quadrant as number) &&
    isFiniteNumber(value.startMin) && isFiniteNumber(value.endMin) && typeof value.showInQuadrant === 'boolean' &&
    optionalString(value.presetId) && optionalString(value.quadrantEventId)
}

export function validAppData(value: unknown): value is AppData {
  if (!isRecord(value)) return false
  const data = value
  return data.version === 2 && isFiniteNumber(data.weekCounterOffset) &&
    Array.isArray(data.goals) && data.goals.every(validGoal) &&
    Array.isArray(data.events) && data.events.every(validEvent) &&
    Array.isArray(data.weekPresets) && data.weekPresets.every(validPreset) &&
    Array.isArray(data.weekEvents) && data.weekEvents.every(validWeekEvent) &&
    (data.money === undefined || validMoney(data.money))
}

function previewOf(value: Record<string, unknown>): AppData {
  const preview = {
    ...defaultData(),
    goals: Array.isArray(value.goals) ? value.goals.filter(validGoal) : [],
    events: Array.isArray(value.events) ? value.events.filter(validEvent) : [],
    weekPresets: Array.isArray(value.weekPresets) ? value.weekPresets.filter(validPreset) : [],
    weekEvents: Array.isArray(value.weekEvents) ? value.weekEvents.filter(validWeekEvent) : [],
    weekCounterOffset: isFiniteNumber(value.weekCounterOffset) ? value.weekCounterOffset : 0,
    ...(validMoney(value.money) ? { money: value.money } : {})
  }
  return validAppData(preview) ? preview : defaultData()
}

// Only fields with historical defaults are added. Existing values and settled
// entries are copied verbatim, including fields introduced by compatible builds.
function migrate(value: Record<string, unknown>): Record<string, unknown> {
  let data = { ...value }
  if (value.version === 1) {
    data = {
      weekPresets: [],
      weekEvents: [],
      weekCounterOffset: 0,
      ...value,
      version: 2,
      goals: Array.isArray(value.goals)
        ? value.goals.map((goal, order) => isRecord(goal)
          ? {
              remark: '', order, groupTitles: [''], subtasks: [],
              ...goal,
              ...(Array.isArray(goal.subtasks) ? {
                subtasks: goal.subtasks.map((task, order) =>
                  isRecord(task) ? { remark: '', group: 1, order, ...task } : task)
              } : {})
            }
          : goal)
        : value.goals,
      events: Array.isArray(value.events)
        ? value.events.map((event) => isRecord(event) ? { remark: '', width: 6, ...event } : event)
        : value.events
    }
  }
  if (isRecord(data.money) && isRecord(data.money.config)) {
    const raw = data.money.config
    const config = {
      ...DEFAULT_MONEY_CONFIG,
      ...raw,
      ...(raw.quadrantMultiplier === undefined || isRecord(raw.quadrantMultiplier) ? {
        quadrantMultiplier: { ...DEFAULT_MONEY_CONFIG.quadrantMultiplier, ...raw.quadrantMultiplier }
      } : {})
    }
    data.money = { ...data.money, config }
  }
  return data
}

export function decodeAppData(value: unknown): LocalSnapshot {
  if (isRecord(value) && LOCAL_SNAPSHOT_META_KEY in value) {
    const { [LOCAL_SNAPSHOT_META_KEY]: _local, ...data } = value
    value = data
  }
  if (validAppData(value)) return { kind: 'ready', data: value }
  if (isRecord(value) && (value.version === 1 || value.version === 2)) {
    const migrated = migrate(value)
    if (validAppData(migrated)) return { kind: 'ready', data: migrated }
    return { kind: 'recovery', data: previewOf(migrated) }
  }
  return { kind: 'recovery', data: defaultData() }
}

export function decodeAppDataText(raw: string | null): LocalSnapshot {
  if (raw === null) return { kind: 'missing', data: defaultData() }
  try {
    return decodeAppData(JSON.parse(raw))
  } catch {
    return { kind: 'recovery', data: defaultData() }
  }
}
