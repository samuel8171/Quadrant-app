import {
  WEEK_COLORS,
  type AppData,
  type Goal,
  type Quadrant,
  type QuadrantEvent,
  type Subtask,
  type WeekEvent,
  type WeekPreset
} from '../shared/types'

export function serializeData(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function parseData(raw: string): AppData {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new Error('invalid data file')
  }
  const goals = Array.isArray(parsed.goals)
    ? (parsed.goals as unknown[]).map((g) => normalizeGoal(g as Record<string, unknown>))
    : []
  const events = Array.isArray(parsed.events)
    ? (parsed.events as unknown[]).map((e) => normalizeEvent(e as Record<string, unknown>))
    : []
  const weekPresets = Array.isArray(parsed.weekPresets)
    ? (parsed.weekPresets as unknown[]).map((p) =>
        normalizeWeekPreset(p as Record<string, unknown>)
      )
    : []
  const weekEvents = Array.isArray(parsed.weekEvents)
    ? (parsed.weekEvents as unknown[]).map((e) =>
        normalizeWeekEvent(e as Record<string, unknown>)
      )
    : []
  return {
    version: 2,
    goals,
    events,
    weekPresets,
    weekEvents,
    weekCounterOffset:
      typeof parsed.weekCounterOffset === 'number' ? parsed.weekCounterOffset : 0
  }
}

function isQuadrant(v: unknown): v is Quadrant {
  return v === 1 || v === 2 || v === 3 || v === 4
}

function normalizeDuration(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v / 5) * 5 : 60
  return Math.min(600, Math.max(5, n))
}

function normalizeWeekPreset(raw: Record<string, unknown>): WeekPreset {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    color:
      typeof raw.color === 'string' && (WEEK_COLORS as readonly string[]).includes(raw.color)
        ? raw.color
        : WEEK_COLORS[0],
    quadrant: isQuadrant(raw.quadrant) ? raw.quadrant : 1,
    durationMin: normalizeDuration(raw.durationMin),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function todayKey(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function normalizeWeekEvent(raw: Record<string, unknown>): WeekEvent {
  let start = typeof raw.startMin === 'number' ? Math.round(raw.startMin / 5) * 5 : 420
  let end = typeof raw.endMin === 'number' ? Math.round(raw.endMin / 5) * 5 : 480
  if (!(start >= 0 && start < 1440)) start = 420
  if (!(end > start)) end = start + 60
  if (end > 1440) end = 1440
  if (end - start > 600) end = start + 600
  return {
    id: String(raw.id ?? ''),
    date:
      typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
        ? raw.date
        : todayKey(),
    title: String(raw.title ?? ''),
    color:
      typeof raw.color === 'string' && (WEEK_COLORS as readonly string[]).includes(raw.color)
        ? raw.color
        : WEEK_COLORS[0],
    quadrant: isQuadrant(raw.quadrant) ? raw.quadrant : 1,
    startMin: start,
    endMin: end,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    presetId: typeof raw.presetId === 'string' ? raw.presetId : undefined,
    showInQuadrant: Boolean(raw.showInQuadrant),
    quadrantEventId:
      typeof raw.quadrantEventId === 'string' ? raw.quadrantEventId : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function normalizeSubtask(raw: Record<string, unknown>): Subtask {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    done: Boolean(raw.done),
    group: typeof raw.group === 'number' && raw.group >= 1 ? Math.floor(raw.group) : 1,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    order: typeof raw.order === 'number' ? raw.order : 0
  }
}

function normalizeGoal(raw: Record<string, unknown>): Goal {
  const groupTitles = Array.isArray(raw.groupTitles)
    ? raw.groupTitles
        .slice(0, 8)
        .map((title) => (typeof title === 'string' ? title : ''))
    : []
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    type: raw.type === 'short' ? 'short' : 'long',
    done: Boolean(raw.done),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    groupTitles: groupTitles.length > 0 ? groupTitles : [''],
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.map(normalizeSubtask) : [],
    order: typeof raw.order === 'number' ? raw.order : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function normalizeEvent(raw: Record<string, unknown>): QuadrantEvent {
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    quadrant: raw.quadrant === 2 || raw.quadrant === 3 || raw.quadrant === 4 ? raw.quadrant : 1,
    x: typeof raw.x === 'number' ? raw.x : 0,
    y: typeof raw.y === 'number' ? raw.y : 0,
    width: typeof raw.width === 'number' ? raw.width : 6,
    deadline: typeof raw.deadline === 'string' ? raw.deadline : undefined,
    escalateAt: typeof raw.escalateAt === 'string' ? raw.escalateAt : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}
