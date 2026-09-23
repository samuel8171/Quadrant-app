import { supabase } from './cloudSync2'
import { MAX_EVENT_PHOTOS } from '../../../shared/types'

/**
 * 照片实体的云端存储（Supabase Storage）。
 *
 * **为什么不放 `user_data` 表**：整份 `AppData` 是一个 `jsonb` 整行 upsert，
 * 且会被 `JSON.stringify` 进 localStorage（约 5 MB 上限）。照片即便压到约 100 kB/张，
 * 三个事件九张就接近 1 MB，再加上 base64 膨胀 33%，两条路都会被撑爆。
 * Storage 是对象存储，按对象计费与传输，天然适合大二进制；表里只留 id。
 *
 * 路径约定 `attachments/<uid>/<photoId>.jpg`——与 `supabase/schema.sql` 里
 * 已建好的 RLS 策略严格对应：`(storage.foldername(name))[1] = auth.uid()::text`。
 * **不要改成别的层级**，否则策略不匹配、读写会静默返回 403/空。
 *
 * 全程**失败不抛到业务层**：照片是附件，云端不可达时应当退回本地实体
 * （IndexedDB / 桌面端磁盘），让用户至少能在当前设备看到自己的图。
 * 上传失败只影响"换设备可见"，不该让"加照片"这个动作整体失败。
 */

const BUCKET = 'attachments'
/** 与 `photoCompress.ts` 的输出格式一致；换格式要同步改这里与 schema 注释。 */
const EXT = 'jpg'
const CONTENT_TYPE = 'image/jpeg'

/** 当前登录用户 id；未登录返回 null（未登录时不上云，纯本地）。 */
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id ?? null
  } catch {
    return null
  }
}

function objectPath(userId: string, photoId: string): string {
  /*
   * photoId 由 `newPhotoId()` 生成（`ph-<uuid>`），本身不含斜杠；这里仍做清洗，
   * 避免脏数据（云端被手工改过、或未来换了 id 生成方式）把对象写到别人目录下。
   *
   * 关键点：**剥掉路径分隔符并压掉点号序列**。只剥 `/` 其实已经阻断了穿越
   * （`..` 没有分隔符就只是普通文件名），但把 `.` 也压掉可以让"路径里出现 `..`"
   * 这个信号彻底消失——免得日后有人看到 `ph-....evil` 再怀疑一次安全性。
   */
  const safe = photoId
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
  if (!safe) return `${userId}/unnamed.${EXT}`
  return `${userId}/${safe}.${EXT}`
}

/** 是否具备云端照片能力（已登录才有意义）。 */
export async function canUseCloudPhotos(): Promise<boolean> {
  return (await currentUserId()) !== null
}

/**
 * 上传一张照片实体。
 *
 * 返回 `true` 表示确实写到了云端；`false` 表示未登录或上传失败——
 * 调用方据此决定是否把本机实体作为唯一副本保留（**必须保留**，
 * 否则用户会看到一张空白缩略图且无从修复）。
 */
export async function uploadPhoto(photoId: string, blob: Blob): Promise<boolean> {
  const userId = await currentUserId()
  if (!userId) return false
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath(userId, photoId), blob, {
      contentType: blob.type || CONTENT_TYPE,
      // 同一个 id 只会上传一次（id 在生成时就唯一），不覆盖既有对象。
      upsert: false
    })
    if (error) return false
    return true
  } catch {
    return false
  }
}

/** 从云端取一张照片；未登录、不存在或出错都返回 null。 */
export async function downloadPhoto(photoId: string): Promise<Blob | null> {
  const userId = await currentUserId()
  if (!userId) return null
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath(userId, photoId))
    if (error || !data) return null
    return data
  } catch {
    return null
  }
}

/**
 * 删除云端照片。
 *
 * 删除失败不抛：本地实体已经摘掉，残留一个云端对象只是垃圾字节，
 * 不该阻塞"删照片"这个用户动作。
 */
export async function deleteCloudPhoto(photoId: string): Promise<void> {
  const userId = await currentUserId()
  if (!userId) return
  try {
    await supabase.storage.from(BUCKET).remove([objectPath(userId, photoId)])
  } catch {
    /* 见函数注释 */
  }
}

/** 供诊断/探针使用：当前上限（与本地一致）。 */
export const CLOUD_PHOTO_LIMIT = MAX_EVENT_PHOTOS
