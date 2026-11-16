import { decodeAppData, validAppData } from '../../../shared/appDataCodec'
import { isEmptyData } from '../../../shared/defaults'
import type { AppData, CloudMeta, QuadrantApi, SyncMeta } from '../../../shared/types'
import { flushPendingSave, scheduleSave } from './scheduleSave'
import { decideStartup, hasSyncedBefore, normalizeSyncMeta, patchSyncMeta, readSyncMeta, rememberSyncMeta } from './syncMeta'

export interface CloudSnapshot {
  ownerId?: string
  revision: string | null
  updatedAt?: string | null
  data: AppData | null
}

interface CloudAdapter {
  hasSession(): Promise<boolean>
  readMeta(): Promise<CloudMeta>
  read(): Promise<CloudSnapshot>
  write(data: AppData, expectedRevision: string | null, expectedOwner?: string): Promise<{ revision: string }>
  notify(notice: { deviceId: string; revision: string }): Promise<void>
}

interface SnapshotPorts {
  platform(): QuadrantApi
  desktop(): boolean
  current(): AppData
  install(data: AppData, recovery?: boolean): void
  maintain(): void
  report(message: string): void
  conflictCopyAvailable(): void
  cloud?: CloudAdapter
}

interface LocalEdit {
  id: string
  data: AppData
}

const CONFLICT_KEY = 'quadrant-web-data-conflict-snapshot'

function conflictStorage() {
  return (globalThis as {
    window?: { localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } }
  }).window?.localStorage
}

export function readConflictCopies(): string | null {
  try {
    return conflictStorage()?.getItem(CONFLICT_KEY) ?? null
  } catch {
    return null
  }
}

function saveConflictCopy(data: AppData): void {
  const storage = conflictStorage()
  if (!storage) throw new Error('无法保存本地冲突副本')
  const previous: unknown = JSON.parse(storage.getItem(CONFLICT_KEY) ?? '[]')
  const copies = Array.isArray(previous) ? previous : [previous]
  if (JSON.stringify(copies.at(-1)?.data) === JSON.stringify(data)) return
  storage.setItem(CONFLICT_KEY, JSON.stringify([...copies, { at: new Date().toISOString(), data }]))
}

function serializeOperations() {
  let tail = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

function cloudPayload(snapshot: CloudSnapshot): AppData {
  const decoded = decodeAppData(snapshot.data)
  if (!snapshot.revision || decoded.kind !== 'ready') throw new Error('云端快照无法完整读取')
  return decoded.data
}

export function createSnapshotSync(ports: SnapshotPorts) {
  const cloud = ports.cloud
  const onDisk = serializeOperations()
  const onCloud = serializeOperations()
  let pending: LocalEdit | undefined
  let writableOwner: string | undefined
  let writableRevision: string | null | undefined
  let recovery = false
  let needsCloudCopy = false
  let initialized: Promise<void> | undefined

  async function persist(data: AppData, meta: SyncMeta, previousSnapshotId?: string): Promise<void> {
    const api = ports.platform()
    if (api.commitWebSnapshot) {
      api.commitWebSnapshot(data, meta, previousSnapshotId)
      rememberSyncMeta(meta)
      return
    }
    await api.saveData(data)
    await patchSyncMeta(meta)
  }

  async function writePending(): Promise<void> {
    if (!pending || recovery) return
    const edit = pending
    const meta = await readSyncMeta()
    if (pending !== edit) return
    try {
      await persist(edit.data, { ...meta, snapshotId: edit.id, dirty: true }, meta.snapshotId)
    } catch (error) {
      if ((error as Error).name === 'LocalSnapshotConflict') {
        writableRevision = undefined
        saveConflictCopy(edit.data)
        ports.conflictCopyAvailable()
        ports.report('另一标签页已经保存，本标签的改动已另存，请刷新后继续')
      }
      throw error
    }
    if (pending === edit) pending = undefined
    ports.report('')
  }

  async function upload(data: AppData, meta: SyncMeta, expected: string | null, ownerId?: string): Promise<void> {
    if (!cloud) return
    if (!validAppData(data)) throw new Error('存档结构无效')
    const { revision } = ownerId
      ? await cloud.write(data, expected, ownerId)
      : await cloud.write(data, expected)
    writableRevision = revision
    const next = await onDisk(async () => {
      const current = await readSyncMeta()
      return patchSyncMeta({
        dirty: current.snapshotId !== meta.snapshotId,
        cloudRevision: revision,
        ...(ownerId ? { ownerId } : {}),
        lastPushedAt: new Date().toISOString()
      })
    })
    void cloud.notify({ deviceId: next.deviceId, revision })
  }

  async function uploadSaved(): Promise<void> {
    if (!cloud || ports.desktop() || recovery || pending || writableRevision === undefined) return
    const meta = await readSyncMeta()
    if (pending || !meta.dirty || meta.cloudRevision !== writableRevision) return
    const data = ports.current()
    if (writableRevision === null && isEmptyData(data)) return
    try {
      await upload(data, meta, writableRevision, writableOwner)
    } catch (error) {
      // A rejected/unknown write can never establish a new baseline.
      writableRevision = undefined
      if ((error as Error).name === 'CloudRevisionConflict') await reconcile(false)
      else ports.report('改动已保存在本机，云端同步等待重试')
    }
  }

  async function install(snapshot: CloudSnapshot, manual: boolean, expectedLocal?: AppData): Promise<void> {
    const data = cloudPayload(snapshot)
    await onDisk(async () => {
      const api = ports.platform()
      if (expectedLocal && ports.current() !== expectedLocal) throw new Error('本地已更新，请重新查看确认信息')
      if (ports.desktop()) await writePending()
      const meta = await readSyncMeta()
      const edit = pending
      const old = ports.current()
      if (expectedLocal && old !== expectedLocal) throw new Error('本地已更新，请重新查看确认信息')
      if (api.commitWebSnapshot && (edit || meta.dirty || !hasSyncedBefore(meta)) && (!isEmptyData(old) || edit)) {
        saveConflictCopy(old)
        ports.conflictCopyAvailable()
      }
      const saved: SyncMeta = {
        ...meta,
        snapshotId: crypto.randomUUID(),
        dirty: false,
        cloudRevision: snapshot.revision,
        ...(snapshot.ownerId ? { ownerId: snapshot.ownerId } : {}),
        lastPulledAt: new Date().toISOString()
      }
      if (api.commitWebSnapshot) {
        // Disk, sync metadata and the visible copy change in the same browser turn.
        api.commitWebSnapshot(data, saved, meta.snapshotId)
        rememberSyncMeta(saved)
      } else {
        await api.saveData(data)
        if (!pending) await patchSyncMeta(saved)
        if (pending) {
          await patchSyncMeta(meta)
          await writePending()
          throw new Error('本地编辑已变化，请重新查看确认信息')
        }
      }
      pending = undefined
      needsCloudCopy = false
      ports.install(data)
      if (!manual) {
        writableRevision = snapshot.revision
        writableOwner = snapshot.ownerId
      }
      ports.report('')
    })
    ports.maintain()
  }

  async function reconcile(allowUpload = true): Promise<void> {
    if (!cloud || ports.desktop() || recovery) return
    writableRevision = undefined
    try {
      if (!(await cloud.hasSession())) return
      const remote = await cloud.readMeta()
      const meta = await readSyncMeta()
      if (remote.ownerId && meta.ownerId && remote.ownerId !== meta.ownerId) {
        throw new Error('本地快照属于另一账号，自动同步已暂停')
      }
      const local = ports.current()
      const effectiveMeta = pending ? { ...meta, dirty: true } : meta
      const decision = decideStartup({ hasSession: true, local, cloud: remote, meta: effectiveMeta })
      if (decision.kind === 'adopt-cloud' || (needsCloudCopy && remote.exists)) {
        const snapshot = await cloud.read()
        if (snapshot.ownerId !== remote.ownerId) throw new Error('登录账号已改变，请重新对账')
        await install(snapshot, false)
        return
      }
      writableRevision = remote.revision
      writableOwner = remote.ownerId
      await onDisk(writePending)
      if (allowUpload) await uploadSaved()
    } catch (error) {
      writableRevision = undefined
      ports.report(error instanceof Error ? error.message : '同步暂停，等待重新对账')
    }
  }

  function flush(): Promise<void> {
    const saved = onDisk(writePending)
    void saved.then(() => {
      // Upload happens separately so offline requests never hold local disk writes.
      if (writableRevision !== undefined) void onCloud(uploadSaved)
    }, (error: unknown) => {
      if ((error as Error).name !== 'LocalSnapshotConflict') ports.report('本地存档保存失败，改动仍在当前窗口')
    })
    return saved
  }

  return {
    init(): Promise<void> {
      initialized ??= (async () => {
        let snapshot
        try {
          const api = ports.platform()
          snapshot = api.loadSnapshot ? await api.loadSnapshot() : decodeAppData(await api.loadData())
        } catch {
          ports.report('无法读取本地存档')
          return
        }
        recovery = snapshot.kind === 'recovery'
        if (snapshot.syncMeta !== undefined) rememberSyncMeta(normalizeSyncMeta(snapshot.syncMeta))
        needsCloudCopy = snapshot.kind === 'missing'
        if (!ports.desktop() && readConflictCopies()) ports.conflictCopyAvailable()
        ports.install(snapshot.data, recovery)
        if (recovery) {
          ports.report('本地存档需要恢复，原始数据已保留，当前显示恢复预览')
          return
        }
        await onCloud(() => reconcile())
        ports.maintain()
      })()
      return initialized
    },
    edit(data: AppData): void {
      if (recovery) return
      pending = { data, id: crypto.randomUUID() }
      scheduleSave(() => { void flush().catch(() => undefined) })
    },
    async resume(): Promise<void> {
      if (!initialized) return
      await initialized
      await onCloud(() => reconcile())
    },
    flush(): void {
      flushPendingSave()
      void flush().catch(() => undefined)
    },
    async inspectCloud(): Promise<CloudSnapshot> {
      if (!cloud || recovery) throw new Error('当前无法操作云端快照')
      const snapshot = await cloud.read()
      if (snapshot.revision !== null) cloudPayload(snapshot)
      return snapshot
    },
    hasPendingEdit(): boolean {
      return Boolean(pending)
    },
    push(expected: string | null, local: AppData, ownerId?: string): Promise<void> {
      return onCloud(async () => {
        if (recovery || !cloud) throw new Error('当前无法上传')
        await onDisk(writePending)
        const meta = await readSyncMeta()
        if (ports.current() !== local) throw new Error('本地已更新，请重新查看确认信息')
        await upload(local, meta, expected, ownerId)
      })
    },
    pull(expected: string | null, local: AppData, ownerId?: string): Promise<void> {
      return onCloud(async () => {
        if (recovery || !cloud) throw new Error('当前无法恢复')
        const snapshot = await cloud.read()
        if (!snapshot.revision) throw new Error('云端暂无数据')
        if (snapshot.ownerId !== ownerId) throw new Error('登录账号已改变，请重新查看确认信息')
        if (snapshot.revision !== expected) throw new Error('云端已更新，请重新查看确认信息')
        if (ports.current() !== local) throw new Error('本地已更新，请重新查看确认信息')
        await install(snapshot, true, local)
      })
    },
    resetForTests(): void {
      writableOwner = undefined
      writableRevision = undefined
      pending = undefined
      recovery = false
      needsCloudCopy = false
      initialized = undefined
    }
  }
}
