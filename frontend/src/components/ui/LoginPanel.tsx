import { useState } from 'react';
import { authLogin, authRegister } from '../../lib/lifeApi';
import { setAuthSession } from '../../lib/lifeAuth';
import { useGameStore } from '../../store/useGameStore';

export function LoginPanel({ initialInvite = '' }: { initialInvite?: string }) {
  const applyLifeState = useGameStore(s => s.applyLifeState);
  const initAgents = useGameStore(s => s.initAgents);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInvite.toUpperCase());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState(false);

  const submit = async () => {
    setError('');
    const name = username.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
      setError('用户名须为 3-20 位字母、数字或下划线');
      return;
    }
    if (mode === 'register' && password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await authLogin(name, password)
        : await authRegister(name, password, displayName.trim(), inviteCode.trim());
      if (!res.ok || !res.token || !res.account) {
        setError(res.error || '操作失败');
        return;
      }
      if ('invite_message' in res && res.invite_message) {
        sessionStorage.setItem('tl_flash_invite', res.invite_message);
      }
      setAuthSession(res.token, res.account);
      if (res.state) applyLifeState(res.state);
      initAgents();
      setAuthed(true);
      window.location.reload();
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  if (authed) return null;

  return (
    <div className="login-overlay">
      <div className="login-box">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 36 }}>🐧</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#3d3530', margin: '8px 0 4px' }}>交易人生</h1>
          <p style={{ fontSize: 13, color: '#8a7e72' }}>登录你的账户，开始 Agent 生活</p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className="ui-btn" style={{ flex: 1, opacity: mode === 'login' ? 1 : 0.55 }}
            onClick={() => { setMode('login'); setError(''); }}>登录</button>
          <button className="ui-btn" style={{ flex: 1, opacity: mode === 'register' ? 1 : 0.55 }}
            onClick={() => { setMode('register'); setError(''); }}>注册</button>
        </div>

        <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', marginBottom: 4 }}>用户名</label>
        <input className="login-input" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="3-20 位字母、数字或下划线" autoComplete="username" />

        {mode === 'register' && (
          <>
            <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', margin: '10px 0 4px' }}>昵称（可选）</label>
            <input className="login-input" value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="显示名称" />
            <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', margin: '10px 0 4px' }}>邀请码（可选 · 双方得积分）</label>
            <input className="login-input" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="6 位邀请码" maxLength={8} />
          </>
        )}

        <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', margin: '10px 0 4px' }}>密码</label>
        <input className="login-input" type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          onKeyDown={e => e.key === 'Enter' && submit()} />

        {error && <p style={{ color: '#e55', fontSize: 12, marginTop: 10 }}>{error}</p>}

        <button className="ui-btn" style={{ width: '100%', marginTop: 16, padding: '10px 0' }}
          disabled={busy || !username.trim() || !password} onClick={submit}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建账户'}
        </button>

        <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
          用户名仅限英文字母、数字、下划线（3-20 位）<br />
          每个账户独立积分、任务与自定义 Agent
        </p>
      </div>
    </div>
  );
}
