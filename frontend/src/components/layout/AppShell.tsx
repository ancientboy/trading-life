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
        <CanvasControls />
      </main>
      <RightPanel />
      <Modals />
      <MessageToast />
    </div>
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
