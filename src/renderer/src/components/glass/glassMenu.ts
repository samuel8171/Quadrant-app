import { useLayoutEffect, useState } from 'react'

/*
 * ============================================================ 右键菜单几何
 *
 * 为什么菜单需要一份显式几何：库的 top/left 是**中心点**语义（见 GlassSurface 的
 * 说明），而菜单的锚点是鼠标位置——要放的却是菜单的**左上角**。两者相差半个尺寸，
 * 而尺寸由内容决定、渲染前拿不到。
 *
 * 与其渲染后测量再回填（多一帧、且会闪），不如把尺寸算出来：
 * 菜单高度 = 行数 × 行高 + 2 × 内边距。
 *
 * ---------- 行高必须从 CSS 读，不能写成常量 ----------
 *
 * 第一版把行高定成 34px 常量，探针立刻量出偏差：移动端媒体查询里有
 * `.context-item { min-height: 48px }`（为了触摸目标），`min-height` 大于
 * `height` 时直接胜出——**菜单行高是按断点变化的**：
 *   桌面 34px ／ 手机 48px
 * 于是菜单顶部偏了 49px（= 48 − 34 的累积误差）。
 *
 * 修法不是"在 TS 里也写一份 48"，那会变成同一个数字的第二处定义。
 * 改为：CSS 用 `--gs-menu-row` 定义行高（各断点各写一次），
 * 组件在 layout effect 里读回同一个变量（layout effect 早于绘制，
 * 因此不会出现先错位再纠正的闪动）。CSS 是唯一来源。
 */

/** 读不到变量时的兜底，同时也是文档里"桌面档"的数值。不应与实际 CSS 分叉。 */
export const MENU_ROW_FALLBACK = 34
/** 玻璃体内边距（四边相同） */
export const MENU_PAD = 6
/** 菜单外宽。各断点一致，故不需要读 CSS */
export const MENU_WIDTH = 176

/**
 * 读回当前断点下的菜单行高。
 *
 * 用 window resize 而不是 matchMedia 监听：后者需要在 TS 里再写一遍断点像素值，
 * 又变成两处定义；resize 触发时重读计算值即可。
 */
export function useMenuRowHeight(): number {
  const [rowH, setRowH] = useState(MENU_ROW_FALLBACK)

  useLayoutEffect(() => {
    const read = (): void => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--gs-menu-row')
        .trim()
      const n = Number.parseFloat(raw)
      setRowH(Number.isFinite(n) && n > 0 ? n : MENU_ROW_FALLBACK)
    }
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  return rowH
}

export interface MenuGeometry {
  center: { top: string; left: string }
  contentWidth: string
  padding: string
}

/**
 * 由「鼠标位置 + 行数 + 行高」推出玻璃体的中心点与内容宽。
 * @param x 菜单左上角目标位置的视口横坐标
 * @param y 菜单左上角目标位置的视口纵坐标
 * @param rows 菜单项数量
 * @param rowH 当前断点下的行高，由 useMenuRowHeight 提供
 */
export function menuGeometry(x: number, y: number, rows: number, rowH: number): MenuGeometry {
  const height = rows * rowH + MENU_PAD * 2
  return {
    center: { top: `${y + height / 2}px`, left: `${x + MENU_WIDTH / 2}px` },
    contentWidth: `${MENU_WIDTH - MENU_PAD * 2}px`,
    padding: `${MENU_PAD}px`
  }
}
