import { FormEvent, useState } from 'react'
import { login } from '../lib/cloudSync2'

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }): JSX.Element {
  const [username, setUsername] = useState('Samuel')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await login(username, password); onLoggedIn() } catch (e) { setError(e instanceof Error ? '用户名或密码错误' : '登录失败') } finally { setBusy(false) } }
  return <main className="login-shell"><form className="login-card" onSubmit={submit}><div className="brand"><span className="brand-logo"><i/><i/><i/><i/></span><span className="brand-name">象限</span></div><p className="login-subtitle">登录后同步你的计划数据</p><label>用户名<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label><label>密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label><button className="primary-button" disabled={busy}>{busy ? '登录中…' : '登录'}</button>{error && <div className="login-error">{error}</div>}</form></main>
}
