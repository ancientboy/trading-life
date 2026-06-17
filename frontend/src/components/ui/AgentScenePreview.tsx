import { useEffect, useRef } from 'react';
import { drawAgent } from '../paper/paperDraw';
import { headwearLabel, type AgentHeadwear, type HatStyleId } from '../../lib/agentAppearance';

const PREVIEW_W = 260;
const PREVIEW_H = 210;

interface AgentScenePreviewProps {
  color: string;
  headwear: AgentHeadwear;
  hatStyle: HatStyleId;
  name?: string;
}

function paintPreview(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  color: string,
  headwear: AgentHeadwear,
  hatStyle: HatStyleId,
  t: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

  const grd = ctx.createLinearGradient(0, 0, 0, PREVIEW_H);
  grd.addColorStop(0, '#faf6ef');
  grd.addColorStop(1, '#ebe4da');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.beginPath();
  ctx.ellipse(PREVIEW_W / 2, PREVIEW_H * 0.72, 36, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  drawAgent(ctx, PREVIEW_W / 2, PREVIEW_H * 0.54, color, {
    headwear,
    hatStyle,
    facing: 's',
    t,
    walking: false,
  });
  ctx.restore();

  ctx.setLineDash([]);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9a8b7a';
  ctx.font = '600 10px Inter,sans-serif';
  ctx.fillText('正面 · 游戏场景', 10, 16);
}

/** 创建页场景预览 — 单角色居中，与游戏内 2D 渲染一致 */
export function AgentScenePreview({ color, headwear, hatStyle, name }: AgentScenePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ color, headwear, hatStyle });
  propsRef.current = { color, headwear, hatStyle };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PREVIEW_W * dpr;
    canvas.height = PREVIEW_H * dpr;
    canvas.style.width = `${PREVIEW_W}px`;
    canvas.style.height = `${PREVIEW_H}px`;

    let raf = 0;
    let alive = true;
    const t0 = performance.now();

    const draw = (now: number) => {
      if (!alive) return;
      const { color: c, headwear: hw, hatStyle: hs } = propsRef.current;
      paintPreview(ctx, dpr, c, hw, hs, (now - t0) / 1000);
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e8e0d4',
      borderRadius: 12,
      padding: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b5e4e', marginBottom: 8 }}>
        场景预览
      </div>
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        background: '#f5f0e8', borderRadius: 8, overflow: 'hidden',
      }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 10, textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#3d3530', marginBottom: 4 }}>
          {name?.trim() || '新 Agent'}
        </div>
        <div style={{ fontSize: 11, color: '#9a8b7a', lineHeight: 1.5 }}>
          {headwearLabel(headwear, hatStyle)}
          <br />
          配色 · <span style={{ color }}>{color}</span>
        </div>
      </div>
    </div>
  );
}
