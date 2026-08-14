import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppData } from '../shared/types'
import { defaultData } from '../shared/defaults'
import { parseData, serializeData } from './dataCodec'

const FILE_NAME = 'plan.json'
const BACKUP_NAME = 'plan.backup.json'
const TMP_NAME = 'plan.tmp.json'

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

export async function saveData(data: AppData): Promise<void> {
  const dir = dataDir()
  const file = path.join(dir, FILE_NAME)
  const backup = path.join(dir, BACKUP_NAME)
  const tmp = path.join(dir, TMP_NAME)
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(file, backup).catch(() => {})
  await fs.writeFile(tmp, serializeData(data), 'utf-8')
  await fs.rename(tmp, file)
}
