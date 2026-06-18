import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { ZONE_CAMERA } from '../../lib/worldMap';
import { PaperZoneCanvas } from '../paper/PaperZoneCanvas';

export function GameCanvas() {
  const dayMode = useGameStore(s => s.dayMode);
  const activeZone = useGameStore(s => s.activeZone);
  const [zoneAnim, setZoneAnim] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setZoneAnim(true);
    const t = window.setTimeout(() => setZoneAnim(false), 400);
    return () => window.clearTimeout(t);
  }, [activeZone]);

  const flyToZone = useGameStore(s => s.flyToZone);
  const [zoneOpen, setZoneOpen] = useState(false);

  const bgColor = dayMode === 'day' ? '#e8e4dc' : '#2a2838';
  const zones: { id: typeof activeZone; label: string }[] = [
    { id: 'hall', label: '交易大厅' },
    { id: 'reception', label: '前厅接待' },
    { id: 'restaurant', label: '餐厅' },
    { id: 'spa', label: '按摩区' },
    { id: 'casino', label: '德州扑克' },
  ];

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap${zoneAnim ? ' zone-fade' : ''}`}
      style={{ background: bgColor, position: 'relative' }}
    >
      <div className="zone-title-badge zone-title-picker">
        <button type="button" className="zone-picker-btn" onClick={() => setZoneOpen(v => !v)}>
          ▼ {ZONE_CAMERA[activeZone]?.label ?? '交易大厅'}
        </button>
        {zoneOpen && (
          <div className="zone-picker-menu">
            {zones.map(z => (
              <button key={z.id} type="button" className={z.id === activeZone ? 'active' : ''}
                onClick={() => { flyToZone(z.id); setZoneOpen(false); }}>
                {z.label}
              </button>
            ))}
          </div>
        )}
        <span className="zone-picker-hint">拖拽移动 · 点设施派遣</span>
      </div>
      <PaperZoneCanvas />
    </div>
  );
}
