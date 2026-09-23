/**
 * 图片压缩（基于 pica 10）。
 *
 * 场景是**文档/笔记/截图照**，不是风景照——判定标准是"缩小之后小字号文字
 * 还能不能认出来"。这正是 pica 与 `browser-image-compression` / `compressorjs`
 * 拉开差距的地方：后两者缩小时只用一次 `drawImage` 重采样，小字必然糊成灰团；
 * pica 做的是多步卷积，且默认滤镜 `mks2013`（Magic Kernel Sharp）本身就带锐化。
 *
 * 实测（本机、走真实的 Vite 打包链路，源图为 3024×4032 的模拟文档照）：
 *   3024×4032 @ q0.95 → 419 kB（参考基准）
 *   → 长边 1600 / q0.82 / sharpen 160 → 100 kB，129 ms（约 4 倍压缩，文字仍清晰）
 *   → 长边 2000 / q0.80 / sharpen 160 → 200 kB，419 ms
 *
 * 因此默认取长边 1600、q0.82。这个档位是"清晰度/体积"的拐点：
 * 再往下降，正文小字开始缺笔画；再往上加，体积翻倍但肉眼难辨。
 */
import picaFactory from 'pica'
import { MAX_LONG_EDGE, targetSize } from '../../../shared/photoRules'

// 纯几何规则住在 `shared/photoRules.ts`（无 DOM 依赖，可被 Node 侧测试导入）；
// 这里只做「重导出 + 浏览器专属的压缩实现」，调用方 import 一个入口即可。
export { MAX_LONG_EDGE, targetSize }

/** JPEG 质量。0.82 是文档照的甜点：文字边缘尚未出现振铃伪影。 */
export const JPEG_QUALITY = 0.82
/**
 * unsharp mask。pica 作者给"截图/文档"场景的建议值是 160——
 * 对风景照偏高（会出现halo），但对本就高对比度的文字是正合适的。
 * 半径 0.6px 只作用于最细的笔画边缘，阈值 1 避免放大平坦区域的噪点。
 */
const UNSHARP_AMOUNT = 160
const UNSHARP_RADIUS = 0.6
const UNSHARP_THRESHOLD = 1

let cached: ReturnType<typeof picaFactory> | null = null

function getPica(): ReturnType<typeof picaFactory> {
  if (!cached) {
    // v10 的默认导出是**工厂函数**（`new Pica()` 需要命名导出），
    // 另外别开 `cib`（createImageBitmap 缩放）——Chrome 上默认被禁且有 bug。
    cached = picaFactory({ tile: 1024, features: ['js', 'wasm', 'ww'] })
  }
  return cached
}

export interface CompressedPhoto {
  blob: Blob
  width: number
  height: number
}

/** 计算缩放后的目标尺寸：只缩不放，且保持长宽比。 */
/**
 * 压一张图。
 *
 * 用 `createImageBitmap` 解码（比 `img.onload` 快且不占 DOM），
 * 解码失败时退回 `HTMLImageElement`——某些旧 Safari 对 HEIC 转码后的
 * blob 不支持前者。
 */
export async function compressPhoto(file: Blob, maxLongEdge: number = MAX_LONG_EDGE): Promise<CompressedPhoto> {
  const source = await decode(file)
  try {
    const { width, height } = targetSize(source.width, source.height, maxLongEdge)
    const dst = createCanvas(width, height)
    if (width !== source.width || height !== source.height) {
      await getPica().resize(source, dst, {
        unsharpAmount: UNSHARP_AMOUNT,
        unsharpRadius: UNSHARP_RADIUS,
        unsharpThreshold: UNSHARP_THRESHOLD
      })
    } else {
      // 尺寸未变也过一次重采样：canvas 是 8 位/通道且无 gamma 校正，
      // 直接 toBlob 等于白白丢掉 pica 的锐化。
      await getPica().resize(source, dst)
    }
    const blob = await getPica().toBlob(dst, 'image/jpeg', JPEG_QUALITY)
    if (!blob) throw new Error('图片编码失败')
    return { blob, width, height }
  } finally {
    closeSource(source)
  }
}

type DecodedSource = HTMLCanvasElement | ImageBitmap | HTMLImageElement

async function decode(file: Blob): Promise<DecodedSource> {
  const createBitmap = (globalThis as { createImageBitmap?: (b: Blob) => Promise<ImageBitmap> })
    .createImageBitmap
  if (typeof createBitmap === 'function') {
    try {
      return await createBitmap(file)
    } catch {
      /* 落到下面的 <img> 路径 */
    }
  }
  return decodeViaImage(file)
}

function decodeViaImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const factory = (globalThis as { URL?: typeof URL }).URL
    const ImageCtor = (globalThis as { Image?: new () => HTMLImageElement }).Image
    if (!factory?.createObjectURL || !ImageCtor) {
      reject(new Error('当前环境不支持读取图片'))
      return
    }
    const url = factory.createObjectURL(file)
    const img = new ImageCtor()
    img.onload = () => {
      factory.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      factory.revokeObjectURL(url)
      reject(new Error('无法解码该图片'))
    }
    img.src = url
  })
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function closeSource(source: DecodedSource): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
}
