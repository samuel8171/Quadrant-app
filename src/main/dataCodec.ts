import type { AppData } from '../shared/types'

export function serializeData(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function parseData(raw: string): AppData {
  const parsed = JSON.parse(raw) as AppData
  if (
    !parsed ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.goals) ||
    !Array.isArray(parsed.events)
  ) {
    throw new Error('invalid data file')
  }
  return parsed
}
