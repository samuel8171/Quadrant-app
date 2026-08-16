import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import { percentLabel } from '../shared/review'
import type { ReviewExport } from '../shared/types'

export const REVIEW_WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function reviewFileName(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${REVIEW_WEEKDAY_NAMES[d.getDay()]}复盘.docx`
}

export function reviewDateLine(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${REVIEW_WEEKDAY_NAMES[d.getDay()]}`
}

export async function buildReviewDocx(exp: ReviewExport, d: Date): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: '周日复盘', bold: true, size: 40 })]
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: reviewDateLine(d), size: 24, color: '666666' })]
    }),
    new Paragraph({
      children: [new TextRun({ text: `计划完成度：${percentLabel(exp.completion)}`, size: 24 })]
    }),
    new Paragraph({
      children: [new TextRun({ text: `计划完成质量：${percentLabel(exp.quality)}`, size: 24 })]
    }),
    new Paragraph({
      children: [new TextRun({ text: `压力指数：${percentLabel(exp.stress)}`, size: 24 })]
    }),
    new Paragraph({ children: [] })
  ]

  if (exp.text.trim()) {
    for (const line of exp.text.replace(/\r\n/g, '\n').split('\n')) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 24 })] }))
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
