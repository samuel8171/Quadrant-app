/**
 * 定时器宿主。
 *
 * 通过 `globalThis` 显式取用，而不是直接写 `window.setTimeout`：这个模块会被
 * Node 环境（单元测试经 appStore 间接引用）加载，那里没有 DOM lib，直接引用
 * `window` 过不了类型检查。顺带的好处是替身只需替换全局定时器。
 */
interface TimerHost {
  setTimeout(handler: () => void, timeout?: number): unknown
  clearTimeout(handle: unknown): void
}

function timers(): TimerHost {
  return globalThis as unknown as TimerHost
}

let timer: unknown
let pending: (() => void) | null = null

export function scheduleSave(save: () => void, delay = 500): void {
  timers().clearTimeout(timer)
  pending = save
  timer = timers().setTimeout(() => {
    pending = null
    timer = undefined
    save()
  }, delay)
}

/**
 * 立刻执行挂起的保存。
 *
 * 防抖窗口是 500ms，而浏览器/Electron 关闭页面时不会等待定时器——用户在
 * 最后半秒内的编辑会直接丢掉。`pagehide` / `beforeunload` / 主进程 `before-quit`
 * 都需要先调用一次这里。
 */
export function flushPendingSave(): void {
  if (!pending) return
  timers().clearTimeout(timer)
  const run = pending
  pending = null
  timer = undefined
  run()
}

/** 是否有待写入的改动。 */
export function hasPendingSave(): boolean {
  return pending !== null
}
