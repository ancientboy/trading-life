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
import {
  SKIN_ZONES, SKIN_ZONE_LABELS, ZONE_SKIN_OPTIONS, isZoneSkinOwned, isZoneSkinShopItem,
  type SkinZone,
} from '../../lib/zoneSkins';

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
  tasks: '每日任务',
};

export function Modals() {
  const activeModal = useGameStore(s => s.activeModal);
  const closeModal = useGameStore(s => s.closeModal);

  if (!activeModal) return null;

  const wide = ['workshop', 'strategy', 'dine', 'massage', 'poker', 'poker_result', 'shop', 'tasks'].includes(activeModal);

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
      return d ? (
        <div style={{ color: '#3d3530' }}>
          <div style={{ marginBottom: 12, padding: 10, background: '#faf6ef', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <PenguinAvatar color={d.color} headwear={d.headwear} hatStyle={d.hatStyle} size={40} />
            <div>
              <div style={{ fontWeight: 700 }}>{d.name}</div>
              <div style={{ fontSize: 12, color: '#8a7e72' }}>{d.strategy} · {d.market} · {d.interval}</div>
            </div>
          </div>
          <pre style={{ padding: 10, background: '#faf6ef', borderRadius: 8, fontSize: 11, lineHeight: 1.5, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {soulMd || '加载中…'}
          </pre>
        </div>
      ) : <p style={{ color: '#8a7e72' }}>请先选择一个 Agent</p>;
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
  const zoneSkins = useGameStore(s => s.zoneSkins);
  const activeZone = useGameStore(s => s.activeZone);
  const buyShopItem = useGameStore(s => s.buyShopItem);
  const setZoneSkin = useGameStore(s => s.setZoneSkin);
  const [skinBusy, setSkinBusy] = useState<string | null>(null);

  const agentItems = shopCatalog.filter(i => i.type === 'color' || i.type === 'hat');
  const zoneItems = shopCatalog.filter(i => isZoneSkinShopItem(i) && !i.legacy);

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

  const applySkin = async (zone: SkinZone, skinId: string) => {
    const key = `${zone}:${skinId}`;
    if (skinBusy === key || zoneSkins[zone] === skinId) return;
    setSkinBusy(key);
    await setZoneSkin(zone, skinId);
    setSkinBusy(null);
  };

  return (
    <div style={{ color: '#3d3530', maxHeight: 520, overflowY: 'auto' }}>
      <div style={{ fontSize: 12, color: '#d4af37', marginBottom: 12 }}>当前积分：{points}</div>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Agent 装扮</div>
      {agentItems.map(renderShopRow)}

      <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>区域皮肤包</div>
      <p style={{ fontSize: 11, color: '#9a8b7a', margin: '0 0 8px' }}>
        购买后可更换大厅、餐厅、理疗馆、德州厅的整体装饰风格
      </p>
      {zoneItems.length ? zoneItems.map(renderShopRow) : (
        <p style={{ fontSize: 11, color: '#9a8b7a' }}>暂无皮肤包</p>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>场景装扮</div>
      <p style={{ fontSize: 11, color: '#9a8b7a', margin: '0 0 10px' }}>
        选择已解锁的皮肤应用到各区域 · 当前所在：{SKIN_ZONE_LABELS[activeZone as SkinZone] ?? activeZone}
      </p>
      {SKIN_ZONES.map(zone => (
        <div key={zone} style={{ marginBottom: 14, padding: 10, background: '#faf6ef', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>{SKIN_ZONE_LABELS[zone]}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ZONE_SKIN_OPTIONS[zone].filter(opt => isZoneSkinOwned(zone, opt.id, shopUnlocks)).map(opt => {
              const active = zoneSkins[zone] === opt.id;
              const busy = skinBusy === `${zone}:${opt.id}`;
              return (
                <button
                  key={opt.id}
                  className="ui-btn"
                  disabled={active || !!skinBusy}
                  onClick={() => applySkin(zone, opt.id)}
                  style={{
                    fontSize: 11,
                    padding: '6px 10px',
                    background: active ? '#d4af37' : '#fff',
                    color: active ? '#fff' : '#3d3530',
                    border: active ? 'none' : '1px solid #e0d8cc',
                    opacity: busy ? 0.6 : 1,
                  }}
                  title={opt.desc}
                >
                  {opt.preview} {opt.label}{active ? ' · 使用中' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 10 }}>
        Agent 帽子/颜色购买后前往 Agent 工坊 →「装扮」标签页应用
      </p>
      <button className="ui-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => useGameStore.getState().openWorkshop('list')}>
        打开 Agent 工坊装扮
      </button>
    </div>
  );
}
