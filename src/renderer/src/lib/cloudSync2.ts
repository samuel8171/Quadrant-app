import { createClient } from '@supabase/supabase-js'
import type { AppData } from '../../../shared/types'

export const SUPABASE_URL = 'https://nktsnjbkvdyhxdjfbxkh.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_oPq0EiI_ofPDz2q0iy9EUQ_byXMWSk5'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@quadrant.app`
export async function login(username: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password })
  if (error) throw error
}
export function validCloudData(value: unknown): value is AppData {
  const d = value as Partial<AppData> | null
  return !!d && d.version === 2 && Array.isArray(d.goals) && Array.isArray(d.events) && Array.isArray(d.weekPresets) && Array.isArray(d.weekEvents)
}
export async function syncData(local: AppData): Promise<AppData> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) throw new Error('请先登录云端账号')
  const userId = session.session.user.id
  const { data: row, error } = await supabase.from('user_data').select('data').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const data = validCloudData(row?.data) ? row.data : local
  const { error: saveError } = await supabase.from('user_data').upsert({ user_id: userId, data, updated_at: new Date().toISOString() })
  if (saveError) throw saveError
  return data
}

export async function uploadData(data: AppData): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) throw new Error('请先登录云端账号')
  const { error } = await supabase.from('user_data').upsert({ user_id: session.session.user.id, data, updated_at: new Date().toISOString() })
  if (error) throw error
}

export function subscribeRealtime(onData: (data: AppData) => void): () => void {
  const channel = supabase.channel('quadrant-user-data').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_data' }, (payload) => {
    if (validCloudData(payload.new?.data)) onData(payload.new.data)
  }).subscribe()
  return () => { void supabase.removeChannel(channel) }
}
