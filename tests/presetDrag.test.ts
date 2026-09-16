import { afterEach, describe, expect, it } from 'vitest'
import {
  PRESET_DRAG_MIME,
  beginPresetDrag,
  carriesPresetDrag,
  endPresetDrag,
  getDraggingPresetId
} from '../src/renderer/src/lib/presetDrag'

afterEach(() => endPresetDrag())

describe('预设拖放登记簿', () => {
  it('MIME 与 dragstart 写入的键一致', () => {
    expect(PRESET_DRAG_MIME).toBe('application/x-preset-id')
  })

  it('dragstart 登记、dragend 清理', () => {
    expect(getDraggingPresetId()).toBeNull()
    beginPresetDrag('p1')
    expect(getDraggingPresetId()).toBe('p1')
    endPresetDrag()
    expect(getDraggingPresetId()).toBeNull()
  })

  it('dragover 只能看到类型列表，据此判断是否接管这次拖放', () => {
    expect(carriesPresetDrag([PRESET_DRAG_MIME])).toBe(true)
    expect(carriesPresetDrag(['text/plain', PRESET_DRAG_MIME])).toBe(true)
    // 从桌面拖进来一个文件时不应被时间轴接管（浏览器要保持"不可放置"反馈）
    expect(carriesPresetDrag(['Files'])).toBe(false)
    expect(carriesPresetDrag([])).toBe(false)
  })
})
