import { useEffect, useRef } from 'react';
import { drawNiumaHair2d, HAIR_STYLES, type HairStyleId } from '../../lib/agentSpecies';

export function HairStylePicker({
  value, color, onChange, allowedStyles,
}: {
  value: HairStyleId;
  color: string;
  onChange: (id: HairStyleId) => void;
  allowedStyles?: HairStyleId[];
}) {
  const styles = allowedStyles ?? (Object.keys(HAIR_STYLES) as HairStyleId[]);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {styles.map(id => (
        <HairStyleButton key={id} id={id} color={color} selected={value === id} onClick={() => onChange(id)} />
      ))}
    </div>
  );
}

function HairStyleButton({
  id, color, selected, onClick,
}: { id: HairStyleId; color: string; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#faf6ef';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5efe6';
    ctx.beginPath(); ctx.ellipse(24, 30, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    drawNiumaHair2d(ctx, 28, id, color, 'front');
  }, [id, color]);

  return (
    <button type="button" onClick={onClick} title={HAIR_STYLES[id].label}
      style={{
        width: 52, padding: '4px 4px 6px', borderRadius: 8, cursor: 'pointer',
        border: selected ? '2px solid #d4af37' : '1px solid #e8e0d4',
        background: selected ? '#faf6ef' : '#fff',
      }}>
      <canvas ref={ref} width={48} height={44} style={{ display: 'block', width: '100%' }} />
      <div style={{ fontSize: 10, color: '#6b5e4e', marginTop: 2 }}>{HAIR_STYLES[id].label}</div>
    </button>
  );
}
