import {
  ArrowPathIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon,
  PauseIcon, PlayIcon,
} from '@heroicons/react/24/outline';
import { useGameStore } from '../../store/useGameStore';
import { AppIcon } from '../icons/AppIcon';

export function CanvasControls() {
  const resetCamera = useGameStore(s => s.resetCamera);
  const setCameraZoom = useGameStore(s => s.setCameraZoom);
  const cameraZoom = useGameStore(s => s.cameraZoom);
  const followAgentId = useGameStore(s => s.followAgentId);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const setFollowAgent = useGameStore(s => s.setFollowAgent);
  const simSpeed = useGameStore(s => s.simSpeed);
  const setSimSpeed = useGameStore(s => s.setSimSpeed);
  const paused = useGameStore(s => s.paused);
  const togglePause = useGameStore(s => s.togglePause);
  const dayMode = useGameStore(s => s.dayMode);
  const setDayMode = useGameStore(s => s.setDayMode);
  return (
    <div className="canvas-controls">
      <IconCtl icon={ArrowPathIcon} title="复位" onClick={resetCamera} />
      <Ctl label="跟随" active={!!followAgentId} onClick={() => setFollowAgent(followAgentId ? null : selectedAgentId)} />
      <span className="ctl-sep" />
      <IconCtl icon={MagnifyingGlassPlusIcon} title="拉近" onClick={() => setCameraZoom(cameraZoom + 4)} />
      <IconCtl icon={MagnifyingGlassMinusIcon} title="拉远" onClick={() => setCameraZoom(cameraZoom - 4)} />
      <span className="ctl-sep" />
      <Ctl label="1x" active={simSpeed === 1 && !paused} onClick={() => setSimSpeed(1)} />
      <Ctl label="5x" active={simSpeed === 5 && !paused} onClick={() => setSimSpeed(5)} />
      <Ctl label="20x" active={simSpeed === 20 && !paused} onClick={() => setSimSpeed(20)} />
      <IconCtl icon={paused ? PlayIcon : PauseIcon} title={paused ? '播放' : '暂停'} active={paused} onClick={togglePause} />
      <span className="ctl-sep" />
      <Ctl label={dayMode === 'day' ? '日' : '夜'} onClick={() => setDayMode(dayMode === 'day' ? 'night' : 'day')} />
    </div>
  );
}

function IconCtl({ icon, title, active, onClick }: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button className={`ui-btn ctl-icon ${active ? 'active' : ''}`} onClick={onClick} title={title}>
      <AppIcon icon={icon} size="canvas" color={active ? 'gold' : 'muted'} />
    </button>
  );
}

function Ctl({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button className={`ui-btn ${active ? 'active' : ''}`} onClick={onClick} style={{ padding: '4px 10px', fontSize: 11 }}>
      {label}
    </button>
  );
}
