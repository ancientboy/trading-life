import { useEffect, useRef } from 'react';
import { drawAgent } from '../paper/paperDraw';
import { appearanceSummary, resolveAppearance, type AgentHeadwear, type HatStyleId } from '../../lib/agentAppearance';
import type { OutfitId } from '../../lib/agentOutfits';
import type { SpeciesId, NiumaSkinId, HairStyleId } from '../../lib/agentSpecies';

const PREVIEW_W = 260;
const PREVIEW_H = 210;

interface AgentScenePreviewProps {
  color: string;
  headwear: AgentHeadwear;
  hatStyle: HatStyleId;
  speciesId?: SpeciesId | string;
  outfitId?: OutfitId | NiumaSkinId | string;
  hairStyle?: HairStyleId | string;
  scarfEnabled?: boolean;
  hatEnabled?: boolean;
  name?: string;
}

function paintPreview(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  props: AgentScenePreviewProps,
  t: number,
) {
  const ap = resolveAppearance(props);
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
  drawAgent(ctx, PREVIEW_W / 2, PREVIEW_H * 0.54, ap.color, {
    speciesId: ap.speciesId,
    outfitId: ap.outfitId,
    hairStyle: ap.hairStyle,
    scarfEnabled: ap.scarfEnabled,
    hatEnabled: ap.hatEnabled,
    headwear: ap.headwear,
    hatStyle: ap.hatStyle,
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
export function AgentScenePreview(props: AgentScenePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

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
      paintPreview(ctx, dpr, propsRef.current, (now - t0) / 1000);
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const summary = appearanceSummary(props);

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
          {props.name?.trim() || '新 Agent'}
        </div>
        <div style={{ fontSize: 11, color: '#9a8b7a', lineHeight: 1.5 }}>
          {summary}
          <br />
          配色 · <span style={{ color: props.color }}>{props.color}</span>
        </div>
      </div>
    </div>
  );
}
