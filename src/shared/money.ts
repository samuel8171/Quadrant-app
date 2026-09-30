import type { MoneyConfig } from './types'

/**
 * 计费与结算参数的默认值（spec 第 11 节）。
 *
 * 这是这些常量的**单一真源**：`dataCodec.normalizeMoney` 的非法值回退、
 * 开启开关时写入的初始 `config`，都应引用这里而不是各自重抄一遍。
 */
export const DEFAULT_MONEY_CONFIG: MoneyConfig = {
  weeklyTC: 350,
  tcPerHour: 10,
  nightStartMin: 1410,
  nightEndMin: 360,
  nightMultiplier: 1.5,
  minCapRatio: 0.2,
  weeklyLT: 10,
  rewardLT: 0.5,
  penaltyLT: 0.5,
  missPenaltyLT: 1
}
