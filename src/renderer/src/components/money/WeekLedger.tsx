import type { WeekSettlement } from '../../../../shared/types'
import { weekSummaryLines } from '../../../../shared/money'

interface Props {
  week: WeekSettlement
}

/**
 * 复盘页的「最近结算周」区块（spec §8）—— 与三档滑动条**并列**，不替代。
 *
 * **标题刻意不叫「本周账本」**：`latestSettledWeek` 取的是 `weeks.at(-1)`，而周滚动
 * 只结算到**上一个已结束的周**（本周还没结束、不结算）。于是周日打开时，这里显示的是
 * **上一周**的结算，叫「本周」会让人把上周的账当成本周的。spec §8 的原话是「来自最新的
 * `WeekSettlement`」——代码本来就对，误导的是标题，所以改标题、保留日期区间。
 *
 * **位置在调用方（`ReviewPage`）决定**：它被渲染在滑动条**之上**，且只在
 * `money.enabled === true` 且存在周结算时才渲染（见 `latestSettledWeek`）。
 * 因此组件本身不需要「关闭态」分支 —— 关闭时它根本不进树，这也正是
 * spec §4.3 第 2 条要求的不渲染。
 *
 * **数字全部来自 `weekSummaryLines(week)`，与导出正文同源**：
 * `composeReviewText` 也调这个函数，所以屏幕上看到的每一行与导出 Word 里追加的
 * 每一行逐字相同，不存在「界面一个数、导出另一个数」的第二套格式。
 *
 * **刻意不玻璃化**：复用 `.money-widget` 系列普通面板（背景 + 边框 + 圆角），
 * 不包 `GlassSurface`、不加 `backdrop-filter`（spec §12.4）。`marginBottom` 用
 * 内联样式而不新增 CSS 类：本任务只允许改这四个文件（见 task brief），
 * 而重用一个既有的面板类已经足够。
 *
 * 自动结论 `notes` 单独放在页脚，与上面的固定统计行分开：它是结算算出来的**解读**，
 * 不是原始数字。
 */
export default function WeekLedger({ week }: Props): JSX.Element {
  const lines = weekSummaryLines(week)
  return (
    <section
      className="money-widget week-ledger"
      aria-label="最近结算周"
      style={{ marginBottom: 26 }}
    >
      <div className="money-widget-head">
        <h2 className="money-widget-title">最近结算周</h2>
        <p className="money-widget-subtitle">
          {week.weekStart} ~ {week.weekEnd}
        </p>
      </div>
      <div className="money-widget-body">
        {lines.map((line) => (
          <p key={line} className="money-widget-subtitle">
            {line}
          </p>
        ))}
      </div>
      {week.notes.length > 0 && (
        <div className="money-widget-body">
          {week.notes.map((note) => (
            <p key={note} className="money-widget-foot">
              {note}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
