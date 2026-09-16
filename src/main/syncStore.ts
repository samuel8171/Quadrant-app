import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SyncMeta } from '../shared/types'

const FILE_NAME = 'sync.json'

function syncFilePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

/**
 * 同步元信息独立于 `plan.json` 存放。
 *
 * 单独放的理由：它是「本机视角的同步状态」，不是用户数据。混进 `plan.json`
 * 会被一起上传到云端，还会让每次同步都多出一个无意义的字段差异。
 */
export async function loadSyncMeta(): Promise<Partial<SyncMeta> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(syncFilePath(), 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Partial<SyncMeta>
  } catch {
    // 首次运行（ENOENT）或文件损坏：交给渲染端补齐，deviceId 会在那边生成。
    return null
  }
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  const file = syncFilePath()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf-8')
  await fs.rename(tmp, file)
}
