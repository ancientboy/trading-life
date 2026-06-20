import { arenaPalette, type ArenaPalette } from '../../lib/zoneSkins';

export const ARENA_SCREEN = { px: 360, py: 195, w: 300, h: 110 };
export const ARENA_PIT = { px: 360, py: 385, r: 128 };

export interface ArenaPodDef {
  id: string;
  slot: number;
  px: number;
  py: number;
  facing: 'n' | 's' | 'e' | 'w';
}

/** 6 选手 Pod — 半弧围绕中央 K 线屏 */
export const ARENA_PODS: ArenaPodDef[] = Array.from({ length: 6 }, (_, i) => {
  const t = i / 5;
  const ang = Math.PI * 0.15 + t * Math.PI * 0.7;
  const dist = 148;
  const px = ARENA_PIT.px + Math.cos(ang) * dist;
  const py = ARENA_PIT.py + Math.sin(ang) * dist * 0.52;
  const facing: ArenaPodDef['facing'] = px < ARENA_PIT.px - 20 ? 'e' : px > ARENA_PIT.px + 20 ? 'w' : 'n';
  return { id: `arena_pod_${i + 1}`, slot: i, px, py, facing };
});

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawArenaBackdrop(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
  skinKey = 'default',
) {
  const P = arenaPalette(skinKey);
  const w = cam.cw;
  const h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.72);
  if (dayMode === 'night') {
    grd.addColorStop(0, P.backdropCenter);
    grd.addColorStop(1, '#0a1018');
  } else {
    grd.addColorStop(0, P.backdropCenter);
    grd.addColorStop(1, P.backdropEdge);
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const header = toScreen(360, 42);
  ctx.fillStyle = P.wall;
  rrect(ctx, header.x - ws(340), header.y - ws(6), ws(680), ws(72), ws(4));
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = ws(2);
  ctx.stroke();

  ctx.fillStyle = P.accent;
  ctx.font = `700 ${Math.max(11, ws(15))}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(skinKey === 'neon' ? '◆ CYBER ARENA ◆' : skinKey === 'bloom' ? '◆ GOLD ARENA ◆' : '◆ 交易竞技馆 ◆', header.x, header.y + ws(38));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = P.textMuted;
  ctx.fillText('LIVE TRADING ARENA · BTC/USDT', header.x, header.y + ws(54));

  [[72, 320], [648, 320]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    ctx.fillStyle = P.pillar;
    rrect(ctx, p.x - ws(14), p.y - ws(110), ws(28), ws(220), ws(3));
    ctx.fill();
    ctx.strokeStyle = P.accentDim;
    ctx.lineWidth = ws(1);
    for (let i = 0; i < 4; i++) {
      const ly = p.y - ws(90) + i * ws(44);
      ctx.beginPath();
      ctx.moveTo(p.x - ws(10), ly);
      ctx.lineTo(p.x + ws(10), ly);
      ctx.stroke();
    }
  });
}

function drawKlineScreen(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  t: number,
  P: ArenaPalette,
  priceLabel?: string,
) {
  const c = toScreen(ARENA_SCREEN.px, ARENA_SCREEN.py);
  const sw = ws(ARENA_SCREEN.w);
  const sh = ws(ARENA_SCREEN.h);
  ctx.fillStyle = P.screenBg;
  rrect(ctx, c.x - sw / 2, c.y - sh / 2, sw, sh, ws(8));
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = ws(2);
  ctx.stroke();

  ctx.fillStyle = P.accent;
  ctx.font = `600 ${Math.max(8, ws(10))}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText('BTC/USDT', c.x - sw / 2 + ws(10), c.y - sh / 2 + ws(16));
  if (priceLabel) {
    ctx.textAlign = 'right';
    ctx.fillStyle = P.up;
    ctx.fillText(priceLabel, c.x + sw / 2 - ws(10), c.y - sh / 2 + ws(16));
  }

  const chartL = c.x - sw / 2 + ws(12);
  const chartR = c.x + sw / 2 - ws(12);
  const chartT = c.y - sh / 2 + ws(24);
  const chartB = c.y + sh / 2 - ws(12);
  const mid = (chartT + chartB) / 2;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = chartT + (i / 3) * (chartB - chartT);
    ctx.beginPath();
    ctx.moveTo(chartL, y);
    ctx.lineTo(chartR, y);
    ctx.stroke();
  }

  const n = 24;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = chartL + (i / (n - 1)) * (chartR - chartL);
    const wave = Math.sin(i * 0.55 + t * 2.2) * 0.35 + Math.sin(i * 0.2 + t * 0.8) * 0.2;
    const y = mid - wave * (chartB - chartT) * 0.38;
    pts.push({ x, y });
  }
  ctx.strokeStyle = P.chartLine;
  ctx.lineWidth = ws(2);
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.fillStyle = `rgba(46,168,114,${0.15 + pulse * 0.2})`;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, chartB);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, chartB);
  ctx.closePath();
  ctx.fill();
}

function drawArenaPod(
  ctx: CanvasRenderingContext2D,
  pod: ArenaPodDef,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  t: number,
  P: ArenaPalette,
  opts?: { label?: string; returnPct?: number; direction?: string; pulse?: boolean; hover?: boolean; rank?: number },
) {
  const p = toScreen(pod.px, pod.py);
  const pulseScale = opts?.pulse ? 1 + 0.06 * Math.sin(t * 8) : 1;
  const r = ws(38) * pulseScale;

  ctx.fillStyle = opts?.hover ? P.podHover : P.podBase;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r, r * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = opts?.rank === 1 ? P.accent : P.podEdge;
  ctx.lineWidth = ws(opts?.rank === 1 ? 3 : 1.5);
  ctx.stroke();

  ctx.fillStyle = P.screenBg;
  rrect(ctx, p.x - ws(22), p.y - ws(28), ws(44), ws(22), ws(4));
  ctx.fill();

  if (opts?.direction) {
    const up = opts.direction === 'LONG' || opts.direction === 'up';
    ctx.fillStyle = up ? P.up : P.down;
    ctx.font = `700 ${Math.max(8, ws(11))}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(up ? '▲ LONG' : '▼ SHORT', p.x, p.y - ws(14));
  }

  if (opts?.label) {
    ctx.fillStyle = P.text;
    ctx.font = `600 ${Math.max(8, ws(10))}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(opts.label.slice(0, 8), p.x, p.y + ws(6));
  }

  if (opts?.returnPct != null && opts.returnPct !== 0) {
    const pos = opts.returnPct >= 0;
    ctx.fillStyle = pos ? P.up : P.down;
    ctx.font = `700 ${Math.max(8, ws(11))}px Inter,sans-serif`;
    ctx.fillText(`${pos ? '+' : ''}${opts.returnPct}%`, p.x, p.y + ws(22));
  }

  if (opts?.rank && opts.rank <= 3) {
    ctx.font = `${Math.max(10, ws(14))}px system-ui`;
    ctx.fillText(['', '🥇', '🥈', '🥉'][opts.rank] || '', p.x + ws(28), p.y - ws(24));
  }
}

export function drawArenaScene(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  t: number,
  skinKey = 'default',
  opts?: {
    hoverPodId?: string | null;
    entries?: Array<{ user_id: string; agent_name: string; direction: string; return_pct?: number; rank?: number; recent_legs?: Array<{ direction: string }> }>;
    status?: string;
    priceLabel?: string;
    pulseSlots?: Set<number>;
  },
) {
  const P = arenaPalette(skinKey);

  const floor = toScreen(360, 420);
  ctx.fillStyle = P.floorRing;
  ctx.beginPath();
  ctx.ellipse(floor.x, floor.y, ws(ARENA_PIT.r + 20), ws(72), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.accentDim;
  ctx.lineWidth = ws(2);
  ctx.stroke();

  drawKlineScreen(ctx, toScreen, ws, t, P, opts?.priceLabel);

  const entries = opts?.entries ?? [];
  ARENA_PODS.forEach((pod, i) => {
    const entry = entries[i];
    const recentDir = entry?.recent_legs?.[0]?.direction;
    const pulse = opts?.status === 'running' && (opts.pulseSlots?.has(i) ?? false);
    drawArenaPod(ctx, pod, toScreen, ws, t, P, {
      label: entry?.agent_name,
      returnPct: entry?.return_pct,
      direction: entry?.direction || recentDir,
      pulse,
      hover: opts?.hoverPodId === pod.id,
      rank: entry?.rank,
    });
  });

  const ava = toScreen(360, 520);
  ctx.fillStyle = P.npcDesk;
  rrect(ctx, ava.x - ws(80), ava.y - ws(16), ws(160), ws(32), ws(6));
  ctx.fill();
  ctx.fillStyle = P.textMuted;
  ctx.font = `600 ${Math.max(8, ws(10))}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('解说 Ava · 实时点评', ava.x, ava.y + ws(4));
}

export function hitTestArenaPod(paper: { px: number; py: number }): ArenaPodDef | null {
  for (const pod of ARENA_PODS) {
    if (Math.hypot(paper.px - pod.px, paper.py - pod.py) < 44) return pod;
  }
  return null;
}
