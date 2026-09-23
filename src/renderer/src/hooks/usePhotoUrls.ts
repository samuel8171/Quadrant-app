import { useEffect, useRef, useState } from 'react'
import { acquirePhotoUrl, releasePhotoUrl } from '../lib/photoStore'

/**
 * 把一组照片 id 解析成可显示的 object URL。
 *
 * 三个必须处理的点：
 *
 * ① **依赖用 join 后的字符串**，而不是数组本身——数组字面量每次渲染都是新引用，
 *    直接当依赖会让 effect 无限重跑。
 *
 * ② **取消的批次不能立刻释放**。effect 被下一次依赖变化取代时（StrictMode 的
 *    双调用、或 photos 列表变化），先前那次 acquire 的结果可能**已经被提交进
 *    `urls` 并被 `<img>` 渲染**。此时若按"取消就还回去"处理，正在显示的
 *    `<img>` 会指向一个已 revoke 的 blob URL，浏览器报
 *    `net::ERR_FILE_NOT_FOUND`、图片变空白——这个缺陷在真实浏览器里复现过。
 *    因此取消分支**什么都不做**：引用要么由本批提交后接管，要么由卸载清理兜底。
 *
 * ③ **提交与释放配对**。只有当一批 URL 真正写进 state（即将被渲染）时，才把
 *    上一批还回去。上一批此刻已不再被任何 `<img>` 引用，释放是安全的。
 */
export function usePhotoUrls(ids: string[]): (string | null)[] {
  const [urls, setUrls] = useState<(string | null)[]>(() => ids.map(() => null))
  /** 当前已被 state 提交、因而"被渲染持有"的那批 id。 */
  const heldRef = useRef<string[]>([])
  const key = ids.join('|')

  useEffect(() => {
    const list = key ? key.split('|') : []
    /** 本批是否已被后续 effect / 卸载作废。 */
    let stale = false
    /** 本批是否已提交进 state（提交后由 heldRef 接管）。 */
    let committed = false

    Promise.all(list.map((id) => acquirePhotoUrl(id))).then((resolved) => {
      if (stale && !committed) {
        // 组件已卸载、或依赖在本批落地前又变了，且这批从未被渲染：
        // 无人持有这些引用，必须在这里归还，否则泄漏（图片永远留在内存里）。
        for (const id of list) releasePhotoUrl(id)
        return
      }
      if (committed) return
      committed = true
      // 上一批此时已确定不再被渲染引用，可以安全归还。
      for (const id of heldRef.current) releasePhotoUrl(id)
      heldRef.current = list
      setUrls(resolved)
    })

    return () => {
      stale = true
    }
  }, [key])

  // 真正的卸载清理：把最后一批已提交的引用还掉。
  useEffect(
    () => () => {
      for (const id of heldRef.current) releasePhotoUrl(id)
      heldRef.current = []
    },
    []
  )

  // ids 变短时先把多出来的槽位清掉，避免渲染出上一条事件的图。
  return urls.length === ids.length ? urls : ids.map(() => null)
}
