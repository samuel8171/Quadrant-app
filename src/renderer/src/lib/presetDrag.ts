/** HTML5 DnD 载荷类型：把预设卡拖到时间轴时携带的键。 */
export const PRESET_DRAG_MIME = 'application/x-preset-id'

/**
 * 正在被拖动的预设 id。
 *
 * 为什么需要这个模块级变量：`dragover` 阶段出于安全考虑**读不到 `dataTransfer`
 * 的内容**（只能看到类型列表），而落点预览必须在 `dragover` 时就画出正确的高度
 * 与颜色。所以在 `dragstart` 把 id 记在这里，`dragover` 用它反查预设。
 */
let draggingPresetId: string | null = null

export function beginPresetDrag(id: string): void {
  draggingPresetId = id
}

export function endPresetDrag(): void {
  draggingPresetId = null
}

export function getDraggingPresetId(): string | null {
  return draggingPresetId
}

/** `dataTransfer` 里是否带着本应用的预设载荷——这是 `dragover` 唯一能读到的信息。 */
export function carriesPresetDrag(types: readonly string[]): boolean {
  for (const type of types) {
    if (type === PRESET_DRAG_MIME) return true
  }
  return false
}
