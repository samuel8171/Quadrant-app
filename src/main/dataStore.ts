import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppData } from '../shared/types'
import { defaultData } from '../shared/defaults'
import { parseData, serializeData } from './dataCodec'

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

export async function loadData(): Promise<AppData> {
  const dir = dataDir()
  const file = path.join(dir, FILE_NAME)
  const backup = path.join(dir, BACKUP_NAME)
  try {
    return parseData(await fs.readFile(file, 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultData()
    }
    try {
      return parseData(await fs.readFile(backup, 'utf-8'))
    } catch {
      return defaultData()
    }
  }
}

async function writeAtomic(data: AppData): Promise<void> {
  const dir = dataDir()
  const file = path.join(dir, FILE_NAME)
  const backup = path.join(dir, BACKUP_NAME)
  const tmp = path.join(dir, TMP_NAME)
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
