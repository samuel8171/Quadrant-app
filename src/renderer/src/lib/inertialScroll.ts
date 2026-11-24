const VELOCITY_SCALE = 0.16
const FRICTION = 0.85
const MIN_VELOCITY = 0.3

function findScrollable(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el
  while (cur) {
    const style = window.getComputedStyle(cur)
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      cur.scrollHeight > cur.clientHeight + 1
    ) {
      return cur
    }
    cur = cur.parentElement
  }
  return null
}

export function installInertialScroll(): () => void {
  const velocity = new WeakMap<HTMLElement, number>()
  const raf = new WeakMap<HTMLElement, number>()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  const step = (el: HTMLElement): void => {
    if (reducedMotion.matches || !el.isConnected) {
      velocity.delete(el)
      raf.delete(el)
      return
    }
    const max = el.scrollHeight - el.clientHeight
    let v = velocity.get(el) ?? 0
    el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + v * VELOCITY_SCALE))
    if (el.scrollTop <= 0 || el.scrollTop >= max) v = 0
    v *= FRICTION
    velocity.set(el, v)
    if (Math.abs(v) < MIN_VELOCITY) {
      velocity.set(el, 0)
      raf.delete(el)
      return
    }
    raf.set(el, requestAnimationFrame(() => step(el)))
  }

  const onWheel = (e: WheelEvent): void => {
    const target = e.target as HTMLElement | null
    if (!target) return
    if (reducedMotion.matches || target.closest('.quadrant-viewport, input, textarea, select')) return
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const el = findScrollable(target)
    if (!el) return
    e.preventDefault()
    const delta =
      e.deltaMode === 1
        ? e.deltaY * 16
        : e.deltaMode === 2
          ? e.deltaY * window.innerHeight
          : e.deltaY
    velocity.set(el, (velocity.get(el) ?? 0) + delta)
    if (!raf.has(el)) {
      raf.set(el, requestAnimationFrame(() => step(el)))
    }
  }

  window.addEventListener('wheel', onWheel, { passive: false, capture: true })
  return () => {
    window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }
}
