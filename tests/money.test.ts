import { describe, expect, it } from 'vitest'
import { DEFAULT_MONEY_CONFIG, costOfEntry, leisureDelta, nightMinutesOf } from '../src/shared/money'

// ============================================================================
// 共享夹具与辅助函数（后续任务在下方追加用例，请保留本区块在最顶部）
// ============================================================================

// ============================================================================
// Task 2：单条计费与娱币判定
// ============================================================================

describe('costOfEntry', () => {
  it('按实际时长计费：2 小时 × 10 币 = 20', () => {
    expect(costOfEntry({ actualMin: 120, nightMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(20)
  })

  it('深夜倍率只作用于落在深夜区间的那部分分钟数', () => {
    // 120 分钟中 60 分钟在深夜：(60 + 60 × 1.5) / 60 × 10 = 25
    expect(costOfEntry({ actualMin: 120, nightMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(25)
    expect(costOfEntry({ actualMin: 120, nightMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(30)
  })

  it('实际时长为 0 时不产生费用', () => {
    expect(costOfEntry({ actualMin: 0, nightMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(0)
  })
})

describe('nightMinutesOf', () => {
  it('nightMinutesOf：区间左闭右开，恰好 23:30 结束不算深夜', () => {
    expect(nightMinutesOf({ startMin: 1350, actualMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0) // 22:30 + 60
    expect(nightMinutesOf({ startMin: 1350, actualMin: 90 }, DEFAULT_MONEY_CONFIG)).toBe(30) // 22:30 + 90
    expect(nightMinutesOf({ startMin: 1380, actualMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(30) // 23:00 + 60
  })

  it('nightMinutesOf：跨零点到次日清晨', () => {
    // 23:00 开始做 480 分钟 → 落在 [23:30, 06:00) 内的是 390 分钟
    expect(nightMinutesOf({ startMin: 1380, actualMin: 480 }, DEFAULT_MONEY_CONFIG)).toBe(390)
  })

  it('nightMinutesOf：完全在白天为 0', () => {
    expect(nightMinutesOf({ startMin: 600, actualMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(0)
  })
})

describe('leisureDelta', () => {
  it('没做的事扣娱币，不看时长', () => {
    expect(
      leisureDelta({ kind: 'planned', done: false, actualMin: 0, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(-1)
  })

  it('高效完成有奖励，低效完成有惩罚，中间段为 0', () => {
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 60, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0.5)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 120, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(-0.5)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 80, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })

  it('边界：恰好等于计划时长算高效，恰好 1.5 倍不算低效', () => {
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 60, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0.5)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 90, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })

  it('计划外条目不参与娱币（否则随手加一条就能刷币）', () => {
    expect(
      leisureDelta({ kind: 'unplanned', done: true, actualMin: 30, plannedMin: null }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })

  it('plannedMin 为 null 或 0 时返回 0，不产生 NaN', () => {
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 30, plannedMin: null }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 30, plannedMin: 0 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })
})
