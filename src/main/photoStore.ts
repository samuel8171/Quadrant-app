import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 桌面端的照片实体存储。
 *
 * 与渲染进程的 IndexedDB 对应——Electron 里也可以直接用 IndexedDB，但那样照片会
 * 留在 Chromium 的 profile 目录里，用户从 `plan.json` 的角度看是"数据丢了一部分"
 * （`plan.json` 只记 id）。落在 `userData/photos/` 下更可解释，也方便备份。
 *
 * 存的是 dataURL 文本而非二进制：渲染进程侧本就用 dataURL 过桥，
 * 直接落盘可以省掉一次 base64↔Buffer 的转换与随之而来的编码坑。
 */
function photosDir(): string {
  return path.join(app.getPath('userData'), 'photos')
}

/** 防目录穿越：id 由渲染进程生成，但落盘前仍要挡住 `../`。 */
function photoPath(id: string): string {
  const safe = path.basename(id).replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe) throw new Error('非法的照片 id')
  return path.join(photosDir(), `${safe}.txt`)
}

export async function savePhoto(id: string, dataUrl: string): Promise<void> {
  const file = photoPath(id)
  await fs.mkdir(photosDir(), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, dataUrl, 'utf-8')
  await fs.rename(tmp, file)
}

export async function loadPhoto(id: string): Promise<string | null> {
  try {
    return await fs.readFile(photoPath(id), 'utf-8')
  } catch {
    return null
  }
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    await fs.unlink(photoPath(id))
  } catch (err) {
    // 已经不存在就是成功；其余错误也不该阻塞业务。
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}
