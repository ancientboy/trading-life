import { DisclaimerBar } from '../ui/DisclaimerBar';
import { TopNavBar } from '../ui/TopNavBar';
import { LeftSidebar } from '../ui/LeftSidebar';
import { RightPanel } from '../ui/RightPanel';
import { CanvasControls } from '../ui/CanvasControls';
import { Modals } from '../ui/Modals';
import { GameCanvas } from '../scene/GameCanvas';
import { useGameStore } from '../../store/useGameStore';
import { createPortal } from 'react-dom';

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
        <PokerFloatCTA />
        <CanvasControls />
      </main>
      <RightPanel />
      <Modals />
      <MessageToast />
    </div>
  );
}

/** 赌场入座后，画布上悬浮「开始牌局」入口 */
function PokerFloatCTA() {
  const activeZone = useGameStore(s => s.activeZone);
  const agents = useGameStore(s => s.agents);
  const canOperateAgent = useGameStore(s => s.canOperateAgent);
  const activeModal = useGameStore(s => s.activeModal);
  const openModal = useGameStore(s => s.openModal);

  if (activeZone !== 'casino' || activeModal === 'poker' || activeModal === 'poker_result') return null;
  const seated = Object.values(agents).find(a => a.activity === 'poker' && canOperateAgent(a.agentId));
  if (!seated) return null;

  return createPortal(
    <button type="button" className="poker-float-cta" onClick={() => openModal('poker')}>
      🃏 {seated.data.name} 已入座 · 点我开始牌局
    </button>,
    document.body,
  );
}

function MessageToast() {
  const messages = useGameStore(s => s.messages);
  const last = messages[messages.length - 1];
  if (!last) return null;
  return createPortal(
    <div className="message-toast" key={last.time + last.text}>{last.text}</div>,
    document.body,
  );
}
