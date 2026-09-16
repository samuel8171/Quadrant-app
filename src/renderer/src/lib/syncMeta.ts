import { defaultSyncMeta, isEmptyData } from '../../../shared/defaults'
import type { AppData, CloudMeta, SyncMeta } from '../../../shared/types'
import { getPlatformApi } from './platformApi'

/**
 * 同步元信息与「启动该怎么同步」的判定。
 *
 * 这一层刻意做成「纯函数判定 + 薄持久化」两半：判定逻辑全是纯函数（可单测、
 * 不碰网络与平台 API），持久化只是把结果写进 localStorage / `sync.json`。
 * 之所以要这层，是因为现状的两条静默丢数据路径都源于**没有「云端是否变了」
 * 的本地记忆**：只能盲目整份覆盖。
 */

// ---------------------------------------------------------------- 纯函数判定

export type StartupAction =
  | {
      kind: 'keep-local'
      reason: 'no-session' | 'cloud-empty' | 'local-dirty' | 'already-synced'
    }
  | { kind: 'adopt-cloud'; reason: 'local-empty' | 'cloud-newer' }

export interface StartupInput {
  /** 当前是否有可用的云端会话（未登录时无从谈起）。 */
  hasSession: boolean
  local: AppData
  /** 云端行的元信息；`exists=false` 表示云端还没有这一行。 */
  cloud: CloudMeta
  meta: SyncMeta
}

/** 云端是否存在一份「可比对的有效修订」。 */
export function hasCloudRevision(cloud: CloudMeta): boolean {
  return cloud.exists && typeof cloud.revision === 'string' && cloud.revision.length > 0
}

/** 云端修订与本机记忆不一致 ⇒ 期间有别的设备写过云端。 */
export function isCloudChangedElsewhere(cloud: CloudMeta, meta: SyncMeta): boolean {
  return hasCloudRevision(cloud) && cloud.revision !== meta.cloudRevision
}

/**
 * 启动时的单向取舍。判定顺序即优先级，前面的规则先命中就先返回——
 *
 * 1. 没有会话：只能本地。**桌面端靠这条把自动同步整体关掉**（桌面编辑不自动
 *    上传，自动拉取会静默丢掉桌面端未同步的改动）。
 * 2. 云端没有有效修订：没有可采纳的东西。
 * 3. **本地是空数据而云端有数据 ⇒ 采纳云端**（修正「新设备/清缓存 → 覆盖云端为空」）。
 * 4. **本地有未上传改动 ⇒ 保留本地**（离线编辑优先，避免被云端盖掉）。
 * 5. 云端修订与记忆一致 ⇒ 双方已同步，什么都不用做。
 * 6. 其余 ⇒ 云端更新，采纳云端。
 */
export function decideStartup(input: StartupInput): StartupAction {
  const { hasSession, local, cloud, meta } = input
  if (!hasSession) return { kind: 'keep-local', reason: 'no-session' }
  if (!hasCloudRevision(cloud)) return { kind: 'keep-local', reason: 'cloud-empty' }
  if (isEmptyData(local)) return { kind: 'adopt-cloud', reason: 'local-empty' }
  if (meta.dirty) return { kind: 'keep-local', reason: 'local-dirty' }
  if (cloud.revision === meta.cloudRevision) return { kind: 'keep-local', reason: 'already-synced' }
  return { kind: 'adopt-cloud', reason: 'cloud-newer' }
}

/**
 * 启动时是否应该把本地补传上去。
 *
 * 只在「有未上传改动」时成立：正常情况下网页端每次编辑都会即时上传，
 * `dirty` 只会在离线编辑或上次上传失败后保持为真。
 */
export function shouldPushOnStartup(input: StartupInput): boolean {
  return input.hasSession && !isEmptyData(input.local) && input.meta.dirty
}

// ---------------------------------------------------------------- 持久化

let cache: SyncMeta | null = null

function newDeviceId(): string {
  // 显式取全局 crypto：这段代码同时被 Node 环境（测试）与 DOM 环境（渲染进程）加载，
  // 直接写 `crypto.randomUUID()` 在缺少 DOM lib 的配置下过不了类型检查。
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    try {
      return webCrypto.randomUUID()
    } catch {
      /* 非安全上下文下 randomUUID 会抛错，走下面的兜底 */
    }
  }
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 磁盘/存储里的值可能是旧版本或损坏的，一律补齐成完整形状。 */
export function normalizeSyncMeta(value: unknown): SyncMeta {
  const raw = (value ?? {}) as Partial<SyncMeta>
  const deviceId =
    typeof raw.deviceId === 'string' && raw.deviceId.length > 0 ? raw.deviceId : newDeviceId()
  return {
    deviceId,
    lastPulledAt: typeof raw.lastPulledAt === 'string' ? raw.lastPulledAt : null,
    lastPushedAt: typeof raw.lastPushedAt === 'string' ? raw.lastPushedAt : null,
    cloudRevision: typeof raw.cloudRevision === 'string' ? raw.cloudRevision : null,
    dirty: raw.dirty === true
  }
}

async function persist(meta: SyncMeta): Promise<void> {
  try {
    await getPlatformApi().saveSyncMeta(meta)
  } catch {
    /* 存储不可用（隐私模式 / 配额满 / 旧 preload）时只保留内存态，不阻断同步流程 */
  }
}

/**
 * 读取同步元信息（带进程内缓存）。
 *
 * 平台 API 侧做了容错：桌面端若加载的是旧 preload（`out/` 里的历史构建），
 * `loadSyncMeta` 可能根本不存在——此时退化为内存态，不影响主流程。
 */
export async function readSyncMeta(): Promise<SyncMeta> {
  if (cache) return cache
  let stored: Partial<SyncMeta> | null = null
  try {
    stored = await getPlatformApi().loadSyncMeta()
  } catch {
    stored = null
  }
  cache = stored ? normalizeSyncMeta(stored) : defaultSyncMeta(newDeviceId())
  // 首次运行必须**立刻落盘**：deviceId 只留在内存里的话，每次冷启动都会换一个
  // 身份，广播通知的回环抑制（比对自己的 deviceId）就永远认不出这是自己发的。
  if (!stored) await persist(cache)
  return cache
}

export async function patchSyncMeta(patch: Partial<SyncMeta>): Promise<SyncMeta> {
  const next = { ...(await readSyncMeta()), ...patch }
  cache = next
  await persist(next)
  return next
}

export async function markSyncDirty(): Promise<void> {
  const meta = await readSyncMeta()
  if (meta.dirty) return
  await patchSyncMeta({ dirty: true })
}

export async function markPushed(revision: string | null): Promise<SyncMeta> {
  return patchSyncMeta({ dirty: false, cloudRevision: revision, lastPushedAt: new Date().toISOString() })
}

export async function markPulled(revision: string | null): Promise<SyncMeta> {
  return patchSyncMeta({ dirty: false, cloudRevision: revision, lastPulledAt: new Date().toISOString() })
}

/** 仅供测试：清掉进程内缓存，使下一次读取回到持久化状态。 */
export function resetSyncMetaCache(): void {
  cache = null
}
