import { useEffect, useRef } from 'react';
import { drawAgentHat2d, HAT_STYLES, type HatStyleId } from '../../lib/agentAppearance';

export function HatStylePicker({
  value, color, onChange, allowedStyles,
}: {
  value: HatStyleId;
  color: string;
  onChange: (id: HatStyleId) => void;
  allowedStyles?: HatStyleId[];
}) {
  const styles = allowedStyles ?? (Object.keys(HAT_STYLES) as HatStyleId[]);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {styles.map(id => (
        <HatStyleButton
          key={id}
          id={id}
          color={color}
          selected={value === id}
          onClick={() => onChange(id)}
        />
      ))}
    </div>
  );
}

function HatStyleButton({
  id, color, selected, onClick,
}: { id: HatStyleId; color: string; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#faf6ef';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(24, 30, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    drawAgentHat2d(ctx, 28, id, color, 'front');
  }, [id, color]);

  return (
    <button type="button" onClick={onClick} title={HAT_STYLES[id].label}
      style={{
        width: 52, padding: '4px 4px 6px', borderRadius: 8, cursor: 'pointer',
        border: selected ? '2px solid #d4af37' : '1px solid #e8e0d4',
        background: selected ? '#faf6ef' : '#fff',
      }}>
      <canvas ref={ref} width={48} height={44} style={{ display: 'block', width: '100%' }} />
      <div style={{ fontSize: 10, color: '#6b5e4e', marginTop: 2 }}>{HAT_STYLES[id].label}</div>
    </button>
  );
}
