let timer: number | undefined

export function scheduleSave(save: () => void, delay = 500): void {
  window.clearTimeout(timer)
  timer = window.setTimeout(save, delay)
}
