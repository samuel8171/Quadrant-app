# 安全区避让与滑块投影实测

生成时间：2026/9/23 14:15:12

伪造 `--safe-top = 47px`（iPhone 灵动岛状态栏典型值）。

## 问题 2：顶部内容是否随安全区下移

| 页面 | 顶部元素 | 安全区=0 时 top | 安全区=47px 时 top | 位移 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 四象限 | `.page-header` | 12 | 59 | +47 | ✅ 恰好下移 47px |
| 周计划 | `.page-header, .day-topbar` | 12 | 59 | +47 | ✅ 恰好下移 47px |
| 目标 | `.page-header` | 12 | 59 | +47 | ✅ 恰好下移 47px |
| 复盘 | `.review-header` | 12 | 59 | +47 | ✅ 恰好下移 47px |

## 问题 4：复盘滑块投影

- `box-shadow`: `none`
- `border`: `2px solid rgb(15, 17, 21)`
- `border-radius`: `50%`

✅ 已无投影（`box-shadow: none`），只剩 2px 描边。
