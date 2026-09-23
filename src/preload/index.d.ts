import type { QuadrantApi } from '../shared/types'

/** 照片实体接口（桌面端落 `userData/photos/`，见 `main/photoStore.ts`）。 */
export interface QuadrantPhotos {
  savePhoto: (id: string, dataUrl: string) => Promise<void>
  loadPhoto: (id: string) => Promise<string | null>
  deletePhoto: (id: string) => Promise<void>
}

declare global {
  interface Window {
    quadrantApi: QuadrantApi
    quadrantPhotos?: QuadrantPhotos
  }
}

export {}
