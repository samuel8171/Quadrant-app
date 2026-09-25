import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useGlassStore } from '../lib/glassSettings'

/*
 * ============================================================ 顶层错误边界
 *
 * 2026-09-24 补。此前全应用没有任何错误边界，后果不是"某个组件坏了"，
 * 而是**整个窗口一片空白**：
 *
 *   用户在「外观」里把折射模式切成 Shader
 *     → 库在挂载 effect 里对 `display:none` 的底部 dock 量到 0×0
 *     → `createImageData(0, ·)` 抛 `IndexSizeError`
 *     → 异常无人接住，React 卸载整棵树
 *     → 只剩 body 的底色，看起来就是"打不开了"
 *   设置又是持久化的，所以下次启动照旧 —— 打不开就成了永久状态。
 *
 * 修根因是 `GlassSurface` 的 `laid` 闸门（见该文件 ④），而这一层解决的是
 * **放大器**：任何一处渲染期异常都不该让用户面对一个没有任何出口的空白窗口。
 *
 * 兜底界面刻意不依赖任何外部样式表（全部内联）：CSS 本身出问题时它还得能显示。
 * 那个「重置外观设置」按钮正是针对这一类事故 —— 一个持久化的坏数值把应用锁死时，
 * 用户需要一条不用开 DevTools 就能走出来的路。
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 与主题同一套深色基调，但写成内联常量：这份界面必须在 CSS 失效时也能看 */
const S = {
  wrap: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#14171d',
    color: '#e8eaee',
    font: '400 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
    overflow: 'auto'
  },
  card: {
    width: '100%',
    maxWidth: '640px',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '16px',
    padding: '24px',
    background: 'rgba(255,255,255,0.04)'
  },
  h1: { margin: '0 0 8px', font: '600 18px/1.4 system-ui, sans-serif' },
  p: { margin: '0 0 16px', color: 'rgba(232,234,238,0.72)' },
  pre: {
    margin: '0 0 16px',
    padding: '12px 14px',
    maxHeight: '220px',
    overflow: 'auto',
    borderRadius: '10px',
    background: 'rgba(0,0,0,0.34)',
    color: '#ffb4b4',
    font: '400 12px/1.55 ui-monospace, Consolas, monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: '10px' },
  btn: {
    padding: '9px 16px',
    minHeight: '36px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: '#e8eaee',
    font: '500 13px/1 system-ui, sans-serif',
    cursor: 'pointer'
  },
  btnPrimary: {
    padding: '9px 16px',
    minHeight: '36px',
    borderRadius: '10px',
    border: '1px solid rgba(120,170,255,0.5)',
    background: 'rgba(90,140,255,0.22)',
    color: '#e8eaee',
    font: '500 13px/1 system-ui, sans-serif',
    cursor: 'pointer'
  }
} as const

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 落一条完整记录：用户按 F12 就能看到组件栈，不必让他复述现象
    console.error('[象限] 渲染异常，已降级为恢复界面', error, info.componentStack)
  }

  /**
   * 把外观设置恢复成默认值再重载。
   *
   * 走 store 的 `reset()` 而不是直接删 localStorage 键：reset 同时会
   * 重新写盘并同步根节点上的 CSS 变量，语义与设置面板里的「恢复默认」完全一致，
   * 不在这里另开一条只有错误边界才知道的旁路。
   */
  private resetAppearance = (): void => {
    try {
      useGlassStore.getState().reset()
    } catch {
      // 重置失败也要让用户能重载，不能把出口也堵上
    }
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <h1 style={S.h1}>界面出错了，已停在这张恢复页</h1>
          <p style={S.p}>
            为避免把错误状态继续画下去，界面已整体停下。数据没有受影响
            （计划数据在本地文件里，弹窗与外观都是纯显示层）。
            <br />
            如果这个错误是在调过「外观」之后出现的，直接点下面第二个按钮。
          </p>
          <pre style={S.pre}>
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
          <div style={S.row}>
            <button type="button" style={S.btn} onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button type="button" style={S.btnPrimary} onClick={this.resetAppearance}>
              重置外观设置并重载
            </button>
          </div>
        </div>
      </div>
    )
  }
}
