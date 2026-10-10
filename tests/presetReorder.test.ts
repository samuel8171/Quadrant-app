import { describe, expect, it } from 'vitest'
import {
  moveWithin,
  orderAfterDrop,
  resolveDropIndex,
  type DropTarget
} from '../src/renderer/src/lib/presetReorder'

/**
 * 预设排序的纯几何部分。
 *
 * 这些用例刻意只喂数字（不碰 DOM）：拖动落点的判定一旦与 `getBoundingClientRect`
 * 纠缠在一起就没法测了，而它恰恰是最容易错一位的地方 —— 上下各差一格在界面上
 * 很难靠肉眼发现。
 */

/** 纵向列表：三张卡，各 100 高，起点 0 / 110 / 220（间距 10）。 */
const column: DropTarget[] = [
  { id: 'a', start: 0, size: 100 },
  { id: 'b', start: 110, size: 100 },
  { id: 'c', start: 220, size: 100 }
]

/** 横向列表：同一组数字换到 x 轴（手机抽屉的排布）。 */
const row: DropTarget[] = [
  { id: 'a', start: 0, size: 100 },
  { id: 'b', start: 110, size: 100 },
  { id: 'c', start: 220, size: 100 }
]

describe('presetReorder · resolveDropIndex', () => {
  it('指针在首卡中线之上 → 插到最前', () => {
    expect(resolveDropIndex(column, 'c', 0)).toBe(0)
    expect(resolveDropIndex(column, 'c', 49)).toBe(0)
  })

  it('判据是**中线**，不是边缘', () => {
    // a 的中线 = 50：50 之前算"插到 a 前面"，50 之后算"插到 a 后面"。
    expect(resolveDropIndex(column, 'c', 49)).toBe(0)
    expect(resolveDropIndex(column, 'c', 51)).toBe(1)
  })

  it('指针越过所有卡片 → 追加到最后', () => {
    // 剔除被拖项后只剩两张，末尾下标是 2。
    expect(resolveDropIndex(column, 'a', 999)).toBe(2)
  })

  it('被拖的那一项不参与比较（它自己不在落点序列里）', () => {
    // 拖 b：剩下的中线是 a=50、c=270。
    expect(resolveDropIndex(column, 'b', 60)).toBe(1)
    expect(resolveDropIndex(column, 'b', 260)).toBe(1)
    expect(resolveDropIndex(column, 'b', 280)).toBe(2)
  })

  it('只有一张卡片（或列表为空）时恒为 0', () => {
    expect(resolveDropIndex([], 'a', 123)).toBe(0)
    expect(resolveDropIndex([{ id: 'a', start: 0, size: 100 }], 'a', 123)).toBe(0)
  })

  it('横向列表用同一套判定（轴向只体现在调用方喂的 start 是谁）', () => {
    expect(resolveDropIndex(row, 'c', 49)).toBe(0)
    // 剔除 c 后剩 a(0..100) 与 b(110..210)：中线 50 / 160。
    expect(resolveDropIndex(row, 'c', 159)).toBe(1)
    expect(resolveDropIndex(row, 'c', 260)).toBe(2)
  })
})

describe('presetReorder · moveWithin', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('上移一位', () => {
    expect(moveWithin(ids, 'c', 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('下移一位', () => {
    expect(moveWithin(ids, 'b', 2)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('目标越界时夹到两端', () => {
    expect(moveWithin(ids, 'a', -5)).toBe(ids)
    expect(moveWithin(ids, 'd', 99)).toBe(ids)
  })

  it('已在本端（首位上移 / 末位下移）时返回原数组对象', () => {
    expect(moveWithin(ids, 'a', 0)).toBe(ids)
    expect(moveWithin(ids, 'd', 3)).toBe(ids)
    expect(moveWithin(ids, 'a', -1)).toBe(ids)
  })

  it('不存在的 id 原样返回', () => {
    expect(moveWithin(ids, 'ghost', 2)).toBe(ids)
  })
})

describe('presetReorder · orderAfterDrop', () => {
  const ids = ['a', 'b', 'c']

  it('与 resolveDropIndex 的口径一致：index 是**剔除被拖项之后**的插入位', () => {
    // 拖 c 到最前
    expect(orderAfterDrop(ids, 'c', 0)).toEqual(['c', 'a', 'b'])
    // 拖 a 到最后
    expect(orderAfterDrop(ids, 'a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('落在原位时顺序不变', () => {
    expect(orderAfterDrop(ids, 'b', 1)).toEqual(['a', 'b', 'c'])
  })

  it('越界 index 被夹住', () => {
    expect(orderAfterDrop(ids, 'c', 99)).toEqual(['a', 'b', 'c'])
    expect(orderAfterDrop(ids, 'a', -3)).toEqual(['a', 'b', 'c'])
  })

  it('两个函数的合成结果与 moveWithin 一致（拖拽与上下移同一套语义）', () => {
    for (const id of ids) {
      for (let i = 0; i <= ids.length; i++) {
        expect(orderAfterDrop(ids, id, i)).toEqual(moveWithin(ids, id, i))
      }
    }
  })
})
