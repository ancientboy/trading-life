import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useGameStore, type ModalId } from '../../store/useGameStore';
import { AgentWorkshop } from './AgentWorkshop';
import { PenguinAvatar } from './PenguinAvatar';
import { AppIcon } from '../icons/AppIcon';
import { LucideIcons, MiniLucide } from '../icons/lucideIcons';

const TITLES: Record<Exclude<ModalId, null>, string> = {
  workshop: 'Agent 工坊',
  strategy: '策略编辑器',
  market: '市场行情',
  rank: '排行榜',
  settings: '设置',
  help: '帮助 / 新手引导',
  dine: '餐厅 · 点餐',
  massage: '按摩 · 理疗套餐',
  poker: '德州扑克 · 开局',
  shop: '积分商城',
  tasks: '每日任务',
};

export function Modals() {
  const activeModal = useGameStore(s => s.activeModal);
  const closeModal = useGameStore(s => s.closeModal);

  if (!activeModal) return null;

  const wide = ['workshop', 'strategy', 'dine', 'massage', 'poker', 'shop', 'tasks'].includes(activeModal);

  return (
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
    </div>
  );
}

function ModalContent({ id }: { id: Exclude<ModalId, null> }) {
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const soulMd = useGameStore(s => s.soulMd);
  const overview = useGameStore(s => s.overview);
  const tradeFeed = useGameStore(s => s.tradeFeed);
  const ticker = useGameStore(s => s.ticker);
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
      return (
        <div>
          {Object.values(agents).sort((a, b) => (b.data.pnl || 0) - (a.data.pnl || 0)).map((a, i) => (
            <div key={a.agentId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px dashed #eee8dc' }}>
              <span style={{ width: 20, color: i < 3 ? '#d4af37' : '#999' }}>{i + 1}</span>
              <PenguinAvatar color={a.data.color} headwear={a.data.headwear} hatStyle={a.data.hatStyle} size={28} />
              <span style={{ flex: 1, fontWeight: 600 }}>{a.data.name}</span>
              <span className={(a.data.pnl || 0) >= 0 ? 'profit' : 'loss'}>{(a.data.pnl || 0) >= 0 ? '+' : ''}${Math.round(a.data.pnl || 0)}</span>
            </div>
          ))}
        </div>
      );
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
          <p><b>场景操作：</b>点击家具（餐桌/按摩床/牌桌/包厢）派遣 Agent；点击箭头切换区域；拖拽平移视角</p>
          <p><b>创建 Agent：</b>顶部「+ 创建」或 Agent 工坊 → 填写名称、外形、策略定义 → 自动加入大厅工位</p>
          <p><b>自主活动：</b>无人操作时 Agent 会自行漫步、休息、前往休闲区，到达后播放对应互动动画</p>
          {tradeFeed.length > 0 && <p style={{ fontSize: 11, color: '#9a8b7a' }}>已加载 {tradeFeed.length} 条成交</p>}
        </div>
      );
    case 'dine':
      return <LeisureModal type="dine" title="餐厅" lucide={LucideIcons.dine} items={[
        { id: 'a', name: '能量套餐 A', desc: '意面 + 果汁', cost: 50, effect: '-30% 恐慌值' },
        { id: 'b', name: '豪华套餐 B', desc: '牛排 + 红酒', cost: 80, effect: '-50% 恐慌值' },
        { id: 'c', name: '甜心下午茶', desc: '蛋糕 + 咖啡', cost: 40, effect: '-20% 压力' },
      ]} />;
    case 'massage':
      return <LeisureModal type="massage" title="按摩区" lucide={LucideIcons.massage} items={[
        { id: 'a', name: '基础理疗', desc: '30 分钟肩颈', cost: 60, effect: '-30% 压力', icon: LucideIcons.massageBed },
        { id: 'b', name: '深度按摩', desc: '60 分钟全身', cost: 80, effect: '-50% 压力', icon: LucideIcons.massageWind },
        { id: 'c', name: '精油 SPA', desc: '90 分钟尊享', cost: 120, effect: '-70% 压力', icon: LucideIcons.massageOil },
      ]} />;
    case 'poker':
      return <LeisureModal type="poker" title="德州扑克" lucide={LucideIcons.poker} items={[
        { id: 'a', name: '休闲局', desc: '底注 10 积分', cost: 30, effect: '清空负面情绪' },
        { id: 'b', name: '标准局', desc: '底注 50 积分', cost: 80, effect: '清空压力 + 奖金' },
        { id: 'c', name: '高手局', desc: '底注 200 积分', cost: 200, effect: '大幅减压 + 奖金' },
      ]} />;
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
  const [picked, setPicked] = useState(items[0].id);
  const [busy, setBusy] = useState(false);

  const agent = selectedAgentId ? agents[selectedAgentId] : Object.values(agents).sort((a, b) => b.stress - a.stress)[0];
  const item = items.find(i => i.id === picked) || items[0];
  const canAfford = points >= item.cost;

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div className={`leisure-preview leisure-${type} ${busy ? 'active' : ''}`}>
          <MiniLucide icon={lucide} color="profit" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <div style={{ fontSize: 11, color: '#d4af37', marginTop: 4 }}>当前积分：{points}</div>
          {agent && (
            <div style={{ marginTop: 8, padding: 8, background: '#faf6ef', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>服务对象：</span>
              <PenguinAvatar color={agent.data.color} headwear={agent.data.headwear} hatStyle={agent.data.hatStyle} size={24} />
              <b>{agent.data.name}</b>
              <span>· 压力 {Math.round(agent.stress)}%</span>
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
          <span style={{ color: '#d4af37', fontWeight: 600, fontSize: 12 }}>{it.cost} 积分</span>
        </button>
      ))}
      <button className="ui-btn" style={{ width: '100%', marginTop: 12, padding: '10px 0' }}
        disabled={!agent || busy || !canAfford} onClick={async () => {
        if (!agent) return;
        setBusy(true);
        const ok = await sendAgentToLeisure(type, agent.agentId, item.cost);
        if (ok) addMessage(`${agent.data.name} 选择了「${item.name}」· 消耗 ${item.cost} 积分 · ${item.effect}`);
        else if (!canAfford) addMessage(`积分不足，需要 ${item.cost} 积分`);
        setBusy(false);
        if (ok) closeModal();
      }}>
        {busy ? 'Agent 正在前往…' : !canAfford ? `积分不足（需 ${item.cost}）` : `确认 · ${item.cost} 积分`}
      </button>
    </div>
  );
}

function ShopPanel() {
  const points = useGameStore(s => s.points);
  const shopCatalog = useGameStore(s => s.shopCatalog);
  const shopUnlocks = useGameStore(s => s.shopUnlocks);
  const buyShopItem = useGameStore(s => s.buyShopItem);

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ fontSize: 12, color: '#d4af37', marginBottom: 12 }}>当前积分：{points}</div>
      {shopCatalog.map(item => {
        const owned = shopUnlocks.includes(item.id);
        return (
          <button key={item.id} className="leisure-option" disabled={owned}
            onClick={() => buyShopItem(item.id)} style={{ opacity: owned ? 0.55 : 1 }}>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: '#8a7e72' }}>
                {item.type === 'color' ? '解锁围巾/帽子颜色' : item.type === 'hat' ? '解锁帽子款式' : '场景装饰皮肤'}
              </div>
            </div>
            <span style={{ color: owned ? '#48d093' : '#d4af37', fontWeight: 600, fontSize: 12 }}>
              {owned ? '已拥有' : `${item.cost} 积分`}
            </span>
          </button>
        );
      })}
      <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 10 }}>购买后可在 Agent 工坊创建/编辑外形时使用</p>
    </div>
  );
}

function DailyTasksPanel() {
  const points = useGameStore(s => s.points);
  const dailyTasks = useGameStore(s => s.dailyTasks);
  const dailyTaskDefs = useGameStore(s => s.dailyTaskDefs);
  const claimDailyTask = useGameStore(s => s.claimDailyTask);

  return (
    <div style={{ color: '#3d3530' }}>
      <div style={{ fontSize: 12, color: '#d4af37', marginBottom: 12 }}>当前积分：{points}</div>
      {dailyTaskDefs.map(def => {
        const t = dailyTasks[def.id] ?? { progress: 0, claimed: false };
        const done = t.progress >= def.target;
        return (
          <div key={def.id} className="leisure-option" style={{ cursor: 'default' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{def.label}</div>
              <div style={{ fontSize: 11, color: '#8a7e72' }}>
                进度 {Math.min(t.progress, def.target)} / {def.target} · 奖励 {def.reward} 积分
              </div>
            </div>
            {t.claimed ? (
              <span style={{ color: '#48d093', fontSize: 12 }}>已领取</span>
            ) : (
              <button className="ui-btn" disabled={!done} onClick={() => claimDailyTask(def.id)}>
                领取
              </button>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 10 }}>
        挂机、派遣、完成活动可推进任务进度；每日 0 点重置
      </p>
    </div>
  );
}
