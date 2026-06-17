import { useEffect, useRef } from 'react';
import { scarfColorsFromAccent } from '../../lib/scarfColors';
import { drawAgentHat2d, type AgentHeadwear, type HatStyleId } from '../../lib/agentAppearance';

export interface PenguinAvatarProps {
  color: string;
  headwear?: AgentHeadwear;
  hatStyle?: HatStyleId;
  size?: number;
  selected?: boolean;
}

/** 迷你 Q 版企鹅 — UI 头像 */
export function PenguinAvatar({
  color, headwear = 'scarf', hatStyle = 'beanie', size = 48, selected,
}: PenguinAvatarProps) {
  const scarf = scarfColorsFromAccent(color);
  const wrapBg = headwear === 'scarf'
    ? `repeating-linear-gradient(180deg, ${scarf.wrap[0]} 0 3px, ${scarf.wrap[1]} 3px 6px)`
    : undefined;
  const tailBg = headwear === 'scarf'
    ? `repeating-linear-gradient(180deg, ${scarf.tail[0]} 0 4px, ${scarf.tail[1]} 4px 8px)`
    : undefined;

  return (
    <div style={{
      width: size, height: size, position: 'relative', flexShrink: 0,
      border: selected ? '2px solid #d4af37' : '2px solid transparent',
      borderRadius: size * 0.22,
      background: '#faf6ef',
    }}>
      <div style={{
        position: 'absolute', left: '18%', top: '22%', width: '64%', height: '62%',
        borderRadius: '50%', background: '#1a1a1a',
      }} />
      <div style={{
        position: 'absolute', left: '28%', top: '38%', width: '44%', height: '36%',
        borderRadius: '50%', background: '#f2f2f2',
      }} />
      {headwear === 'scarf' && wrapBg && (
        <>
          <div style={{
            position: 'absolute', left: '14%', top: '48%', width: '72%', height: '14%',
            borderRadius: 4, background: wrapBg,
          }} />
          <div style={{
            position: 'absolute', left: '8%', top: '54%', width: '18%', height: '28%',
            borderRadius: 2, background: tailBg,
          }} />
        </>
      )}
      <div style={{
        position: 'absolute', left: '30%', top: '32%', width: '14%', height: '16%',
        borderRadius: '50%', background: '#f7f7f7',
      }} />
      <div style={{
        position: 'absolute', left: '56%', top: '32%', width: '14%', height: '16%',
        borderRadius: '50%', background: '#f7f7f7',
      }} />
      <div style={{
        position: 'absolute', left: '33%', top: '36%', width: '8%', height: '8%',
        borderRadius: '50%', background: '#1a1a1a',
      }} />
      <div style={{
        position: 'absolute', left: '59%', top: '36%', width: '8%', height: '8%',
        borderRadius: '50%', background: '#1a1a1a',
      }} />
      <div style={{
        position: 'absolute', left: '42%', top: '46%', width: 0, height: 0,
        borderLeft: `${size * 0.06}px solid transparent`,
        borderRight: `${size * 0.06}px solid transparent`,
        borderTop: `${size * 0.07}px solid #f5a623`,
      }} />
      {headwear === 'hat' && <HatMiniOverlay style={hatStyle} color={color} size={size} />}
    </div>
  );
}

function HatMiniOverlay({ style, color, size }: { style: HatStyleId; color: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAgentHat2d(ctx, canvas.height * 0.36, style, color, 'front');
  }, [style, color, size]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
