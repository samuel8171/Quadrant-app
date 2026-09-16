import type { AppData } from '../../../shared/types'

/** 四类实体计数，用于同步确认框里的「本地 N 条 / 云端 M 条」差异摘要。 */
export interface EntityCounts {
  goals: number
  events: number
  weekPresets: number
  weekEvents: number
  total: number
}

export function countEntities(data: AppData): EntityCounts {
  const goals = data.goals.length
  const events = data.events.length
  const weekPresets = data.weekPresets.length
  const weekEvents = data.weekEvents.length
  return { goals, events, weekPresets, weekEvents, total: goals + events + weekPresets + weekEvents }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 把云端 ISO 时间转成本地可读串；无法解析时返回「未知」。 */
export function formatCloudUpdatedAt(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '未知'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return '未知'
  const sameDay =
    t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate()
  const clock = `${pad(t.getHours())}:${pad(t.getMinutes())}`
  return sameDay ? `今天 ${clock}` : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${clock}`
}

export type SyncAction = 'push' | 'pull'

export interface SyncDetailInput {
  action: SyncAction
  local: EntityCounts
  /** 云端不可达或没有数据时为 null。 */
  cloud: EntityCounts | null
  cloudUpdatedAt: string | null
  /** 云端修订与本机记忆不一致：期间有别的设备写过云端。 */
  cloudChangedElsewhere: boolean
  /** 本机存在尚未成功上传的改动。 */
  localDirty: boolean
}

export interface SyncDetail {
  /** 摘要正文，逐行拼接。 */
  lines: string[]
  /** 需要用户特别注意的警示；没有风险时为 null。 */
  warning: string | null
}

function describe(counts: EntityCounts | null): string {
  if (!counts) return '暂无数据'
  return `目标 ${counts.goals} · 四象限 ${counts.events} · 预设 ${counts.weekPresets} · 周计划 ${counts.weekEvents}（共 ${counts.total} 条）`
}

/**
 * 组装同步确认框的差异摘要与风险提示。
 *
 * 两个方向的默认语义都是「整份覆盖」（一期不做行级合并），也就是说这个确认框
 * 是用户唯一的护栏——所以摘要必须把"会被覆盖掉多少条、云端是什么时候的"说清楚。
 */
export function buildSyncDetail(input: SyncDetailInput): SyncDetail {
  const lines = [`本地：${describe(input.local)}`, `云端：${describe(input.cloud)}`]
  lines.push(`云端最后更新：${formatCloudUpdatedAt(input.cloudUpdatedAt)}`)

  let warning: string | null = null
  if (input.action === 'push') {
    if (input.cloudChangedElsewhere) {
      warning = `云端已被其他设备更新（${formatCloudUpdatedAt(input.cloudUpdatedAt)}）。继续上传会用本机数据整份覆盖它。`
    }
  } else if (input.cloud === null) {
    warning = '云端还没有数据，从云端恢复不会改变本机内容。'
  } else if (input.localDirty) {
    warning = '本机有尚未上传的改动，从云端恢复会丢弃这些改动。'
  }
  return { lines, warning }
}

/** 把摘要拼成一段可直接放进确认框的文本。 */
export function formatSyncDetail(detail: SyncDetail): string {
  return [...detail.lines, ...(detail.warning ? ['', `⚠️ ${detail.warning}`] : [])].join('\n')
}
