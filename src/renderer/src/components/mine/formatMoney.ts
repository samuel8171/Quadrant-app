/**
 * 金钱数值的统一显示格式（「我的」页小组件共用）。
 *
 * 时币是整数、娱币以 0.5 为步长，所以非整数补一位小数就够了。
 *
 * **先四舍五入到一位小数再判整**，不是直接判整：额度是 `配置值 × 档位系数` 算出来的，
 * 而 `350 × 0.7` 在二进制里是 `244.99999999999997` —— 直接判整会显示成 "245.0"，
 * 又丑又误导。四舍五入到一位小数先把这点浮点尘埃清掉。
 *
 * 曾经逐字重复在 `BalanceWidget` 与 `PenaltyWidget` 两处（T7 复审记为 Minor），
 * 两张趋势图也要用同一个口径，于是抽成本模块：**这里是唯一定义处**。
 */
export function formatMoney(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
