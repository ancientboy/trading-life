import { DisclaimerBar } from '../ui/DisclaimerBar';
import { TopNavBar } from '../ui/TopNavBar';
import { LeftSidebar } from '../ui/LeftSidebar';
import { RightPanel } from '../ui/RightPanel';
import { CanvasControls } from '../ui/CanvasControls';
import { Modals } from '../ui/Modals';
import { GameCanvas } from '../scene/GameCanvas';
import { useGameStore } from '../../store/useGameStore';
import { SIDEBAR_ICONS } from '../icons/sidebarIcons';
import { NavIcon } from '../icons/AppIcon';

export function AppShell() {
  const leftExpanded = useGameStore(s => s.leftSidebarExpanded);
  const rightCollapsed = useGameStore(s => s.rightPanelCollapsed);
  const minimalUi = useGameStore(s => s.minimalUi);

  const shellClass = [
    'app-shell',
    leftExpanded ? 'sidebar-expanded' : '',
    rightCollapsed ? 'right-collapsed' : '',
    minimalUi ? 'minimal-ui' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClass}>
      <DisclaimerBar />
      <TopNavBar />
      <LeftSidebar />
      <main className="main-canvas">
        <GameCanvas />
        <CanvasControls />
      </main>
      <RightPanel />
      <Modals />
      <MobileTabBar />
    </div>
  );
}

function MobileTabBar() {
  const navigateSidebar = useGameStore(s => s.navigateSidebar);
  const toggleRightPanel = useGameStore(s => s.toggleRightPanel);

  const tabs = [
    { id: 'hall' as const, pair: SIDEBAR_ICONS.hall, action: () => navigateSidebar('hall') },
    { id: 'agents' as const, pair: SIDEBAR_ICONS.agents, action: () => navigateSidebar('agents') },
    { id: 'restaurant' as const, pair: SIDEBAR_ICONS.restaurant, action: () => navigateSidebar('restaurant') },
    { id: 'panel' as const, pair: SIDEBAR_ICONS.logs, action: toggleRightPanel },
  ];

  return (
    <nav className="mobile-tab-bar">
      {tabs.map(t => (
        <button key={t.id} className="sidebar-item" onClick={t.action}>
          <NavIcon outline={t.pair.outline} solid={t.pair.solid} size="sidebar" />
        </button>
      ))}
    </nav>
  );
}
