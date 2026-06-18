import { useEffect, useState } from 'react';
import { PlayCircleIcon, DocumentDuplicateIcon } from '@heroicons/react/24/solid';
import { useGameStore, type RightTab } from '../../store/useGameStore';
import { fetchAgentProfile, saveAgentConfig, saveAgentSoul } from '../../lib/api';
import type { CharState, Position, TradeRecord } from '../../lib/constants';
import { AppIcon } from '../icons/AppIcon';
import { ProfitIcon, LossIcon, PieAssetIcon } from '../icons/phosphorIcons';
import { PenguinAvatar } from './PenguinAvatar';
import { DailyTasksPanel } from './DailyTasksPanel';
import { SocialPanel } from './SocialPanel';
import { PokerGamePanel } from './PokerGamePanel';

const TABS: { id: RightTab; label: string }[] = [
  { id: 'hall', label: '交易大厅' },
  { id: 'agent', label: '交易 Agent' },
  { id: 'tasks', label: '每日任务' },
  { id: 'social', label: '社交大厅' },
  { id: 'assets', label: '持仓交易' },
  { id: 'strategy', label: '策略预览' },
  { id: 'messages', label: '交易日志' },
  { id: 'npc', label: '接待 NPC' },
  { id: 'facility', label: '休闲设施' },
];

const NPC_INFO: Record<string, { name: string; role: string; desc: string; buff: string }> = {
  reception: { name: '迎宾 Gugu', role: '前厅接待', desc: '新 Agent 创建、每日任务、新手引导', buff: '无' },
  lily: { name: '服务员 Lily', role: '餐厅服务', desc: '端餐、点餐服务', buff: '用餐 -30% 恐慌值' },
  masseur: { name: '技师 Gaga', role: '按摩技师', desc: '深度理疗服务', buff: '按摩 -50% 压力值' },
  dealer: { name: '荷官 Jack', role: '德州荷官', desc: '洗牌发牌、开局', buff: '博弈清空负面情绪' },
};

const STATE_LABEL: Record<string, string> = {
  idle: '空闲', scanning: '扫描中', trading: '交易中', panic: '熔断',
};

export function RightPanel() {
  const collapsed = useGameStore(s => s.rightPanelCollapsed);
  const toggle = useGameStore(s => s.toggleRightPanel);
  const currentTab = useGameStore(s => s.rightTab);
  const setRightTab = useGameStore(s => s.setRightTab);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const selectAgent = useGameStore(s => s.selectAgent);
  const focusAgent = useGameStore(s => s.focusAgent);
  const selectedNpcId = useGameStore(s => s.selectedNpcId);
  const selectedFacility = useGameStore(s => s.selectedFacility);
  const agents = useGameStore(s => s.agents);
  const overview = useGameStore(s => s.overview);
  const userPortfolio = useGameStore(s => s.userPortfolio);
  const resetUserPortfolio = useGameStore(s => s.resetUserPortfolio);
  const messages = useGameStore(s => s.messages);
  const tradeFeed = useGameStore(s => s.tradeFeed);
  const panelTab = useGameStore(s => s.panelTab);
  const setPanelTab = useGameStore(s => s.setPanelTab);
  const schema = useGameStore(s => s.profileSchema);
  const config = useGameStore(s => s.profileConfig);
  const soulMd = useGameStore(s => s.soulMd);
  const setProfile = useGameStore(s => s.setProfile);
  const openModal = useGameStore(s => s.openModal);
  const setFollowAgent = useGameStore(s => s.setFollowAgent);
  const flyToZone = useGameStore(s => s.flyToZone);
  const activeZone = useGameStore(s => s.activeZone);
  const navigateSidebar = useGameStore(s => s.navigateSidebar);
  const sendAgentToLeisure = useGameStore(s => s.sendAgentToLeisure);
  const canOperateAgent = useGameStore(s => s.canOperateAgent);
  const [msg, setMsg] = useState('');
  const [portfolioResetting, setPortfolioResetting] = useState(false);

  useEffect(() => {
    if (!selectedAgentId) return;
    fetchAgentProfile(selectedAgentId).then(data => {
      if (!data.error) setProfile(data.schema?.fields || [], data.config || {}, data.soul_md || '');
    });
  }, [selectedAgentId, setProfile]);

  if (collapsed) {
    return (
      <aside className="right-panel collapsed">
        <button className="sidebar-item" onClick={toggle} title="展开面板" style={{ writingMode: 'vertical-rl', height: '100%', justifyContent: 'center' }}>
          ◀ 详情
        </button>
      </aside>
    );
  }

  const agent = selectedAgentId ? agents[selectedAgentId] : null;
  const d = agent?.data;
  const agentList = (Object.values(agents) as CharState[]).filter(a => canOperateAgent(a.agentId));

  return (
    <aside className="right-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px dashed #e0d8cc' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>信息面板</span>
        <button className="ui-btn" onClick={toggle} style={{ padding: '2px 8px', fontSize: 11 }}>▶ 收起</button>
      </div>

      <div className="panel-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`panel-tab ${currentTab === t.id ? 'active' : ''}`} onClick={() => {
            setRightTab(t.id);
            if (t.id === 'hall') navigateSidebar('hall');
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-body">
        {currentTab === 'hall' && renderHallPanel()}
        {currentTab === 'tasks' && <DailyTasksPanel compact />}
        {currentTab === 'social' && <SocialPanel />}
        {(currentTab === 'object' || currentTab === 'agent') && renderAgentPanel()}
        {currentTab === 'npc' && renderNpcPanel()}
        {currentTab === 'facility' && renderFacilityPanel()}
        {currentTab === 'assets' && renderAssetsPanel()}
        {currentTab === 'strategy' && renderStrategyPanel()}
        {currentTab === 'messages' && renderMessagesPanel()}
      </div>

      <div className="panel-footer">
        <button className="ui-btn panel-action" onClick={() => openModal('strategy')}>
          <AppIcon icon={PlayCircleIcon} size="modal" color="gold" /> 回测
        </button>
        <button className="ui-btn panel-action" onClick={() => openModal('workshop')}>
          <AppIcon icon={DocumentDuplicateIcon} size="modal" color="muted" /> 工坊
        </button>
      </div>
    </aside>
  );

  function renderHallPanel() {
    const running = agentList.filter(a => a.data.running).length;
    const trading = agentList.filter(a => (a.data.positions?.length || 0) > 0).length;
    return (
      <>
        <div style={{ marginBottom: 12, padding: 10, background: '#faf6ef', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <PieAssetIcon size={16} /> 交易大厅概览
          </div>
          <Row k="在线 Agent" v={`${agentList.length} 个`} />
          <Row k="运行中" v={`${running} 个`} />
          <Row k="有持仓" v={`${trading} 个`} />
          <Row k="总盈亏" v={(overview.total_pnl != null ? (overview.total_pnl >= 0 ? '+' : '') + '$' + Math.round(overview.total_pnl).toLocaleString() : '--')} className={(overview.total_pnl || 0) >= 0 ? 'profit' : 'loss'} icon={(overview.total_pnl || 0) >= 0 ? <ProfitIcon /> : <LossIcon />} />
        </div>
        <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 8 }}>
          以下为您的 Agent；大厅中的系统 Agent 仅供背景观摩
        </div>
        {agentList.map(a => (
          <AgentAccordionItem
            key={a.agentId}
            char={a}
            expanded={selectedAgentId === a.agentId}
            operable={canOperateAgent(a.agentId)}
            compact
            onToggle={() => { selectAgent(a.agentId); focusAgent(a.agentId); flyToZone('hall'); }}
          />
        ))}
      </>
    );
  }

  function renderAgentPanel() {
    if (agentList.length === 0) {
      return (
        <p style={{ color: '#9a8b7a' }}>
          暂无你的 Agent，请前往工坊创建
        </p>
      );
    }
    return (
      <>
        <p style={{ color: '#9a8b7a', marginBottom: 10, fontSize: 12 }}>
          点击 Agent 展开详情；点击工位时将派遣当前选中的 Agent
        </p>
        {agentList.map(a => (
          <AgentAccordionItem
            key={a.agentId}
            char={a}
            expanded={selectedAgentId === a.agentId}
            operable={canOperateAgent(a.agentId)}
            panelTab={panelTab}
            setPanelTab={setPanelTab}
            schema={selectedAgentId === a.agentId ? schema : []}
            config={selectedAgentId === a.agentId ? config : {}}
            soulMd={selectedAgentId === a.agentId ? soulMd : ''}
            msg={selectedAgentId === a.agentId ? msg : ''}
            setMsg={setMsg}
            onToggle={() => selectAgent(a.agentId)}
            onFollow={() => setFollowAgent(a.agentId)}
          />
        ))}
      </>
    );
  }

  function renderNpcPanel() {
    const npc = selectedNpcId ? NPC_INFO[selectedNpcId] : null;
    if (!npc) return <p style={{ color: '#9a8b7a' }}>点击场景中的 NPC 查看对话与服务</p>;
    return (
      <>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{npc.name}</div>
        <Row k="职能" v={npc.role} />
        <Row k="说明" v={npc.desc} />
        <Row k="Buff" v={npc.buff} />
        <button className="ui-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => {
          if (selectedNpcId === 'lily') openModal('dine');
          else if (selectedNpcId === 'masseur') openModal('massage');
          else if (selectedNpcId === 'dealer') openModal('poker');
        }}>开始交互</button>
      </>
    );
  }

  function renderFacilityPanel() {
    const zoneInfo: Record<string, { title: string; desc: string; modal: 'dine' | 'massage' | 'poker'; leisure: 'dine' | 'massage' | 'poker' }> = {
      table: { title: '粤菜馆 · 餐桌', desc: '基础套餐免费，招牌/筵席档消耗积分减压', modal: 'dine', leisure: 'dine' },
      bed: { title: '禅意 · 理疗床', desc: '基础放松免费，深度/精油档消耗积分', modal: 'massage', leisure: 'massage' },
      poker: { title: '德州 · 牌桌', desc: '① 免费入座 → ② 点「开始牌局」才扣买入积分', modal: 'poker', leisure: 'poker' },
    };
    const f = selectedFacility ? zoneInfo[selectedFacility] : null;
    const leisureAgents = (Object.values(agents) as CharState[]).filter(a => {
      if (activeZone === 'restaurant') return a.activity === 'dine';
      if (activeZone === 'spa') return a.activity === 'massage';
      if (activeZone === 'casino') return a.activity === 'poker';
      return false;
    });
    if (!f) return <p style={{ color: '#9a8b7a' }}>点击左侧休闲区进入对应视图</p>;
    return (
      <>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
        <p style={{ fontSize: 12, color: '#8a7e72', marginBottom: 12 }}>{f.desc}</p>
        {leisureAgents.length > 0 && (
          <div style={{ marginBottom: 12, padding: 8, background: '#faf6ef', borderRadius: 8, fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>当前在此的 Agent</div>
            {leisureAgents.map(a => (
              <div key={a.agentId} style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <PenguinAvatar color={a.data.color} headwear={a.data.headwear} hatStyle={a.data.hatStyle} size={22} />
                <span>{a.data.name}</span>
                {activeZone === 'casino' && <span style={{ fontSize: 10, color: '#48d093' }}>已入座</span>}
              </div>
            ))}
          </div>
        )}
        {activeZone === 'casino' && selectedFacility === 'poker' ? (
          <PokerGamePanel showSitButton={leisureAgents.length === 0} compact />
        ) : (
          <>
            <button className="ui-btn" style={{ width: '100%', marginBottom: 8 }} onClick={() => sendAgentToLeisure(f.leisure, selectedAgentId || undefined)}>
              {f.leisure === 'poker' ? '① 免费入座' : '派遣 Agent 前往'}
            </button>
            <button className="ui-btn" style={{ width: '100%' }} onClick={() => openModal(f.modal)}>
              {f.leisure === 'poker' ? '打开牌局面板' : '打开详细交互'}
            </button>
          </>
        )}
      </>
    );
  }

  function renderAssetsPanel() {
    const allPositions = agentList.flatMap(a =>
      (a.data.positions || []).map(p => ({ agent: a, pos: p }))
    );
    const pnl = overview.total_pnl || 0;
    return (
      <>
        <div style={{ marginBottom: 10, padding: 8, background: '#faf6ef', borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 6, lineHeight: 1.45 }}>
            你的模拟账户 · 默认 50,000 USDT。大厅系统 Agent 为全局示范盘，不计入此处。
          </div>
          <Row k="总资产" v={'$' + Math.round(overview.total_capital || 0).toLocaleString()} className="gold" />
          <Row k="可用现金" v={'$' + Math.round(userPortfolio?.cash ?? 0).toLocaleString()} />
          <Row k="总盈亏" v={(pnl >= 0 ? '+' : '') + '$' + Math.round(pnl).toLocaleString()} className={pnl >= 0 ? 'profit' : 'loss'} />
          <Row k="总收益率" v={overview.total_pnl_pct != null ? overview.total_pnl_pct.toFixed(2) + '%' : '--'} className={(overview.total_pnl_pct || 0) >= 0 ? 'profit' : 'loss'} />
          <Row k="胜率" v={overview.total_wr ? overview.total_wr.toFixed(1) + '%' : '--'} />
          <Row k="总成交" v={String(overview.total_trades ?? '--')} />
          <button
            className="ui-btn"
            style={{ width: '100%', marginTop: 8, fontSize: 11 }}
            disabled={portfolioResetting}
            onClick={async () => {
              if (!window.confirm('确定重置整个模拟盘？将恢复 5 万 USDT 并清空所有 Agent 持仓与成交记录。')) return;
              setPortfolioResetting(true);
              await resetUserPortfolio();
              setPortfolioResetting(false);
            }}
          >
            {portfolioResetting ? '重置中…' : '重置策略 / 初始化模拟盘'}
          </button>
        </div>

        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>当前持仓 ({allPositions.length})</div>
        {allPositions.length === 0 && <p style={{ color: '#999', fontSize: 12 }}>暂无持仓</p>}
        {allPositions.map(({ agent: a, pos }, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, background: '#faf6ef', borderRadius: 8, cursor: 'pointer' }} onClick={() => selectAgent(a.agentId)}>
            <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <PenguinAvatar color={a.data.color} headwear={a.data.headwear} hatStyle={a.data.hatStyle} size={20} />
              <span>{a.data.name}</span>
            </div>
            <PositionRow pos={pos} />
          </div>
        ))}

        <div style={{ fontWeight: 600, fontSize: 13, margin: '12px 0 8px' }}>Agent 资金分布</div>
        {agentList.map(a => (
          <div key={a.agentId} style={{ marginBottom: 6, padding: 8, background: '#faf6ef', borderRadius: 8, cursor: 'pointer' }} onClick={() => selectAgent(a.agentId)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <PenguinAvatar color={a.data.color} headwear={a.data.headwear} hatStyle={a.data.hatStyle} size={22} />
                {a.data.name}
              </span>
              <span className={(a.data.pnl || 0) >= 0 ? 'profit' : 'loss'} style={{ fontSize: 12 }}>
                {(a.data.pnl || 0) >= 0 ? '+' : ''}${Math.round(a.data.pnl || 0)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#8a7e72' }}>资金 ${(a.data.capital || 0).toLocaleString()} · 持仓 {a.data.positions?.length || 0} · {STATE_LABEL[a.state]}</div>
          </div>
        ))}
      </>
    );
  }

  function renderStrategyPanel() {
    if (!d) {
      return (
        <>
          <p style={{ color: '#9a8b7a', marginBottom: 8 }}>选择 Agent 查看策略</p>
          {agentList.map(a => (
            <AgentCard key={a.agentId} char={a} selected={false} operable={canOperateAgent(a.agentId)} onSelect={() => selectAgent(a.agentId)} />
          ))}
        </>
      );
    }
    return (
      <>
        <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <PenguinAvatar color={d.color} headwear={d.headwear} hatStyle={d.hatStyle} size={32} />
          {d.name}
        </div>
        <Row k="策略类型" v={d.strategy || '--'} />
        <Row k="交易市场" v={d.market || '--'} />
        <Row k="周期" v={d.interval || '--'} />
        <Row k="风险等级" v={d.risk || '--'} />
        <div style={{ marginTop: 12, padding: 10, background: '#faf6ef', borderRadius: 8, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
          {soulMd || '加载 SOUL 文档中…'}
        </div>
        <button className="ui-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => openModal('strategy')}>打开策略编辑器</button>
      </>
    );
  }

  function renderMessagesPanel() {
    return (
      <>
        <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 8 }}>系统消息 + 历史成交记录</div>
        {messages.slice().reverse().map((m, i) => (
          <div key={'m' + i} style={{ marginBottom: 6, padding: '6px 8px', background: '#faf6ef', borderRadius: 6, fontSize: 12 }}>
            <span style={{ color: '#9a8b7a', fontSize: 10 }}>{m.time}</span>
            <div>{m.text}</div>
          </div>
        ))}
        {tradeFeed.length === 0 && messages.length === 0 && <p style={{ color: '#999' }}>暂无记录</p>}
        {tradeFeed.map(({ agentId, agentName, trade }, i) => (
          <TradeRow key={agentId + i} agentName={agentName} trade={trade} onClick={() => selectAgent(agentId)} />
        ))}
      </>
    );
  }
}

function AgentAccordionItem({
  char,
  expanded,
  operable,
  compact,
  panelTab,
  setPanelTab,
  schema,
  config,
  soulMd,
  msg,
  setMsg,
  onToggle,
  onFollow,
}: {
  char: CharState;
  expanded: boolean;
  operable?: boolean;
  compact?: boolean;
  panelTab?: 'overview' | 'config' | 'soul';
  setPanelTab?: (t: 'overview' | 'config' | 'soul') => void;
  schema?: { key: string; label: string }[];
  config?: Record<string, unknown>;
  soulMd?: string;
  msg?: string;
  setMsg?: (m: string) => void;
  onToggle: () => void;
  onFollow?: () => void;
}) {
  const d = char.data;
  const pnl = d.pnl || 0;
  const agentId = char.agentId;

  return (
    <div
      className={`agent-accordion ${expanded ? 'expanded' : ''}`}
      style={{
        marginBottom: 8,
        borderRadius: 8,
        border: `1px solid ${expanded ? '#48d093' : '#e8e0d4'}`,
        background: expanded ? '#eef8f0' : '#faf6ef',
        overflow: 'hidden',
      }}
    >
      <div
        className="agent-accordion-header"
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
      >
        <AgentCard char={char} selected={expanded} operable={operable} onSelect={onToggle} embedded />
      </div>
      {expanded && (
        <div className="agent-accordion-body" style={{ padding: '0 10px 10px', borderTop: '1px dashed #d4e8dc' }}>
          {compact ? (
            <>
              <Row k="压力值" v={`${Math.round(char.stress)}%`} />
              <Row k="活动" v={char.activity || STATE_LABEL[char.state] || char.state} />
              <Row k="盈亏" v={(pnl >= 0 ? '+' : '') + '$' + Math.round(pnl).toLocaleString()} className={pnl >= 0 ? 'profit' : 'loss'} />
              {onFollow && (
                <button className="ui-btn" style={{ width: '100%', marginTop: 8, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); onFollow(); }}>
                  跟随视角
                </button>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, margin: '10px 0', alignItems: 'center' }}>
                <div style={{ flex: 1, fontSize: 11, color: '#8a7e72' }}>{d.desc}</div>
                {onFollow && (
                  <button className="ui-btn" style={{ fontSize: 10 }} onClick={(e) => { e.stopPropagation(); onFollow(); }}>跟随</button>
                )}
              </div>
              {panelTab && setPanelTab && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {(['overview', 'config', 'soul'] as const).map(t => (
                    <button key={t} className={`panel-tab ${panelTab === t ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setPanelTab(t); }}>
                      {t === 'overview' ? '概览' : t === 'config' ? '参数' : 'SOUL'}
                    </button>
                  ))}
                </div>
              )}
              {panelTab === 'overview' && (
                <>
                  <Row k="状态" v={d.running ? '🟢 运行中' : '⚪ 已停止'} />
                  <Row k="压力值" v={`${Math.round(char.stress)}%`} />
                  <Row k="活动" v={char.activity || STATE_LABEL[char.state] || char.state} />
                  <Row k="策略" v={d.strategy || '--'} />
                  <Row k="市场" v={d.market || '--'} />
                  <Row k="资金" v={d.capital != null ? '$' + d.capital.toLocaleString() : '--'} />
                  <Row k="盈亏" v={(pnl >= 0 ? '+' : '') + '$' + pnl.toLocaleString()} className={pnl >= 0 ? 'profit' : 'loss'} />
                  <Row k="胜率" v={d.win_rate != null ? d.win_rate.toFixed(1) + '%' : '--'} />
                  <Row k="成交笔数" v={String(d.trades ?? 0)} />
                  <Row k="持仓" v={(d.positions?.length || 0) + ' 个'} />
                  {(d.positions?.length || 0) > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {d.positions!.map((p, i) => <PositionRow key={i} pos={p} compact />)}
                    </div>
                  )}
                </>
              )}
              {panelTab === 'config' && schema && config && setMsg && (
                <>
                  {operable && schema.length === 0 && <p style={{ color: '#999', fontSize: 12 }}>加载参数中…</p>}
                  {operable && schema.map(f => (
                    <div key={f.key} style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 11, color: '#7a6e62' }}>{f.label}</label>
                      <input
                        type="number"
                        defaultValue={String(config[f.key] ?? '')}
                        id={`cfg-${agentId}-${f.key}`}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #d4c8b8', marginTop: 3 }}
                      />
                    </div>
                  ))}
                  {operable && (
                    <button className="ui-btn" style={{ width: '100%', marginTop: 6 }} onClick={async () => {
                      const body: Record<string, unknown> = {};
                      schema.forEach(f => {
                        const el = document.getElementById(`cfg-${agentId}-${f.key}`) as HTMLInputElement;
                        if (el?.value) body[f.key] = el.value;
                      });
                      const r = await saveAgentConfig(agentId, body);
                      setMsg(r.message || (r.ok ? '已保存' : '保存失败'));
                    }}>保存参数</button>
                  )}
                </>
              )}
              {panelTab === 'soul' && soulMd !== undefined && setMsg && (
                <>
                  <textarea
                    key={agentId}
                    defaultValue={soulMd}
                    id={`soul-ed-${agentId}`}
                    readOnly={!operable}
                    style={{ width: '100%', minHeight: 120, padding: 8, borderRadius: 6, border: '1px solid #d4c8b8', fontFamily: 'monospace', fontSize: 12, opacity: operable ? 1 : 0.7 }}
                  />
                  {operable && (
                    <button className="ui-btn" style={{ width: '100%', marginTop: 6 }} onClick={async () => {
                      const r = await saveAgentSoul(agentId, (document.getElementById(`soul-ed-${agentId}`) as HTMLTextAreaElement).value);
                      setMsg(r.message || (r.ok ? '已保存' : '保存失败'));
                    }}>保存 SOUL</button>
                  )}
                </>
              )}
              {msg && <div style={{ marginTop: 6, fontSize: 11, color: '#48d093' }}>{msg}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AgentCard({ char, selected, operable, onSelect, embedded }: { char: CharState; selected: boolean; operable?: boolean; onSelect: () => void; embedded?: boolean }) {
  const d = char.data;
  const pnl = d.pnl || 0;
  const posCount = d.positions?.length || 0;
  const isSystem = d.owner === 'system' || !operable;
  return (
    <div
      className={`agent-card ${selected ? 'selected' : ''}`}
      onClick={embedded ? undefined : onSelect}
      style={{
        padding: 10, marginBottom: embedded ? 0 : 6, borderRadius: embedded ? 0 : 8, cursor: embedded ? 'inherit' : 'pointer',
        background: embedded ? 'transparent' : (selected ? '#eef8f0' : '#faf6ef'),
        border: embedded ? 'none' : `1px solid ${selected ? '#48d093' : '#e8e0d4'}`,
        opacity: operable === false ? 0.72 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PenguinAvatar color={d.color} headwear={d.headwear} hatStyle={d.hatStyle} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            {d.name}
            {isSystem && <span style={{ fontSize: 9, color: '#9a8b7a', background: '#eee8dc', padding: '1px 5px', borderRadius: 4 }}>系统</span>}
            {operable && <span style={{ fontSize: 9, color: '#48d093', background: '#eef8f0', padding: '1px 5px', borderRadius: 4 }}>我的</span>}
          </div>
          <div style={{ fontSize: 10, color: '#8a7e72' }}>
            {d.running ? '🟢' : '⚪'} {STATE_LABEL[char.state]} · 压力 {Math.round(char.stress)}%
            {posCount > 0 && ` · ${posCount} 持仓`}
          </div>
        </div>
        <span className={pnl >= 0 ? 'profit' : 'loss'} style={{ fontSize: 12, fontWeight: 600 }}>
          {(pnl >= 0 ? '+' : '') + '$' + Math.round(pnl)}
        </span>
      </div>
    </div>
  );
}

function PositionRow({ pos, compact }: { pos: Position; compact?: boolean }) {
  const isLong = pos.direction === 'LONG';
  return (
    <div style={{ fontSize: compact ? 11 : 12, padding: compact ? '4px 0' : '6px 0', borderBottom: compact ? 'none' : '1px dashed #e8e0d4' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
        <span>{pos.symbol}</span>
        <span style={{ color: isLong ? '#48d093' : '#56a3ff' }}>{isLong ? '多' : '空'} {pos.leverage}x</span>
      </div>
      {!compact && (
        <>
          <div style={{ color: '#8a7e72', fontSize: 11 }}>入场 ${pos.entry_price?.toLocaleString()} · 数量 {pos.quantity?.toFixed(4)}</div>
          {pos.entry_reasoning && <div style={{ color: '#9a8b7a', fontSize: 10, marginTop: 2 }}>{pos.entry_reasoning}</div>}
        </>
      )}
      {compact && <div style={{ color: '#8a7e72', fontSize: 10 }}>${pos.entry_price?.toLocaleString()} · SL ${pos.stop_loss?.toLocaleString()}</div>}
    </div>
  );
}

function TradeRow({ agentName, trade, onClick }: { agentName: string; trade: TradeRecord; onClick: () => void }) {
  const pnl = trade.pnl_amount || 0;
  const time = trade.closed_at ? new Date(trade.closed_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div onClick={onClick} style={{ marginBottom: 6, padding: '8px', background: '#faf6ef', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600 }}>{trade.symbol} {trade.direction === 'LONG' ? '多' : '空'}</span>
        <span className={pnl >= 0 ? 'profit' : 'loss'}>{(pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2)}</span>
      </div>
      <div style={{ fontSize: 10, color: '#9a8b7a' }}>{agentName} · {time} · {trade.reason || ''}</div>
    </div>
  );
}

function Row({ k, v, className = '', icon }: { k: string; v: string; className?: string; icon?: React.ReactNode }) {
  return (
    <div className="detail-row">
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{icon}{k}</span>
      <span className={className}>{v}</span>
    </div>
  );
}
