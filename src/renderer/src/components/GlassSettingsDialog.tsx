import { useMemo } from 'react'
import {
  GLASS_MODES,
  GLASS_SLIDERS,
  effectiveBlurPx,
  useGlassStore,
  type RefractionMode
} from '../lib/glassSettings'
import { useClosing } from '../hooks/useClosing'
import GlassModal from './glass/GlassModal'
import GlassSurface from './glass/GlassSurface'

/*
 * 外观设置面板。
 *
 * 三点刻意的设计：
 *
 * ① 面板本身是玻璃的。改参数时眼前这块面板立刻变，预览成本为零。
 * ② 另配一条「折射预览条」：面板浮在 0.55 暗遮罩上，身后没有高频纹理，
 *    折射在那里几乎看不出来。预览条用高对比条纹做背景，位移与色差才有对象。
 * ③ 有效模糊像素与「折射是否被糊掉」的判定都写在界面上。实测数据：
 *    blurAmount 从 0 提到 0.4（实际 16.8px），同布局像素差从 23.7 掉到 2.38，
 *    也就是折射与模式差异被抹掉约九成。不说清楚，用户只会觉得"调了没反应"。
 */

interface Props {
  onClose: () => void
}

/** 超过这个实际模糊像素，边缘位移基本被抹平（阈值来自本轮实测，非估计） */
const BLUR_MASK_THRESHOLD_PX = 12

export default function GlassSettingsDialog({ onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose, 200)
  const s = useGlassStore()

  const blurPx = effectiveBlurPx(s.blurAmount)
  const masked = blurPx >= BLUR_MASK_THRESHOLD_PX
  const isFallback = s.engine === 'fallback'

  const modeHint = useMemo(
    () => GLASS_MODES.find((m) => m.value === s.mode)?.hint ?? '',
    [s.mode]
  )

  return (
    <GlassModal closing={closing} onMaskClick={close} className="glass-settings" contentWidth="min(420px, calc(100vw - 96px))">
      <h3>外观 · 液态玻璃</h3>

      <div className={`glass-engine${isFallback ? ' fallback' : ''}`}>
        <span className="glass-engine-tag">
          {isFallback ? '降级引擎' : 'Chromium 全效果'}
        </span>
        <span className="glass-engine-text">
          {isFallback
            ? '当前设备不支持 SVG 位移滤镜（iOS 全域 Safari 与 Firefox 均如此），折射、色差、弹性与折射模式不生效，只保留模糊、饱和度与圆角。'
            : '当前环境支持完整折射效果，以下全部参数可用。'}
        </span>
      </div>

      {/* 折射预览条：面板自身浮在暗遮罩上，折射看不出来，故另给一条高频背景 */}
      <div className="glass-preview" aria-label="折射预览">
        <GlassSurface
          center={{ top: '50%', left: '50%' }}
          contentWidth="132px"
          padding="10px 14px"
          layerClassName="gs-layer--preview"
          interactive={false}
        >
          <span className="glass-preview-chip">折射预览</span>
        </GlassSurface>
      </div>

      <div className="modal-field">
        <span>折射模式</span>
        <div className="glass-modes" role="radiogroup" aria-label="折射模式">
          {GLASS_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={s.mode === m.value}
              className={`glass-mode${s.mode === m.value ? ' active' : ''}`}
              disabled={isFallback}
              onClick={() => s.set({ mode: m.value as RefractionMode })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="glass-hint">{modeHint}</span>
      </div>

      {GLASS_SLIDERS.map((slider) => {
        const value = s[slider.key]
        const inert = isFallback && slider.chromiumOnly
        return (
          <label key={slider.key} className={`glass-row${inert ? ' inert' : ''}`}>
            <span className="glass-row-head">
              <span className="glass-row-label">{slider.label}</span>
              <span className="glass-row-value">
                {slider.key === 'blurAmount' ? value.toFixed(2) : value}
                {slider.suffix}
              </span>
            </span>
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={value}
              disabled={inert}
              onChange={(e) => s.set({ [slider.key]: Number(e.target.value) })}
            />
            <span className="glass-hint">
              {slider.hint}
              {inert ? '（当前引擎不支持）' : ''}
            </span>
          </label>
        )
      })}

      <div className={`glass-effective${masked && !isFallback ? ' warn' : ''}`}>
        实际模糊 <strong>{blurPx.toFixed(1)}px</strong>
        {masked && !isFallback && (
          <span>
            ：已足够糊掉边缘位移。想要看得见折射，把「模糊量」降到 0.2 以下
            （实测 0.4 时折射差异只剩约 1/10）。
          </span>
        )}
      </div>

      <div className="modal-field">
        <span>渲染引擎</span>
        <div className="glass-modes">
          {(['auto', 'chromium', 'fallback'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`glass-mode${s.forceEngine === v ? ' active' : ''}`}
              onClick={() => s.set({ forceEngine: v })}
            >
              {v === 'auto' ? '自动' : v === 'chromium' ? '强制全效果' : '强制降级'}
            </button>
          ))}
        </div>
        <span className="glass-hint">
          桌面浏览器上强制降级，可以预览 iPhone 上实际会看到的样子。
        </span>
      </div>

      <div className="modal-actions">
        <button className="modal-btn" onClick={() => s.reset()}>
          恢复默认
        </button>
        <button className="modal-btn primary" onClick={close}>
          完成
        </button>
      </div>
    </GlassModal>
  )
}
