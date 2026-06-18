import { WalletIcon, SparklesIcon } from '@heroicons/react/24/solid';
import {
  ChartBarIcon, GiftIcon, TrophyIcon, Cog6ToothIcon, QuestionMarkCircleIcon, PaintBrushIcon,
} from '@heroicons/react/24/outline';
import {
  ChartBarIcon as ChartBarSolid, GiftIcon as GiftSolid, TrophyIcon as TrophySolid,
  Cog6ToothIcon as CogSolid, QuestionMarkCircleIcon as HelpSolid,
  PaintBrushIcon as PaintBrushSolid,
} from '@heroicons/react/24/solid';
import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { AppIcon, NavIcon } from '../icons/AppIcon';
import { getStoredAccount, clearAuthSession } from '../../lib/lifeAuth';
import { authLogout } from '../../lib/lifeApi';

const NAV_BTNS = [
  { id: 'market', label: '行情', outline: ChartBarIcon, solid: ChartBarSolid, modal: 'market' as const },
  { id: 'tasks', label: '任务', outline: GiftIcon, solid: GiftSolid, modal: 'tasks' as const },
  { id: 'shop', label: '商城', outline: GiftIcon, solid: GiftSolid, modal: 'shop' as const },
  { id: 'scene', label: '🎨场景', outline: PaintBrushIcon, solid: PaintBrushSolid, modal: 'scene' as const },
  { id: 'rank', label: '排行', outline: TrophyIcon, solid: TrophySolid, modal: 'rank' as const },
  { id: 'settings', label: '设置', outline: Cog6ToothIcon, solid: CogSolid, modal: 'settings' as const },
  { id: 'help', label: '帮助', outline: QuestionMarkCircleIcon, solid: HelpSolid, modal: 'help' as const },
];

export function TopNavBar() {
  const ticker = useGameStore(s => s.ticker);
  const overview = useGameStore(s => s.overview);
  const userPortfolio = useGameStore(s => s.userPortfolio);
  const points = useGameStore(s => s.points);
  const dailyAllowanceClaimed = useGameStore(s => s.dailyAllowanceClaimed);
  const dailyAllowanceAmount = useGameStore(s => s.dailyAllowanceAmount);
  const claimDailyAllowance = useGameStore(s => s.claimDailyAllowance);
  const openModal = useGameStore(s => s.openModal);
  const [hover, setHover] = useState<string | null>(null);

  const account = getStoredAccount();
  const pnl = overview.total_pnl || 0;
  const capital = overview.total_capital || 0;
  const pnlPct = overview.total_pnl_pct ?? (capital ? (pnl / capital * 100) : 0);

  const logout = async () => {
    await authLogout().catch(() => {});
    clearAuthSession();
    window.location.reload();
  };

  return (
    <header className="top-nav">
      <div className="top-nav-brand">
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="brand-mark" aria-hidden>🐧</span>
          <span style={{ color: '#3d3530' }}>交易人生</span>
        </div>
      </div>

      <div className="top-nav-stats">
        <div className="stat-card">
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <AppIcon icon={WalletIcon} size="mini" color="gold" /> 模拟总资产
          </div>
          <div className="value mono gold">${Math.round(capital).toLocaleString()}</div>
          {userPortfolio && (
            <div style={{ fontSize: 9, color: '#9a8b7a', marginTop: 2 }}>现金 ${Math.round(userPortfolio.cash).toLocaleString()}</div>
          )}
        </div>
        <div className="stat-card">
          <div className="label">累计盈亏</div>
          <div className={`value mono ${pnl >= 0 ? 'profit' : 'loss'}`}>
            {pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">收益率</div>
          <div className={`value mono ${pnlPct >= 0 ? 'profit' : 'loss'}`}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        </div>
        <div className="stat-card" style={{ minWidth: 100 }}>
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <AppIcon icon={SparklesIcon} size="mini" color="gold" /> 积分
          </div>
          <div className="value mono gold" style={{ fontSize: 14 }}>{points.toLocaleString()}</div>
          {!dailyAllowanceClaimed && (
            <button className="ui-btn" style={{ marginTop: 4, fontSize: 10, padding: '2px 6px', width: '100%' }}
              onClick={() => void claimDailyAllowance()}>
              领 {dailyAllowanceAmount}
            </button>
          )}
        </div>
        <div className="stat-card" style={{ minWidth: 80 }}>
          <div className="label">BTC</div>
          <div className="value mono" style={{ fontSize: 13 }}>{ticker.BTCUSDT ? '$' + Math.round(ticker.BTCUSDT).toLocaleString() : '--'}</div>
        </div>
      </div>

      <div className="top-nav-actions">
        {NAV_BTNS.map(b => (
          <button
            key={b.id}
            className="ui-btn nav-icon-btn"
            onClick={() => openModal(b.modal)}
            onMouseEnter={() => setHover(b.id)}
            onMouseLeave={() => setHover(null)}
          >
            <NavIcon outline={b.outline} solid={b.solid} hovered={hover === b.id} size="nav" />
            <span className="nav-icon-label">{b.label}</span>
          </button>
        ))}
        <a href="/trading/" className="ui-btn" style={{ textDecoration: 'none', marginLeft: 4, fontSize: 11 }}>Dashboard</a>
        {account && (
          <button className="ui-btn" onClick={logout} title={`${account.username} · 退出登录`}
            style={{ marginLeft: 4, fontSize: 11, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {account.display_name || account.username} · 退出
          </button>
        )}
      </div>
    </header>
  );
}
