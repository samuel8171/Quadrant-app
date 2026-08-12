import type { QuadrantApi } from '../shared/types'

declare global {
  interface Window {
    quadrantApi: QuadrantApi
  }
}

export {}
