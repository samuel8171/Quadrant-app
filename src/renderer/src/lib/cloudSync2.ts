/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'
import { decodeAppData, validAppData } from '../../../shared/appDataCodec'
import { resolveCloudEnvironment } from '../../../shared/cloudEnvironment'
import type { CloudSnapshot } from './snapshotSync'
import type { AppData, CloudMeta } from '../../../shared/types'
import { validSyncNotice, type SyncNotice } from './cloudValidation'

// Keep the serializable snapshot rules separate from the browser Supabase client.
const environment = resolveCloudEnvironment(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
)
export const SUPABASE_URL = environment.url
export const SUPABASE_ANON_KEY = environment.publishableKey
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
function revisionOf(row: { revision?: unknown }): string {
  if (typeof row.revision !== 'string' || row.revision.length === 0) throw new Error('云端修订号无效')
  return row.revision
}

export async function fetchCloudMeta(): Promise<CloudMeta> {
  const userId = await requireUserId()
  const { data, error } = await supabase
    .from('user_data')
    .select('revision')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { ownerId: userId, exists: Boolean(data), revision: data ? revisionOf(data) : null }
}

export async function fetchCloudData(): Promise<CloudSnapshot> {
  const userId = await requireUserId()
  const { data: row, error } = await supabase
    .from('user_data')
    .select('data, revision, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) return { ownerId: userId, revision: null, data: null }
  const decoded = decodeAppData(row.data)
  return {
    ownerId: userId,
    revision: revisionOf(row),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    data: decoded.kind === 'ready' ? decoded.data : null
  }
}

class CloudRevisionConflict extends Error {
  override name = 'CloudRevisionConflict'

  constructor() {
    super('云端已更新，请重新对账')
  }
}

export async function pushCloudData(
  data: AppData,
  expectedRevision: string | null,
  expectedOwner?: string
): Promise<{ revision: string }> {
  const ownerId = await requireUserId()
  if (expectedOwner && ownerId !== expectedOwner) throw new Error('登录账号已改变，请重新对账')
  if (!validAppData(data)) throw new Error('存档结构无效')
  const { data: revision, error } = await supabase.rpc('commit_user_snapshot', {
    expected_owner: ownerId,
    expected_revision: expectedRevision,
    snapshot: data
  })
  if (error) throw new Error(error.message)
  if (revision === null) throw new CloudRevisionConflict()
  return { revision: revisionOf({ revision }) }
}

// ------------------------------------------------------------ 变更广播（通知）

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
