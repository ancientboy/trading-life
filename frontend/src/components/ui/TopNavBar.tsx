import { WalletIcon } from '@heroicons/react/24/solid';
import {
  ChartBarIcon, GiftIcon, TrophyIcon, Cog6ToothIcon, QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import {
  ChartBarIcon as ChartBarSolid, GiftIcon as GiftSolid, TrophyIcon as TrophySolid,
  Cog6ToothIcon as CogSolid, QuestionMarkCircleIcon as HelpSolid,
} from '@heroicons/react/24/solid';
import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { AppIcon, NavIcon } from '../icons/AppIcon';

const NAV_BTNS = [
  { id: 'market', label: '行情', outline: ChartBarIcon, solid: ChartBarSolid, modal: 'market' as const },
  { id: 'event', label: '活动', outline: GiftIcon, solid: GiftSolid, modal: 'help' as const },
  { id: 'rank', label: '排行', outline: TrophyIcon, solid: TrophySolid, modal: 'rank' as const },
  { id: 'settings', label: '设置', outline: Cog6ToothIcon, solid: CogSolid, modal: 'settings' as const },
  { id: 'help', label: '帮助', outline: QuestionMarkCircleIcon, solid: HelpSolid, modal: 'help' as const },
];

export function TopNavBar() {
  const ticker = useGameStore(s => s.ticker);
  const overview = useGameStore(s => s.overview);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const agents = useGameStore(s => s.agents);
  const openModal = useGameStore(s => s.openModal);
  const [hover, setHover] = useState<string | null>(null);

  const pnl = overview.total_pnl || 0;
  const capital = overview.total_capital || 0;
  const pnlPct = capital ? (pnl / capital * 100) : 0;
  const mainAgent = selectedAgentId ? agents[selectedAgentId]?.data : Object.values(agents)[0]?.data;

  return (
    <header className="top-nav">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="brand-mark" aria-hidden>🐧</span>
          <span style={{ color: '#3d3530' }}>交易人生</span>
        </div>
        <button className="ui-btn" onClick={() => openModal('workshop')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px' }}>
          <span style={{ fontSize: 20 }}>{mainAgent?.icon || '🐧'}</span>
          <span style={{ fontSize: 11, color: '#8A92A0' }}>{mainAgent?.name?.split(' ')[0] || 'Agent'}</span>
        </button>
        <button className="ui-btn" onClick={() => openModal('workshop')} title="创建 Agent"
          style={{ padding: '4px 8px', fontSize: 11, color: '#48d093', borderColor: '#48d093' }}>
          + 创建
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 12 }}>
        <div className="stat-card">
          <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <AppIcon icon={WalletIcon} size="mini" color="gold" /> 总资产
          </div>
          <div className="value mono gold">${Math.round(capital).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="label">当日盈亏</div>
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
        <div className="stat-card" style={{ minWidth: 80 }}>
          <div className="label">BTC</div>
          <div className="value mono" style={{ fontSize: 13 }}>{ticker.BTCUSDT ? '$' + Math.round(ticker.BTCUSDT).toLocaleString() : '--'}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
      </div>
    </header>
  );
}
