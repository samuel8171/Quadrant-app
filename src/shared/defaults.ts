import type { AppData } from './types'

export function defaultData(): AppData {
  return {
    version: 2,
    goals: [],
    events: [],
    weekPresets: [],
    weekEvents: [],
    weekCounterOffset: 0
  }
}
