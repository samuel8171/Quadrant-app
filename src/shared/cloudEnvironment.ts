const DEFAULT_URL = 'https://nktsnjbkvdyhxdjfbxkh.supabase.co'
const DEFAULT_KEY = 'sb_publishable_oPq0EiI_ofPDz2q0iy9EUQ_byXMWSk5'

export function resolveCloudEnvironment(url: string | undefined, key: string | undefined) {
  const project = url?.trim().replace(/\/+$/, '')
  const publishableKey = key?.trim()
  // The existing Pages workflow already supplies the default project's URL.
  if (!publishableKey && (!project || project === DEFAULT_URL)) {
    return { url: DEFAULT_URL, publishableKey: DEFAULT_KEY }
  }
  if (!project || !publishableKey) throw new Error('Supabase 地址和公开密钥必须成对配置')
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY 必须使用公开密钥')
  }
  return { url: project, publishableKey }
}
