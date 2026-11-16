import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppData, LocalSnapshot } from '../shared/types'
import { decodeAppDataText, validAppData } from '../shared/appDataCodec'
import { defaultData } from '../shared/defaults'
import { serializeData } from './dataCodec'

const FILE_NAME = 'plan.json'
const BACKUP_NAME = 'plan.backup.json'
const TMP_NAME = 'plan.tmp.json'

/**
 * 写入串行队列。
 *
 * 两个作用：① 保证落盘顺序（防抖被取消、页面关闭前补交时可能短时间连发两次）；
 * ② 让主进程退出时能"等最后一次 `data:save` 完成再退"——渲染进程收到
 * `beforeunload` 后发出的那次 IPC 可能还在写盘。
 */
let pendingWrite: Promise<void> = Promise.resolve()

function dataDir(): string {
  return app.getPath('userData')
}

async function readSnapshot(file: string): Promise<LocalSnapshot> {
  try {
    return decodeAppDataText(await fs.readFile(file, 'utf-8'))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing', data: defaultData() }
      : { kind: 'recovery', data: defaultData() }
  }
}

export async function loadSnapshot(): Promise<LocalSnapshot> {
  const dir = dataDir()
  const primary = await readSnapshot(path.join(dir, FILE_NAME))
  if (primary.kind === 'ready') return primary
  const backup = await readSnapshot(path.join(dir, BACKUP_NAME))
  if (backup.kind === 'missing') return primary
  if (primary.kind === 'missing') return backup
  return backup.kind === 'ready' ? { kind: 'recovery', data: backup.data } : primary
}

export async function loadData(): Promise<AppData> {
  return (await loadSnapshot()).data
}

async function writeAtomic(data: AppData): Promise<void> {
  const dir = dataDir()
  const file = path.join(dir, FILE_NAME)
  const backup = path.join(dir, BACKUP_NAME)
  const tmp = path.join(dir, TMP_NAME)
  if ((await loadSnapshot()).kind === 'recovery') throw new Error('存档需要恢复，原始文件已保留')
  if (!validAppData(data)) throw new Error('存档结构无效')
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(file, backup).catch(() => {})
  await fs.writeFile(tmp, serializeData(data), 'utf-8')
  await fs.rename(tmp, file)
}

export function saveData(data: AppData): Promise<void> {
  const run = pendingWrite.then(() => writeAtomic(data))
  pendingWrite = run.catch(() => undefined)
  return run
}

/** 等待所有进行中的写入落地（退出前调用）。 */
export function flushPendingWrites(): Promise<void> {
  return pendingWrite
}
