import { useState, useEffect, useRef } from 'react';
import { authLogin, authRegister } from '../../lib/lifeApi';
import { setAuthSession } from '../../lib/lifeAuth';
import { useGameStore } from '../../store/useGameStore';
import { fetchTicker } from '../../lib/api';
import { PokerDemoHook } from './PokerDemoHook';
import { TradingDemoHook } from './TradingDemoHook';
import { TradingArenaPublicHook } from './TradingArenaPublicHook';

const TICKER_KEYS = ['BTCUSDT', 'ETHUSDT', 'XAUUSDT'] as const;

export function LoginPanel({ initialInvite = '' }: { initialInvite?: string }) {
  const applyLifeState = useGameStore(s => s.applyLifeState);
  const initAgents = useGameStore(s => s.initAgents);
  const [mode, setMode] = useState<'login' | 'register'>(initialInvite.trim() ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInvite.toUpperCase());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [showDemos, setShowDemos] = useState(false);
  const [ticker, setTicker] = useState<Record<string, number>>({});
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = () => fetchTicker().then(setTicker).catch(() => {});
    load();
    const id = setInterval(load, 12000);
    return () => clearInterval(id);
  }, []);

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
      if (mode === 'register') {
        sessionStorage.removeItem('tl_onboarding_done');
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

  const fmtPrice = (key: string, v: number) => {
    if (key === 'XAUUSDT') return `$${v.toFixed(2)}`;
    return `$${Math.round(v).toLocaleString()}`;
  };

  return (
    <div className="login-overlay">
      <div className="login-box login-box-scroll">
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 36 }}>🐧</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#3d3530', margin: '8px 0 4px' }}>交易人生</h1>
          <p style={{ fontSize: 13, color: '#8a7e72' }}>AI 模拟交易 + Agent 生活 · 先爽再深玩</p>
        </div>

        <div style={{
          display: 'flex', gap: 8, marginBottom: 12, padding: '6px 10px',
          background: '#faf6ef', borderRadius: 8, border: '1px solid #ebe4d8',
          fontSize: 10, color: '#7a6e62', flexWrap: 'wrap', justifyContent: 'center',
        }}>
          <span style={{ fontWeight: 700, color: '#5c4a32' }}>📈 模拟盘实时</span>
          {TICKER_KEYS.map(k => (
            <span key={k} style={{ fontFamily: 'monospace' }}>
              {k.replace('USDT', '')} {ticker[k] != null ? fmtPrice(k, ticker[k]) : '—'}
            </span>
          ))}
        </div>

        {/* 登录表单优先 — 移动端不被试玩区块挤出屏幕 */}
        <form
          onSubmit={e => { e.preventDefault(); void submit(); }}
          style={{ marginBottom: 12 }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className="ui-btn" style={{ flex: 1, opacity: mode === 'login' ? 1 : 0.55 }}
              onClick={() => { setMode('login'); setError(''); passwordRef.current?.focus(); }}>
              登录
            </button>
            <button type="button" className="ui-btn" style={{ flex: 1, opacity: mode === 'register' ? 1 : 0.55 }}
              onClick={() => { setMode('register'); setError(''); }}>
              注册
            </button>
          </div>

          <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', marginBottom: 4 }}>用户名</label>
          <input className="login-input" value={username} onChange={e => setUsername(e.target.value)}
            placeholder="3-20 位字母、数字或下划线" autoComplete="username" />

          {mode === 'register' && (
            <>
              <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', margin: '10px 0 4px' }}>昵称（可选）</label>
              <input className="login-input" value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="显示名称 · 将作为你的 Agent 名字" />
              <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', margin: '10px 0 4px' }}>邀请码（可选）</label>
              <input className="login-input" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
                placeholder="6 位邀请码" maxLength={8} />
            </>
          )}

          <label style={{ fontSize: 12, color: '#7a6e62', display: 'block', margin: '10px 0 4px' }}>密码</label>
          <input ref={passwordRef} className="login-input" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />

          {error && <p style={{ color: '#e55', fontSize: 12, marginTop: 10 }}>{error}</p>}

          <button type="submit" className="ui-btn login-submit-btn"
            disabled={busy || !username.trim() || !password}>
            {busy ? '请稍候…' : mode === 'register' ? '🐧 注册 · 30 秒养 Agent' : '登录进入游戏'}
          </button>

          <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 10, lineHeight: 1.5, textAlign: 'center' }}>
            {mode === 'login'
              ? '上方「登录」为切换模式 · 填好密码后点「登录进入游戏」'
              : '注册后自动创建娱乐 Agent · 模拟盘同步开启'}
          </p>
        </form>

        <button type="button" className="ui-btn" style={{
          width: '100%', fontSize: 12, padding: '8px 0', marginBottom: showDemos ? 10 : 0,
          background: '#faf6ef', borderColor: '#ebe4d8',
        }} onClick={() => setShowDemos(v => !v)}>
          {showDemos ? '▲ 收起试玩' : '▼ 未登录试玩（模拟盘 / 竞技 / 德州）'}
        </button>

        {showDemos && (
          <>
            <TradingDemoHook />
            <TradingArenaPublicHook />
            <PokerDemoHook />
          </>
        )}
      </div>
    </div>
  );
}
