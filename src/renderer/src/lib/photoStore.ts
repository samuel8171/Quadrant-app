/**
 * 事件照片的存储层。
 *
 * **为什么不放进 `AppData`**：`platformApi.ts` 把整份数据 `JSON.stringify` 进
 * localStorage 的一个 key（上限约 5 MB），而云端同步又是把整份 `AppData` 当作
 * 一个 `jsonb` 整行 upsert、并用 broadcast 通道广播修订号——照片一旦内嵌，
 * 这两条路都会被撑爆（`cloudSync2.ts` 里已经写明「整行 jsonb 会随数据增长，
 * 撞 postgres_changes 的载荷上限（加了照片之后必然发生）」）。
 *
 * 因此照片只以 **id** 的形式记在 `QuadrantEvent.photos` 上，实体走这里：
 * - 网页端 → IndexedDB（配额通常几百 MB，且以 Blob 存，base64 膨胀问题一并消失）
 *   **并同时上传一份到 Supabase Storage**（见 `lib/cloudPhotos.ts`），
 *   这样换设备/重装后照片能跟着回来——此前照片是纯本地的，换设备只有一堆空缩略图。
 * - 桌面端 → 主进程写文件（见 `src/main/photoStore.ts`）
 *
 * 读取顺序是**本地优先、云端兜底**：本地命中就是零延迟；本地没有（换设备、
 * 清了浏览器数据）才去云端拉，拉回来顺手写回本地缓存，避免同一张图反复下载。
 *
 * 读取接口一律返回 object URL，调用方负责在不用时 `releasePhotoUrl`。
 * 这里带一层引用计数缓存：同一张照片会被缩略图条与大图查看器同时用，
 * 用引用计数避免"一方释放、另一方变成死链接"。
 */

import { uploadPhoto, downloadPhoto, deleteCloudPhoto } from './cloudPhotos'

const DB_NAME = 'quadrant-photos'
const DB_VERSION = 1
const STORE_NAME = 'photos'

/** 桌面端注入的桥（`window.quadrantApi` 上是数据接口，照片接口另挂一个）。 */
interface PhotoBridge {
  savePhoto?: (id: string, dataUrl: string) => Promise<void>
  loadPhoto?: (id: string) => Promise<string | null>
  deletePhoto?: (id: string) => Promise<void>
}

interface BrowserGlobals {
  window?: { quadrantPhotos?: PhotoBridge }
  indexedDB?: IDBFactory
}

function photoBridge(): PhotoBridge | null {
  const browser = globalThis as unknown as BrowserGlobals
  return browser.window?.quadrantPhotos ?? null
}

/** 是否具备持久化照片的能力（隐私模式 / 老浏览器可能都没有）。 */
export function canStorePhotos(): boolean {
  if (photoBridge()?.savePhoto) return true
  const browser = globalThis as unknown as BrowserGlobals
  return Boolean(browser.indexedDB)
}

// ------------------------------------------------------------------ IndexedDB

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  const browser = globalThis as unknown as BrowserGlobals
  const factory = browser.indexedDB
  if (!factory) return Promise.reject(new Error('当前浏览器不支持 IndexedDB'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开照片数据库'))
    request.onblocked = () => reject(new Error('照片数据库被其他标签页占用'))
  }).catch((error) => {
    // 失败时不要把 rejected 的 promise 缓存住，否则后续永远拿不到恢复机会。
    dbPromise = null
    throw error
  })
  return dbPromise
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = run(tx.objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('照片读写失败'))
        tx.onabort = () => reject(tx.error ?? new Error('照片事务被中止'))
      })
  )
}

async function idbPut(id: string, blob: Blob): Promise<void> {
  await transact('readwrite', (store) => store.put(blob, id))
}

async function idbGet(id: string): Promise<Blob | null> {
  const value = await transact<unknown>('readonly', (store) => store.get(id) as IDBRequest<unknown>)
  return value instanceof Blob ? value : null
}

async function idbDelete(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id))
}

// ------------------------------------------------------------- dataURL 互转

/**
 * `Blob` → dataURL。
 *
 * 桌面端桥只能收字符串，所以要走这一趟；网页端不需要（直接存 Blob）。
 * `FileReader` 在旧环境可能缺失，此时退回手写 base64。
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'function') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
      reader.readAsDataURL(blob)
    })
  }
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const type = blob.type || 'image/jpeg'
    return `data:${type};base64,${btoa(binary)}`
  })
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return null
  const type = match[1] || 'image/jpeg'
  const isBase64 = Boolean(match[2])
  const payload = match[3]
  if (!isBase64) return new Blob([decodeURIComponent(payload)], { type })
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

// ------------------------------------------------------------- 对外读写接口

export function newPhotoId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return `ph-${webCrypto.randomUUID()}`
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 存一张照片实体。失败时抛错，由调用方回滚 `event.photos`。 */
export async function putPhoto(id: string, blob: Blob): Promise<void> {
  const bridge = photoBridge()
  if (bridge?.savePhoto) {
    await bridge.savePhoto(id, await blobToDataUrl(blob))
    return
  }
  await idbPut(id, blob)
  /*
   * 本机存好之后再把同一份上传到云端。
   *
   * 顺序刻意如此：本地是**必成的**那份（否则用户当场看不到自己的图），
   * 云端是**增强**。若反过来先等云端，网络差时"加照片"这个动作会卡住数秒，
   * 而失败的话照片就彻底没了。上传失败不抛——`uploadPhoto` 内部已吞掉异常，
   * 只是返回 false，此时照片仅存在于本机（换设备不可见，但功能可用）。
   */
  void uploadPhoto(id, blob)
}

/**
 * 取照片实体；不存在返回 null。
 *
 * 顺序是**本地优先、云端兜底**：
 * ① 本机有（IndexedDB / 桌面端文件）→ 直接返回，零网络开销；
 * ② 本机没有 → 去 Supabase Storage 拉。命中后**回写本地**，这样同一张图
 *    在本次会话的后续读取（缩略图条 + 大图查看器会各取一次）不再走网络，
 *    下次打开也直接命中本地。
 *
 * 回写用 `void` 触发、不 await：它是纯粹的缓存优化，失败不影响本次返回。
 */
export async function getPhotoBlob(id: string): Promise<Blob | null> {
  const bridge = photoBridge()
  if (bridge?.loadPhoto) {
    const dataUrl = await bridge.loadPhoto(id)
    if (dataUrl) return dataUrlToBlob(dataUrl)
    // 桌面端没存过这张（例如照片是在网页端加的）→ 走云端。
    return downloadPhoto(id)
  }

  let local: Blob | null = null
  try {
    local = await idbGet(id)
  } catch {
    local = null
  }
  if (local) return local

  const remote = await downloadPhoto(id)
  if (remote) void idbPut(id, remote).catch(() => undefined)
  return remote
}

/**
 * 删除一张照片实体。
 *
 * 本地与云端**都删**：只删本地的话，换个设备登录会把已删除的照片又拉回来。
 * 两边失败都不抛：照片已经从事件上摘掉，剩下的只是孤儿字节。
 */
export async function removePhoto(id: string): Promise<void> {
  const bridge = photoBridge()
  if (bridge?.deletePhoto) {
    try {
      await bridge.deletePhoto(id)
    } catch {
      /* 见函数注释 */
    }
    void deleteCloudPhoto(id)
    return
  }
  try {
    await idbDelete(id)
  } catch {
    /* 删除失败不该阻塞业务（照片已从事件上摘掉，剩下的只是垃圾字节） */
  }
  void deleteCloudPhoto(id)
}

// --------------------------------------------------------- object URL 缓存

interface CachedUrl {
  url: string
  refs: number
  objectUrl: boolean
}

const urlCache = new Map<string, CachedUrl>()
const pending = new Map<string, Promise<string | null>>()
/** 首次创建期间并发调用者累积的引用数（此时缓存条目尚未写入）。 */
const waitingRefs = new Map<string, number>()
/**
 * 引用计数归零后延迟多少毫秒才真正 revoke。
 *
 * 必须显著大于一帧：该窗口用来吸收「旧的 `<img>` 还在加载、新一轮渲染尚未提交」
 * 以及 StrictMode 的双调用。取 1000ms 属于宽松取值——一张图的 URL 多存活一秒
 * 的内存代价可以忽略，而误 revoke 会导致图片空白（难复现、难归因）。
 */
const REVOKE_GRACE_MS = 1000

function createObjectUrl(blob: Blob): { url: string; objectUrl: boolean } {
  const factory = (globalThis as { URL?: typeof URL }).URL
  if (factory?.createObjectURL) return { url: factory.createObjectURL(blob), objectUrl: true }
  return { url: '', objectUrl: false }
}

/**
 * 取照片的可显示 URL（object URL）。
 *
 * 同一 id 多次调用会共享同一个 URL 并累加引用计数，务必配对调用
 * `releasePhotoUrl`——否则 object URL 永不回收，整屏照片会一直占着内存。
 *
 * 实现上刻意让「计数」与「创建」分离：
 * ① 先同步 `++refs`（若有缓存），再返回——避免调用方在两帧之间还没渲染
 *    就被别人 release 到 0 而提前 revoke（表现为图片随机变成 ERR_FILE_NOT_FOUND）。
 * ② 首次创建时把计数预置为 1（创建者自己算一个持有者），而不是等 promise
 *    落地后再加——否则并发的第二个调用者会在计数仍是 0 的窗口里看到空缓存。
 */
export function acquirePhotoUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id)
  if (cached) {
    cached.refs += 1
    return Promise.resolve(cached.url)
  }
  const inflight = pending.get(id)
  if (inflight) {
    // 复用同一张图：先占住引用计数（缓存条目此刻已存在），再等 URL。
    const entry = urlCache.get(id)
    if (entry) entry.refs += 1
    else
      waitingRefs.set(id, (waitingRefs.get(id) ?? 0) + 1)
    return inflight
  }
  const task = getPhotoBlob(id).then((blob) => {
    if (!blob) return null
    const { url, objectUrl } = createObjectUrl(blob)
    if (!url) return null
    // 创建者 +1，并发等待者在此期间累积的 refs 一并带上。
    const extra = waitingRefs.get(id) ?? 0
    waitingRefs.delete(id)
    urlCache.set(id, { url, refs: 1 + extra, objectUrl })
    return url
  })
  pending.set(id, task)
  const settled = task.finally(() => pending.delete(id))
  return settled
}

export function releasePhotoUrl(id: string): void {
  const cached = urlCache.get(id)
  if (!cached) {
    // 创建尚未完成：把等待者的计数撤回，避免它凭空变成一个"幽灵持有者"。
    const waiting = waitingRefs.get(id)
    if (waiting !== undefined) {
      if (waiting <= 1) waitingRefs.delete(id)
      else waitingRefs.set(id, waiting - 1)
    }
    return
  }
  cached.refs -= 1
  if (cached.refs > 0) return
  /*
   * 计数归零后**延迟回收**，而不是立即 revoke。
   *
   * 两个已实测到的竞态都不能靠同步 revoke 解决：
   * ① React 18 StrictMode 会「挂载 → 卸载 → 再挂载」同一棵子树，两次 effect 的
   *    acquire/release 顺序无法保证；
   * ② `photos` 列表变化（如加了一张照片）时，`usePhotoUrls` 会换一批 URL，
   *    但此刻旧的 `<img>` 仍在 DOM 上、新一轮渲染尚未提交——同步 revoke 会让
   *    浏览器在加载/重绘旧 URL 时报 `net::ERR_FILE_NOT_FOUND`（图片变空白，
   *    且是间歇性的，靠单测抓不到）。
   *
   * 延迟到这个时长后再做二次确认：期间有新的 acquire 把计数抬起来就取消回收。
   * 取值远大于一帧（16ms），确保在途的图片请求与渲染都已落地。
   */
  if (cached.objectUrl) {
    const url = cached.url
    setTimeout(() => {
      if (urlCache.has(id)) return
      try {
        (globalThis as { URL?: typeof URL }).URL?.revokeObjectURL?.(url)
      } catch {
        /* 回收失败不影响功能 */
      }
    }, REVOKE_GRACE_MS)
  }
  urlCache.delete(id)
}

/**
 * 摘掉某张照片的全部缓存引用。
 *
 * 用于"删图"路径：即便某个组件忘了 release，也不会把已删除的照片继续留在内存里。
 */
export function forgetPhotoUrl(id: string): void {
  const cached = urlCache.get(id)
  if (!cached) return
  urlCache.delete(id)
  if (cached.objectUrl) {
    const url = cached.url
    // 同样延迟：可能有组件正在卸载途中仍持有该 URL。
    setTimeout(() => {
      if (urlCache.has(id)) return
      try {
        (globalThis as { URL?: typeof URL }).URL?.revokeObjectURL?.(url)
      } catch {
        /* 同上 */
      }
    }, REVOKE_GRACE_MS)
  }
}
