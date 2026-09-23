# PWA 高度与导航条几何探针报告

- 地址：http://127.0.0.1:5199/probe.html?page=weekly&sidebar=1
- iOS 假定安全区：top 59px / bottom 34px（iPhone 14 Pro 量级）

> **验证边界**：安全区由注入样式伪造（桌面 `env()` 恒为 0）。判定 1
> 只能证明「`--app-height` 被正确应用且等于全屏高」，**证明不了**
> 「不修就会坏」——iOS standalone 少算 `env(safe-area-inset-top)` 是
> WebKit 特有行为，桌面 Chromium 不重现（已把 theme.css 还原到修复前
> 实测过，探针照样全绿）。真机验收不可替代。

## iPhone 14 Pro（393×852）

| 场景 | --app-height | .app 实测高 | 导航条内容高 | 导航条底距 |
| --- | --- | --- | --- | --- |
| Safari 标签页 | `100dvh` | 852.0px | 44.0px | 34.0px |
| PWA standalone | `100lvh` | 852.0px | 44.0px | 34.0px |

- ✅ standalone 高度正确：852.0px = 全屏高
- ✅ 标签页 下导航条内容高 44.0px ≥ 44px
- ✅ standalone 下导航条内容高 44.0px ≥ 44px
- ✅ standalone 下导航条避开 home indicator（底距 34.0px）

## iPhone SE（375×667）

| 场景 | --app-height | .app 实测高 | 导航条内容高 | 导航条底距 |
| --- | --- | --- | --- | --- |
| Safari 标签页 | `100dvh` | 667.0px | 44.0px | 34.0px |
| PWA standalone | `100lvh` | 667.0px | 44.0px | 34.0px |

- ✅ standalone 高度正确：667.0px = 全屏高
- ✅ 标签页 下导航条内容高 44.0px ≥ 44px
- ✅ standalone 下导航条内容高 44.0px ≥ 44px
- ✅ standalone 下导航条避开 home indicator（底距 34.0px）

---

**结论：全部通过。**
