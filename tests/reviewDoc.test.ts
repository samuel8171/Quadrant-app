import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildReviewDocx,
  reviewDateLine,
  reviewFileName
} from '../src/main/reviewDoc'

function extractDocumentXml(buf: Buffer): string {
  let off = 0
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) {
      off += 1
      continue
    }
    const method = buf.readUInt16LE(off + 8)
    const compressedSize = buf.readUInt32LE(off + 18)
    const nameLen = buf.readUInt16LE(off + 26)
    const extraLen = buf.readUInt16LE(off + 28)
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8')
    const dataStart = off + 30 + nameLen + extraLen
    if (name === 'word/document.xml') {
      const data = buf.subarray(dataStart, dataStart + compressedSize)
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8')
    }
    off = dataStart + compressedSize
  }
  throw new Error('word/document.xml not found')
}

describe('reviewDoc', () => {
  it('builds a local-date file name with weekday', () => {
    expect(reviewFileName(new Date(2026, 7, 16))).toBe('2026年8月16日周日复盘.docx')
    expect(reviewFileName(new Date(2026, 7, 10))).toBe('2026年8月10日周一复盘.docx')
  })

  it('builds a date line', () => {
    expect(reviewDateLine(new Date(2026, 7, 16))).toBe('2026年8月16日 周日')
  })

  it('builds a valid docx containing the values', async () => {
    const buf = await buildReviewDocx(
      { completion: 8, quality: 7, stress: 6, text: '本周复盘\n继续加油' },
      new Date(2026, 7, 16)
    )
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const xml = extractDocumentXml(buf)
    expect(xml).toContain('周日复盘')
    expect(xml).toContain('计划完成度：80%')
    expect(xml).toContain('计划完成质量：70%')
    expect(xml).toContain('压力指数：60%')
    expect(xml).toContain('继续加油')
  })
})
