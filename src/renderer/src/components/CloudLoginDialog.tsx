import { FormEvent, useState } from 'react'
import { useClosing } from '../hooks/useClosing'
import { login } from '../lib/cloudSync2'
import GlassModal from './glass/GlassModal'

interface Props {
  onCancel: () => void
  onLoggedIn: () => void
}

export default function CloudLoginDialog({ onCancel, onLoggedIn }: Props): JSX.Element {
  const { closing, close } = useClosing(onCancel)
  const [username, setUsername] = useState('Samuel')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await login(username, password)
      onLoggedIn()
      close()
    } catch {
      setError('用户名或密码错误')
      setBusy(false)
    }
  }

  return (
    <GlassModal closing={closing} onMaskClick={close} className="cloud-login-modal">
      {/*
        表单从原来的「就是 .modal 面板本身」变成玻璃内部的元素：
        玻璃层接管了外壳（背景/圆角/内边距），表单只负责提交语义，
        因此 form 上不需要再挂任何外壳类。
      */}
      <form onSubmit={submit}>
        <h3>登录云端账号</h3>
        <p className="confirm-message">登录一次后由本机记住，用于手机与桌面端之间同步计划数据。</p>
        <label className="modal-field">
          用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className="modal-field">
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="modal-btn" onClick={close} disabled={busy}>
            取消
          </button>
          <button type="submit" className="modal-btn primary" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </div>
      </form>
    </GlassModal>
  )
}
