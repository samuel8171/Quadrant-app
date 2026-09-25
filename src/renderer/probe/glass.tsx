/*
 * liquid-glass-react 渲染验证页（开发期探针，不进构建产物）。
 *
 * 存在的理由：折射是否真的渲染出来，**读代码判不了**。
 * 库把位移滤镜挂在内联 `filter: url(#<useId>)` 上，而 React 的 useId 会产出
 * 含冒号的 id（`:r0:`），作为 CSS url() 片段能否解析到元素、以及
 * `filter` 叠加在 `backdrop-filter` 之上在 Chromium 里到底合成成什么，
 * 都只能靠像素说话。
 *
 * 判据：同一个布局下 ds=0 与 ds=118 两张截图的**玻璃内部**像素必须有差异
 * —— 位移会把身后的条纹拉弯。若两图完全一致，说明折射没生效。
 *
 * 参数：
 *   ?ds=<number>       位移强度，默认 118
 *   ?blur=<number>     模糊量，默认 0.4（库的语义：实际 px = 4 + blur*32）
 *   ?sat=<number>      饱和度百分比，默认 140
 *   ?ab=<number>       色差强度，默认 3
 *   ?el=<number>       弹性，默认 0.1
 *   ?cr=<number>       圆角 px，默认 32
 *   ?mode=<string>     standard | polar | prominent | shader
 */
import { createRoot } from 'react-dom/client'
import LiquidGlass from 'liquid-glass-react'

const q = new URLSearchParams(location.search)
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d)

type Mode = 'standard' | 'polar' | 'prominent' | 'shader'
const mode = (q.get('mode') ?? 'standard') as Mode

const settings = {
  displacementScale: num('ds', 118),
  blurAmount: num('blur', 0.4),
  saturation: num('sat', 140),
  aberrationIntensity: num('ab', 3),
  elasticity: num('el', 0.1),
  cornerRadius: num('cr', 32),
  mode
}

function Spike(): JSX.Element {
  return (
    <>
      {/*
        高频条纹是刻意的：折射的本质是「把身后的像素按位移贴图搬运」，
        身后是纯色时搬完还是同一个颜色，差异为零。
        本项目主界面正是纯深灰（--bg #0f1115），所以玻璃在空白处的折射
        本来就看不见——这条约束必须靠真实内容的纹理来验证。
      */}
      <div className="spike-bg" />
      <div className="spike-labels">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} style={{ top: 40 + i * 44 }}>
            参考文字 REFERENCE {String(i).padStart(2, '0')} · 用于观察边缘位移与色差
          </span>
        ))}
      </div>

      <div className="spike-mark spike-mark-tl" />
      <div className="spike-mark spike-mark-br" />

      {/*
        不给 width：验证「绝对定位的根节点 = shrink-to-fit」这一假设。
        若成立，根节点矩形会与 .glass 完全相等，边框层与位移贴图自动对齐，
        封装层就不需要手算宽度（否则每个浮层都要把内容宽 + 内边距算两遍）。
      */}
      <LiquidGlass
        style={{ position: 'absolute', top: 300, left: 450 }}
        padding="24px 32px"
        displacementScale={settings.displacementScale}
        blurAmount={settings.blurAmount}
        saturation={settings.saturation}
        aberrationIntensity={settings.aberrationIntensity}
        elasticity={settings.elasticity}
        cornerRadius={settings.cornerRadius}
        mode={settings.mode}
      >
        {/*
          文本刻意**不含参数值**、且宽度写死。
          第一版把 ds/blur/mode 打进文案里，结果各场景文字长度不同 →
          .glass 的 inline-flex 宽度随之变化 → 有时换行（h 70→93），
          两组截图的几何就对不上了，像素比对失去意义。
        */}
        <div className="spike-content">玻璃面板 SPOT</div>
      </LiquidGlass>
    </>
  )
}

const style = document.createElement('style')
style.textContent = `
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: system-ui, sans-serif; }
  .spike-bg {
    position: fixed; inset: 0;
    background:
      repeating-linear-gradient(45deg, #101722 0 7px, #dce9ff 7px 14px),
      repeating-linear-gradient(-45deg, rgba(255,64,64,0.55) 0 5px, transparent 5px 40px),
      radial-gradient(60% 60% at 20% 25%, rgba(80,160,255,0.9), transparent 70%),
      radial-gradient(50% 50% at 82% 78%, rgba(180,90,255,0.9), transparent 70%);
    background-blend-mode: normal, screen, normal, normal;
  }
  .spike-labels { position: fixed; inset: 0; }
  .spike-labels span {
    position: absolute; left: 24px; font-size: 15px; font-weight: 600;
    color: #eaf2ff; text-shadow: 0 1px 2px rgba(0,0,0,0.9); white-space: nowrap;
  }
  .spike-mark { position: fixed; width: 14px; height: 14px; background: #ff2d2d; }
  .spike-mark-tl { top: 0; left: 0; }
  .spike-mark-br { bottom: 0; right: 0; }
  /* 覆盖库内联的 font: 500 20px/1 —— 否则弹窗文字会被强制成 20px。
     宽度写死是关键：库的 glassSize 量的是**根节点**矩形，而 .glass 是
     inline-flex（随内容收缩），两者不等宽时边框层就会与玻璃体错位。 */
  .spike-content { font: 600 16px/1.4 system-ui; color: #fff; width: 300px; }
`
document.head.appendChild(style)

createRoot(document.getElementById('root') as HTMLElement).render(<Spike />)

// 供探针读取：确认库实际拿到的参数与自检结果
;(window as unknown as Record<string, unknown>).__spike = { settings, q: Object.fromEntries(q) }
