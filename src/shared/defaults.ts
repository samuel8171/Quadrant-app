import type { AppData } from './types'

export function defaultData(): AppData {
  return { version: 1, goals: [], events: [] }
}
