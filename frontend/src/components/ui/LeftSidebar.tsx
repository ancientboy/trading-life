import { useState } from 'react';
import { useGameStore, type SidebarAction } from '../../store/useGameStore';
import { SIDEBAR_ICONS } from '../icons/sidebarIcons';
import { NavIcon } from '../icons/AppIcon';

const MAIN: { id: SidebarAction; label: string }[] = [
  { id: 'hall', label: '交易大厅' },
  { id: 'agents', label: '我的 Agent' },
  { id: 'strategy', label: '策略编辑器' },
  { id: 'positions', label: '持仓交易' },
];
const LEISURE: { id: SidebarAction; label: string }[] = [
  { id: 'restaurant', label: '餐厅' },
  { id: 'spa', label: '按摩区' },
  { id: 'casino', label: '德州扑克' },
];
const OTHER: { id: SidebarAction; label: string }[] = [
  { id: 'warehouse', label: '资产仓库' },
  { id: 'social', label: '社交大厅' },
  { id: 'logs', label: '交易日志' },
];

export function LeftSidebar() {
  const expanded = useGameStore(s => s.leftSidebarExpanded);
  const setExpanded = useGameStore(s => s.setLeftSidebarExpanded);
  const active = useGameStore(s => s.sidebarActive);
  const navigateSidebar = useGameStore(s => s.navigateSidebar);
  const toggleMinimalUi = useGameStore(s => s.toggleMinimalUi);
  const agents = useGameStore(s => s.agents);
  const [hover, setHover] = useState<string | null>(null);

  const leisureActive = Object.values(agents).some(c => c.activity === 'dine' || c.activity === 'massage' || c.activity === 'poker');

  return (
    <aside className="left-sidebar" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {MAIN.map(item => (
          <SidebarBtn key={item.id} id={item.id} label={item.label} expanded={expanded}
            active={active === item.id} hover={hover === item.id}
            onHover={setHover} onClick={() => navigateSidebar(item.id)} />
        ))}
        <div className="sidebar-divider" />
        <div className="sidebar-section-label" style={{ display: expanded ? 'block' : 'none' }}>休闲传送</div>
        {LEISURE.map(item => (
          <SidebarBtn key={item.id} id={item.id} label={item.label} expanded={expanded}
            active={active === item.id} hover={hover === item.id} badge={leisureActive}
            onHover={setHover} onClick={() => navigateSidebar(item.id)} />
        ))}
        <div className="sidebar-divider" />
        {OTHER.map(item => (
          <SidebarBtn key={item.id} id={item.id} label={item.label} expanded={expanded}
            active={active === item.id} hover={hover === item.id}
            onHover={setHover} onClick={() => navigateSidebar(item.id)} />
        ))}
      </div>
      <div style={{ padding: '8px 0', borderTop: '1px dashed #e0d8cc' }}>
        <SidebarBtn id="minimal" label="极简 UI" expanded={expanded} hover={hover === 'minimal'}
          onHover={setHover} onClick={toggleMinimalUi} icons={SIDEBAR_ICONS.minimal} />
      </div>
    </aside>
  );
}

function SidebarBtn({ id, label, expanded, active, hover, badge, onHover, onClick, icons }: {
  id: string; label: string; expanded: boolean; active?: boolean; hover?: boolean; badge?: boolean;
  onHover: (id: string | null) => void; onClick: () => void;
  icons?: typeof SIDEBAR_ICONS.hall;
}) {
  const pair = icons ?? SIDEBAR_ICONS[id as SidebarAction];
  return (
    <button
      className={`sidebar-item ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="icon-wrap">
        {pair && <NavIcon outline={pair.outline} solid={pair.solid} active={active} hovered={hover} size="sidebar" />}
        {badge && <span className="sidebar-badge" />}
      </span>
      {expanded && <span>{label}</span>}
    </button>
  );
}
