import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { ZONE_CAMERA } from '../../lib/worldMap';
import { PaperZoneCanvas } from '../paper/PaperZoneCanvas';

const CasinoGlbLayer = lazy(() =>
  import('../paper/CasinoGlbLayer').then(m => ({ default: m.CasinoGlbLayer })),
);

export function GameCanvas() {
  const dayMode = useGameStore(s => s.dayMode);
  const activeZone = useGameStore(s => s.activeZone);
  const [zoneAnim, setZoneAnim] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cw: 0, ch: 0 });

  useEffect(() => {
    setZoneAnim(true);
    const t = window.setTimeout(() => setZoneAnim(false), 400);
    return () => window.clearTimeout(t);
  }, [activeZone]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ cw: el.clientWidth, ch: el.clientHeight });
    });
    ro.observe(el);
    setSize({ cw: el.clientWidth, ch: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const bgColor = dayMode === 'day' ? '#e8e4dc' : '#2a2838';
  const badge = `${ZONE_CAMERA[activeZone]?.label ?? '交易大厅'} · 拖拽移动 · 点击箭头切换区域 · 点击设施派遣 Agent`;

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap${zoneAnim ? ' zone-fade' : ''}`}
      style={{ background: bgColor, position: 'relative' }}
    >
      <div className="zone-title-badge">{badge}</div>
      <Suspense fallback={null}>
        <CasinoGlbLayer cw={size.cw} ch={size.ch} />
      </Suspense>
      <PaperZoneCanvas />
    </div>
  );
}
