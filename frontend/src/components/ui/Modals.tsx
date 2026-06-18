import { useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useGameStore, type ModalId } from '../../store/useGameStore';
import { AgentWorkshop } from './AgentWorkshop';
import { DailyTasksPanel } from './DailyTasksPanel';
import { SeasonPanel } from './SeasonPanel';
import { PokerGamePanel } from './PokerGamePanel';
import { PokerResultModal } from './PokerResultModal';
import { PenguinAvatar } from './PenguinAvatar';
import { AppIcon } from '../icons/AppIcon';
import { LucideIcons, MiniLucide } from '../icons/lucideIcons';
import { DINE_TIERS, MASSAGE_TIERS } from '../../lib/leisureTiers';
import { isZoneSkinShopItem } from '../../lib/zoneSkins';
import { StrategyEditor } from './StrategyEditor';
import { SceneSkinsPanel } from './SceneSkinsPanel';

const TITLES: Record<Exclude<ModalId, null>, string> = {
  workshop: 'Agent 工坊',
  strategy: '策略编辑器',
  market: '市场行情',
  rank: '排行榜',
  settings: '设置',
  help: '帮助 / 新手引导',
  dine: '广式粤菜馆 · 点餐',
  massage: '禅意理疗 · 理疗套餐',
  poker: '德州扑克 · 开局',
  poker_result: '德州扑克 · 开牌结果',
  shop: '积分商城',
  scene: '场景装扮',
  tasks: '每日任务',
};

const WIDE_MODALS: Exclude<ModalId, null>[] = ['workshop', 'strategy', 'dine', 'massage', 'poker', 'poker_result', 'shop', 'scene', 'tasks'];

export function Modals() {
  const activeModal = useGameStore(s => s.activeModal);
  const closeModal = useGameStore(s => s.closeModal);

  if (!activeModal) return null;

  const wide = WIDE_MODALS.includes(activeModal);

  return createPortal(
    <div className="modal-overlay" onClick={closeModal}>
      <div className={`modal-box ${wide ? 'modal-wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#3d3530' }}>{TITLES[activeModal]}</h2>
          <button className="ui-btn modal-close" onClick={closeModal} title="关闭">
            <AppIcon icon={XMarkIcon} size="modal" color="muted" />
          </button>
        </div>
        <ModalContent id={activeModal} />
      </div>
    </div>,
    document.body,
  );
}

function ModalContent({ id }: { id: Exclude<ModalId, null> }) {
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const soulMd = useGameStore(s => s.soulMd);
  const overview = useGameStore(s => s.overview);
  const tradeFeed = useGameStore(s => s.tradeFeed);
  const ticker = useGameStore(s => s.ticker);
  const pokerHandResult = useGameStore(s => s.pokerHandResult);
  const agent = selectedAgentId ? agents[selectedAgentId] : null;
  const d = agent?.data;

  switch (id) {
    case 'workshop':
      return <AgentWorkshop />;
    case 'strategy':
      return <StrategyEditor agentId={selectedAgentId} />;
    case 'market':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[{ sym: 'BTC/USDT', key: 'BTCUSDT' }, { sym: 'ETH/USDT', key: 'ETHUSDT' }, { sym: 'XAU/USDT', key: 'XAUUSDT' }, { sym: 'SOL/USDT', key: 'SOLUSDT' }].map(s => (
            <div key={s.key} style={{ padding: 12, background: '#faf6ef', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#9a8b7a' }}>{s.sym}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                {ticker[s.key] != null ? (s.key === 'XAUUSDT' ? '$' + ticker[s.key].toFixed(2) : '$' + Math.round(ticker[s.key]).toLocaleString()) : '--'}
              </div>
            </div>
          ))}
        </div>
      );
    case 'rank':
      return <SeasonPanel />;
    case 'settings':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>画质 <select className="ui-btn"><option>低</option><option>中</option><option>高</option></select></label>
          <label>音效 <input type="checkbox" defaultChecked /></label>
        </div>
      );
    case 'help':
      return (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: '#6b5e4e' }}>
          <p><b>五大分区：</b>交易大厅 · 前厅接待 · 餐厅 · 按摩 · 德州扑克</p>
          <p><b>场景操作：</b>点击工位/家具（餐桌/按摩床/牌桌/休息包厢）派遣 Agent；点击箭头切换区域；拖拽平移视角</p>
          <p><b>休闲费用：</b>休息免费；用餐/按摩基础档免费，高档消耗积分；德州免费入座，开局才扣买入</p>
          <p><b>每日积分：</b>顶部积分栏可领取 1000 积分（每日一次）</p>
          <p><b>创建 Agent：</b>左侧「Agent 工坊」→ 点「创建 Agent」→ 填写名称、外形、SOUL</p>
          <p><b>自主活动：</b>无人操作时 Agent 会自行漫步、休息、前往休闲区，到达后播放对应互动动画</p>
          {tradeFeed.length > 0 && <p style={{ fontSize: 11, color: '#9a8b7a' }}>已加载 {tradeFeed.length} 条成交</p>}
        </div>
      );
    case 'dine':
      return <LeisureModal type="dine" title="广式粤菜馆" lucide={LucideIcons.dine} items={DINE_TIERS} />;
    case 'massage':
      return <LeisureModal type="massage" title="禅意理疗馆" lucide={LucideIcons.massage} items={MASSAGE_TIERS.map(t => ({
        ...t,
        icon: t.id === 'a' ? LucideIcons.massageBed : t.id === 'b' ? LucideIcons.massageWind : LucideIcons.massageOil,
      }))} />;
    case 'poker':
      return <PokerGamePanel />;
    case 'poker_result':
      return pokerHandResult ? <PokerResultModal data={pokerHandResult} /> : null;
    case 'shop':
      return <ShopPanel />;
    case 'scene':
      return <SceneSkinsPanel />;
    case 'tasks':
      return <DailyTasksPanel />;
    default:
      return null;
  }
}

function LeisureModal({ type, title, lucide, items }: {
  type: 'dine' | 'massage' | 'poker';
  title: string;
  lucide: typeof LucideIcons.dine;
  items: { id: string; name: string; desc: string; cost: number; effect: string; icon?: typeof LucideIcons.dine }[];
}) {
  const closeModal = useGameStore(s => s.closeModal);
  const addMessage = useGameStore(s => s.addMessage);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const agents = useGameStore(s => s.agents);
  const points = useGameStore(s => s.points);
  const sendAgentToLeisure = useGameStore(s => s.sendAgentToLeisure);
  const canOperateAgent = useGameStore(s => s.canOperateAgent);
  const [picked, setPicked] = useState(items[0].id as 'a' | 'b' | 'c');
  const [busy, setBusy] = useState(false);

  const operableAgents = Object.values(agents).filter(a => canOperateAgent(a.agentId));
  const agent = (selectedAgentId && canOperateAgent(selectedAgentId) ? agents[selectedAgentId] : null)
    || operableAgents.sort((a, b) => b.stress - a.stress)[0];
  const item = items.find(i => i.id === picked) || items[0];
  const isFree = item.cost <= 0;
  const canAfford = isFree || points >= item.cost;

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div className={`leisure-preview leisure-${type} ${busy ? 'active' : ''}`}>
          <MiniLucide icon={lucide} color="profit" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <div style={{ fontSize: 11, color: '#d4af37', marginTop: 4 }}>
            当前积分：{points} · 基础档免费
          </div>
          {agent ? (
            <div style={{ marginTop: 8, padding: 8, background: '#faf6ef', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>服务对象：</span>
              <PenguinAvatar color={agent.data.color} headwear={agent.data.headwear} hatStyle={agent.data.hatStyle} size={24} />
              <b>{agent.data.name}</b>
              <span>· 压力 {Math.round(agent.stress)}%</span>
            </div>
          ) : (
            <div style={{ marginTop: 8, padding: 8, background: '#fff8e8', borderRadius: 8, fontSize: 12, color: '#8a6e3a' }}>
              请先点左侧「Agent 工坊」创建你自己的 Agent，系统 Agent 无法派遣
            </div>
          )}
        </div>
      </div>
      {items.map(it => (
        <button key={it.id} className={`leisure-option ${picked === it.id ? 'selected' : ''}`} onClick={() => setPicked(it.id)}>
          <MiniLucide icon={it.icon ?? lucide} color={picked === it.id ? 'profit' : 'muted'} />
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 600 }}>{it.name}</div>
            <div style={{ fontSize: 11, color: '#8a7e72' }}>{it.desc} · {it.effect}</div>
          </div>
          <span style={{ color: it.cost <= 0 ? '#48d093' : '#d4af37', fontWeight: 600, fontSize: 12 }}>
            {it.cost <= 0 ? '免费' : `${it.cost} 积分`}
          </span>
        </button>
      ))}
      <button className="ui-btn" style={{ width: '100%', marginTop: 12, padding: '10px 0' }}
        disabled={!agent || busy || !canAfford} onClick={async () => {
        if (!agent) {
          addMessage('请先在左侧 Agent 工坊创建你自己的 Agent');
          return;
        }
        setBusy(true);
        const ok = await sendAgentToLeisure(type, agent.agentId, picked, item.cost);
        if (ok) addMessage(`${agent.data.name} 选择了「${item.name}」${item.cost > 0 ? ` · -${item.cost} 积分` : ' · 免费'} · ${item.effect}`);
        else if (!canAfford) addMessage(`积分不足，需要 ${item.cost} 积分`);
        setBusy(false);
        if (ok) closeModal();
      }}>
        {busy ? 'Agent 正在前往…' : !canAfford ? `积分不足（需 ${item.cost}）` : item.cost <= 0 ? '免费派遣' : `确认 · ${item.cost} 积分`}
      </button>
    </div>
  );
}

function ShopPanel() {
  const points = useGameStore(s => s.points);
  const shopCatalog = useGameStore(s => s.shopCatalog);
  const shopUnlocks = useGameStore(s => s.shopUnlocks);
  const buyShopItem = useGameStore(s => s.buyShopItem);
  const hasZoneSkins = shopUnlocks.some(id => id.startsWith('zone_skin_') || id.startsWith('skin_'));
  const [tab, setTab] = useState<'buy' | 'scene'>(hasZoneSkins ? 'scene' : 'buy');

  const agentItems = shopCatalog.filter(i => i.type === 'color' || i.type === 'hat');
  const zoneItems = shopCatalog.filter(i => isZoneSkinShopItem(i) && !i.legacy);
  // 旧版皮肤包仍在 catalog 中时也展示
  const legacyZoneItems = shopCatalog.filter(i => i.type === 'zone_skin' && i.legacy);

  const shopTypeLabel = (type: string) => {
    if (type === 'color') return '解锁围巾/帽子颜色';
    if (type === 'hat') return '解锁帽子款式';
    if (type === 'zone_skin') return '区域场景皮肤包';
    return '场景装饰';
  };

  const renderShopRow = (item: typeof shopCatalog[0]) => {
    const owned = shopUnlocks.includes(item.id);
    return (
      <button key={item.id} className="leisure-option" disabled={owned}
        onClick={() => buyShopItem(item.id)} style={{ opacity: owned ? 0.55 : 1 }}>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 600 }}>{item.label}</div>
          <div style={{ fontSize: 11, color: '#8a7e72' }}>{shopTypeLabel(item.type)}</div>
        </div>
        <span style={{ color: owned ? '#48d093' : '#d4af37', fontWeight: 600, fontSize: 12 }}>
          {owned ? '已拥有' : `${item.cost} 积分`}
        </span>
      </button>
    );
  };

  return (
    <div style={{ color: '#3d3530', maxHeight: 520, overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" className={`ui-btn ${tab === 'buy' ? 'active' : ''}`} style={{ flex: 1, fontSize: 12, fontWeight: tab === 'buy' ? 700 : 500 }}
          onClick={() => setTab('buy')}>购买商品</button>
        <button type="button" className={`ui-btn ${tab === 'scene' ? 'active' : ''}`} style={{
          flex: 1, fontSize: 12, fontWeight: tab === 'scene' ? 700 : 500,
          background: tab === 'scene' ? 'linear-gradient(135deg,#48d093,#2ea872)' : undefined,
          color: tab === 'scene' ? '#fff' : undefined,
        }}
          onClick={() => setTab('scene')}>
          🎨 场景装扮{hasZoneSkins ? ' ✓' : ''}
        </button>
      </div>

      {tab === 'scene' ? (
        <SceneSkinsPanel compact />
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#d4af37', marginBottom: 12 }}>当前积分：{points}</div>

          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Agent 装扮</div>
          {agentItems.map(renderShopRow)}

          <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>区域皮肤包</div>
          <p style={{ fontSize: 11, color: '#9a8b7a', margin: '0 0 8px' }}>
            购买后点上方 <b>「🎨 场景装扮」</b> 标签切换大厅、餐厅、理疗馆、德州厅风格
          </p>
          {[...zoneItems, ...legacyZoneItems].map(renderShopRow)}

          <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 10 }}>
            Agent 帽子/颜色 → Agent 工坊 →「装扮」标签页
          </p>
          <button className="ui-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => useGameStore.getState().openWorkshop('list')}>
            打开 Agent 工坊装扮
          </button>
        </>
      )}
    </div>
  );
}
