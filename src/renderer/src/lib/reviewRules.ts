import type { ReviewDraft } from '../../../shared/types'

export const REVIEW_RED_GREEN = [
  '#d92626',
  '#d94e26',
  '#d97626',
  '#d99d26',
  '#d9c526',
  '#c5d926',
  '#9dd926',
  '#76d926',
  '#4ed926',
  '#26d926'
] as const

export const REVIEW_GREEN_RED: string[] = [...REVIEW_RED_GREEN].reverse()

export function reviewDirty(a: ReviewDraft, b: ReviewDraft): boolean {
  return (
    a.completion !== b.completion ||
    a.quality !== b.quality ||
    a.stress !== b.stress ||
    a.text !== b.text
  )
}
