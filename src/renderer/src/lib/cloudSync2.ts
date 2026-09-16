import { createClient } from '@supabase/supabase-js'
import type { AppData, CloudMeta } from '../../../shared/types'

export const SUPABASE_URL = 'https://nktsnjbkvdyhxdjfbxkh.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_oPq0EiI_ofPDz2q0iy9EUQ_byXMWSk5'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@quadrant.app`
export async function login(username: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
  if (error) throw error
}
export async function hasCloudSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}
export function validCloudData(value: unknown): value is AppData {
  const d = value as Partial<AppData> | null
  return !!d && d.version === 2 && Array.isArray(d.goals) && Array.isArray(d.events) && Array.isArray(d.weekPresets) && Array.isArray(d.weekEvents)
}

/** 取当前会话的 user id，未登录时抛出可读错误。 */
async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('请先登录云端账号')
  return data.session.user.id
}

/**
 * 只取云端**元信息**（不拉整份数据）。
 *
 * 用于「云端是否变了」的廉价比对：整份 jsonb 随数据增长，动不动就拉全量
 * 在网络差时很痛；而同步判定只需要一个修订号。
 */
export async function fetchCloudMeta(): Promise<CloudMeta> {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_data')
    .select('updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  const revision = typeof data?.updated_at === 'string' ? data.updated_at : null
  return { exists: Boolean(data) && revision !== null, revision }
}

export async function fetchCloudData(): Promise<{ revision: string | null; data: AppData | null }> {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_data')
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  const revision = typeof data?.updated_at === 'string' ? data.updated_at : null
  const payload = validCloudData(data?.data) ? data.data : null
  return { revision, data: payload }
}

/**
 * 本地 → 云端，整份覆盖，返回写入后的云端修订号。
 *
 * 修订号取自云端回写的 `updated_at`；若因 RLS 未返回行，则退回本机时钟——
 * 两侧都只是「用来比对是否变化」的标记，不参与业务判定。
 */
export async function pushCloudData(data: AppData): Promise<{ revision: string }> {
  const userId = await requireUserId()
  const now = new Date().toISOString()
  const { data: row, error } = await supabase
    .from('user_data')
    .upsert({ user_id: userId, data, updated_at: now })
    .select('updated_at')
    .maybeSingle()
  if (error) throw error
  return { revision: typeof row?.updated_at === 'string' ? row.updated_at : now }
}

// ------------------------------------------------------------ 变更广播（通知）

export interface SyncNotice {
  /** 写入方的设备标识，用于抑制回环。 */
  deviceId: string
  /** 写入后的云端修订号。 */
  revision: string
}

export function validSyncNotice(value: unknown): value is SyncNotice {
  const n = value as Partial<SyncNotice> | null
  return !!n && typeof n.deviceId === 'string' && n.deviceId.length > 0 && typeof n.revision === 'string' && n.revision.length > 0
}

/**
 * 用 broadcast 通道取代原来的 `postgres_changes` 订阅。
 *
 * 三个理由：① 整行 jsonb 会随数据增长，撞 `postgres_changes` 的载荷上限
 * （加了照片之后必然发生）；② 原订阅只监听 `UPDATE`，首次写入是 `INSERT`，
 * 收不到；③ 原订阅依赖 `user_data` 被加入 realtime publication，而 `schema.sql`
 * 里没有这一步，若没在控制台手工开启，推送根本不会到达——这类"静默失效"最难查。
 * broadcast 走同一根 WebSocket，但不需要任何数据库侧配置。
 *
 * `self: false` 让本机发出的消息不回环，`deviceId` 再做一层兜底。
 */
const NOTICE_CHANNEL = 'quadrant-sync'
const noticeHandlers = new Set<(notice: SyncNotice) => void>()
let noticeChannel: ReturnType<typeof supabase.channel> | null = null

function ensureNoticeChannel(): ReturnType<typeof supabase.channel> {
  if (noticeChannel) return noticeChannel
  const channel = supabase.channel(NOTICE_CHANNEL, { config: { broadcast: { self: false } } })
  channel.on('broadcast', { event: 'data-changed' }, (message: unknown) => {
    const body = (message as { payload?: unknown } | null)?.payload ?? message
    if (!validSyncNotice(body)) return
    for (const handler of [...noticeHandlers]) {
      try { handler(body) } catch { /* 单个订阅者出错不影响其他订阅者 */ }
    }
  })
  channel.subscribe()
  noticeChannel = channel
  return channel
}

/** 广播一次「云端已更新」。失败不抛：通知只是优化，主流程靠启动/前台拉取兜底。 */
export async function announceSync(notice: SyncNotice): Promise<void> {
  try {
    await ensureNoticeChannel().send({ type: 'broadcast', event: 'data-changed', payload: notice })
  } catch {
    /* 离线或通道未就绪 */
  }
}

export function subscribeSyncNotices(onNotice: (notice: SyncNotice) => void): () => void {
  ensureNoticeChannel()
  noticeHandlers.add(onNotice)
  return () => { noticeHandlers.delete(onNotice) }
}
