/**
 * 本地日期的字符串键与「周」的纯计算工具。
 *
 * **为什么住在 shared/**：`shared/money.ts` 的周结算（`ensureWeekRollover`）需要
 * 「一周的周一」这个概念。这些函数原先住在 `src/renderer/src/lib/weekRules.ts`，
 * 若由 `shared/` 反向 import `renderer/`，依赖方向就错了（`shared/` 是两端共用的
 * 叶子层，不允许知道界面层）。因此把五个纯日期函数**下沉**到本文件，
 * `weekRules.ts` 改为原样 re-export，既有的 import 点一个都不用改。
 *
 * 本模块无任何依赖、无顶层副作用，纯函数。
 */

/** 两位补零。 */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 取**本地**日期键 `YYYY-MM-DD`（刻意不走 ISO/UTC，跨时区时不会串日）。 */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `dateKey` 的逆运算：解析为**本地**零点的 `Date`。 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 加减天数。基于 `setDate` 而非毫秒加法，跨夏令时不会少一天。 */
export function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

/**
 * 所在周的周一（本地零点）。
 *
 * `getDay()` 是 0=周日，`(getDay() + 6) % 7` 把它换成「距本周一的天数」，
 * 于是周日落到 6、周一落到 0。
 */
export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}
