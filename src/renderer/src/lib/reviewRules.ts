import type { ReviewDraft } from '../../../shared/types'

export const REVIEW_GREEN_RED = [
  '#8CD9C1',
  '#92CDE0',
  '#8AB4F8',
  '#97AEE8',
  '#B4A7E5',
  '#D8A294',
  '#F8B18C',
  '#E8A0A0',
  '#D97E7E',
  '#C85C5C'
] as const

export const REVIEW_RED_GREEN: string[] = [...REVIEW_GREEN_RED].reverse()

export function reviewDirty(a: ReviewDraft, b: ReviewDraft): boolean {
  return (
    a.completion !== b.completion ||
    a.quality !== b.quality ||
    a.stress !== b.stress ||
    a.text !== b.text
  )
}
