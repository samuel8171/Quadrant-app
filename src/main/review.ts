import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ReviewExport, ReviewRecord } from '../shared/types'
import { buildReviewDocx, reviewFileName } from './reviewDoc'

export function reviewsDir(): string {
  return path.join(app.getPath('userData'), 'reviews')
}

export async function saveReview(payload: ReviewExport): Promise<ReviewRecord> {
  const dir = reviewsDir()
  await fs.mkdir(dir, { recursive: true })
  const now = new Date()
  const fileName = reviewFileName(now)
  const filePath = path.join(dir, fileName)
  await fs.writeFile(filePath, await buildReviewDocx(payload, now))
  const stat = await fs.stat(filePath)
  return { fileName, filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() }
}

export async function listReviews(): Promise<ReviewRecord[]> {
  let names: string[]
  try {
    names = await fs.readdir(reviewsDir())
  } catch {
    return []
  }

  const out: ReviewRecord[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.docx')) continue
    const filePath = path.join(reviewsDir(), name)
    try {
      const stat = await fs.stat(filePath)
      out.push({ fileName: name, filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() })
    } catch {
      // 跳过无法读取的记录。
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export async function openReview(filePath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.access(filePath)
  } catch {
    return { ok: false, error: '文件不存在或已被移动' }
  }
  const err = await shell.openPath(filePath)
  return err ? { ok: false, error: err } : { ok: true }
}
