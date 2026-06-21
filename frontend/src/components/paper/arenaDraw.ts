import { arenaPalette, type ArenaPalette } from '../../lib/zoneSkins';

export const ARENA_SCREEN = { px: 360, py: 185, w: 320, h: 128 };
export const ARENA_PIT = { px: 360, py: 395, r: 132 };
export const ARENA_PK_STAGE = { px: 360, py: 330, w: 140, h: 48 };

export interface ArenaPodDef {
  id: string;
  slot: number;
  px: number;
  py: number;
  facing: 'n' | 's' | 'e' | 'w';
}

export interface ArenaDisplayData {
  btcPrice?: number;
  startPrice?: number;
  endPrice?: number;
  pctChange?: number;
  secondsLeft?: number;
  bettingOpen?: boolean;
  poolUp?: number;
  poolDown?: number;
  betSecondsLeft?: number;
  statusLabel?: string;
  phaseLabel?: string;
  klineCloses?: number[];
}

export const ARENA_PODS: ArenaPodDef[] = Array.from({ length: 6 }, (_, i) => {
  const t = i / 5;
  const ang = Math.PI * 0.12 + t * Math.PI * 0.76;
  const dist = 152;
  const px = ARENA_PIT.px + Math.cos(ang) * dist;
  const py = ARENA_PIT.py + Math.sin(ang) * dist * 0.48;
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

function drawAudienceTier(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  side: 'left' | 'right',
  P: ArenaPalette,
  t: number,
) {
  const baseX = side === 'left' ? 48 : 672;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      const px = baseX + (side === 'left' ? col * 16 : -col * 16);
      const py = 250 + row * 34;
      const p = toScreen(px, py);
      const flicker = 0.65 + 0.35 * Math.sin(t * 2 + row + col * 0.7);
      ctx.fillStyle = `rgba(${side === 'left' ? '74,144,200' : '224,64,251'},${0.08 + flicker * 0.12})`;
      rrect(ctx, p.x - ws(10), p.y - ws(6), ws(20), ws(12), ws(2));
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.06 + flicker * 0.08})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  const label = toScreen(baseX, 220);
  ctx.fillStyle = P.textMuted;
  ctx.font = `600 ${Math.max(7, ws(8))}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(side === 'left' ? '观众席 A' : '观众席 B', label.x, label.y);
}

export function drawArenaBackdrop(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
  skinKey = 'default',
  t = 0,
) {
  const P = arenaPalette(skinKey);
  const w = cam.cw;
  const h = cam.ch;

  const grd = ctx.createRadialGradient(w / 2, h * 0.38, 0, w / 2, h * 0.5, Math.max(w, h) * 0.85);
  grd.addColorStop(0, P.backdropCenter);
  grd.addColorStop(0.55, P.backdropEdge);
  grd.addColorStop(1, '#060810');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  drawAudienceTier(ctx, toScreen, ws, 'left', P, t);
  drawAudienceTier(ctx, toScreen, ws, 'right', P, t);

  const truss = toScreen(360, 28);
  ctx.strokeStyle = P.accentDim;
  ctx.lineWidth = ws(3);
  ctx.beginPath();
  ctx.moveTo(truss.x - ws(300), truss.y);
  ctx.lineTo(truss.x + ws(300), truss.y);
  ctx.stroke();
  for (let i = -4; i <= 4; i++) {
    const lx = truss.x + i * ws(68);
    const pulse = 0.4 + 0.6 * Math.sin(t * 3 + i);
    ctx.fillStyle = `rgba(${skinKey === 'neon' ? '224,64,251' : '74,144,200'},${pulse})`;
    ctx.beginPath();
    ctx.arc(lx, truss.y + ws(8), ws(4), 0, Math.PI * 2);
    ctx.fill();
  }

  const header = toScreen(360, 52);
  ctx.fillStyle = P.wall;
  rrect(ctx, header.x - ws(320), header.y - ws(4), ws(640), ws(56), ws(6));
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = ws(2);
  ctx.stroke();

  const liveDot = 0.5 + 0.5 * Math.sin(t * 5);
  ctx.fillStyle = `rgba(255,82,82,${0.6 + liveDot * 0.4})`;
  ctx.beginPath();
  ctx.arc(header.x - ws(290), header.y + ws(22), ws(4), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = P.accent;
  ctx.font = `800 ${Math.max(12, ws(16))}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  const title = skinKey === 'neon' ? 'CYBER ESPORTS ARENA' : skinKey === 'bloom' ? 'GOLD ESPORTS ARENA' : 'ESPORTS 交易竞技馆';
  ctx.fillText(title, header.x, header.y + ws(28));
  ctx.font = `500 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = P.textMuted;
  ctx.fillText('LIVE · BTC/USDT · 猜涨跌 / 短线大赛 / 1v1 PK', header.x, header.y + ws(44));
}

function drawKlineScreen(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  t: number,
  P: ArenaPalette,
  data?: ArenaDisplayData,
) {
  const c = toScreen(ARENA_SCREEN.px, ARENA_SCREEN.py);
  const sw = ws(ARENA_SCREEN.w);
  const sh = ws(ARENA_SCREEN.h);

  ctx.fillStyle = P.screenBg;
  rrect(ctx, c.x - sw / 2, c.y - sh / 2, sw, sh, ws(10));
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = ws(2.5);
  ctx.stroke();

  const price = data?.btcPrice ?? data?.endPrice ?? data?.startPrice;
  const start = data?.startPrice;
  const pct = data?.pctChange ?? (price && start ? ((price - start) / start) * 100 : undefined);
  const up = (pct ?? 0) >= 0;

  ctx.fillStyle = P.textMuted;
  ctx.font = `600 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('BTC / USDT', c.x - sw / 2 + ws(12), c.y - sh / 2 + ws(18));

  if (data?.statusLabel) {
    ctx.textAlign = 'right';
    ctx.fillStyle = data.bettingOpen ? P.up : data.phaseLabel?.includes('封盘') ? '#ffb74d' : P.textMuted;
    ctx.fillText(data.statusLabel, c.x + sw / 2 - ws(12), c.y - sh / 2 + ws(18));
  }

  if (price) {
    ctx.textAlign = 'left';
    ctx.fillStyle = P.text;
    ctx.font = `800 ${Math.max(14, ws(18))}px monospace`;
    ctx.fillText(`$${Math.round(price).toLocaleString()}`, c.x - sw / 2 + ws(12), c.y - sh / 2 + ws(40));
    if (pct != null && Number.isFinite(pct)) {
      ctx.font = `700 ${Math.max(10, ws(12))}px monospace`;
      ctx.fillStyle = up ? P.up : P.down;
      ctx.fillText(`${up ? '+' : ''}${pct.toFixed(3)}%`, c.x - sw / 2 + ws(12), c.y - sh / 2 + ws(56));
    }
  }

  const chartL = c.x - sw / 2 + ws(12);
  const chartR = c.x + sw / 2 - ws(12);
  const chartT = c.y - sh / 2 + ws(62);
  const chartB = c.y + sh / 2 - ws(22);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = chartT + (i / 3) * (chartB - chartT);
    ctx.beginPath();
    ctx.moveTo(chartL, y);
    ctx.lineTo(chartR, y);
    ctx.stroke();
  }

  const closes = data?.klineCloses;
  let pts: { x: number; y: number }[] = [];
  if (closes && closes.length >= 4) {
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    pts = closes.map((v, i) => ({
      x: chartL + (i / (closes.length - 1)) * (chartR - chartL),
      y: chartB - ((v - min) / span) * (chartB - chartT) * 0.9 - (chartB - chartT) * 0.05,
    }));
  } else if (price && start) {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const prog = i / (n - 1);
      const base = start + (price - start) * prog;
      const wiggle = Math.sin(i * 0.45 + t * 1.5) * (price * 0.0008);
      const v = base + wiggle;
      const min = Math.min(start, price) * 0.999;
      const max = Math.max(start, price) * 1.001;
      const span = max - min || 1;
      pts.push({
        x: chartL + prog * (chartR - chartL),
        y: chartB - ((v - min) / span) * (chartB - chartT) * 0.85,
      });
    }
  } else {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const x = chartL + (i / (n - 1)) * (chartR - chartL);
      const wave = Math.sin(i * 0.55 + t * 2.2) * 0.35;
      const y = (chartT + chartB) / 2 - wave * (chartB - chartT) * 0.35;
      pts.push({ x, y });
    }
  }

  if (pts.length >= 2) {
    ctx.strokeStyle = (pct ?? 0) >= 0 ? P.chartLine : P.down;
    ctx.lineWidth = ws(2);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.fillStyle = `${(pct ?? 0) >= 0 ? P.up : P.down}22`;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, chartB);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, chartB);
    ctx.closePath();
    ctx.fill();
  }

  if (data?.poolUp != null || data?.poolDown != null) {
    ctx.fillStyle = P.textMuted;
    ctx.font = `${Math.max(7, ws(8))}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    const tail = data.bettingOpen
      ? ` · 押注 ${data.betSecondsLeft ?? data.secondsLeft ?? 0}s`
      : data.secondsLeft != null
        ? ` · 封盘 ${data.secondsLeft}s 后结算`
        : '';
    ctx.fillText(
      `涨池 ${data.poolUp ?? 0} · 跌池 ${data.poolDown ?? 0}${tail}`,
      c.x, c.y + sh / 2 - ws(8),
    );
  }
}

function drawPkStage(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  t: number,
  P: ArenaPalette,
) {
  const s = toScreen(ARENA_PK_STAGE.px, ARENA_PK_STAGE.py);
  const w = ws(ARENA_PK_STAGE.w);
  const h = ws(ARENA_PK_STAGE.h);
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.fillStyle = `rgba(74,144,200,${0.12 + pulse * 0.1})`;
  rrect(ctx, s.x - w / 2, s.y - h / 2, w, h, ws(6));
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = ws(2);
  ctx.stroke();
  ctx.fillStyle = P.text;
  ctx.font = `800 ${Math.max(9, ws(11))}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('⚔ PK 对决区', s.x, s.y + ws(2));
}

function drawArenaPod(
  ctx: CanvasRenderingContext2D,
  pod: ArenaPodDef,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  t: number,
  P: ArenaPalette,
  opts?: { label?: string; returnPct?: number; direction?: string; pulse?: boolean; hover?: boolean; rank?: number; emptyLabel?: string },
) {
  const p = toScreen(pod.px, pod.py);
  const pulseScale = opts?.pulse ? 1 + 0.05 * Math.sin(t * 8) : 1;
  const rw = ws(42) * pulseScale;
  const rh = ws(28) * pulseScale;

  const glow = opts?.hover ? 0.45 : 0.25;
  ctx.fillStyle = opts?.rank === 1 ? `rgba(255,215,0,${glow})` : `rgba(74,144,200,${glow})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + ws(10), rw * 1.1, rh * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const deskGrad = ctx.createLinearGradient(p.x - rw, p.y - rh, p.x + rw, p.y + rh);
  deskGrad.addColorStop(0, opts?.hover ? P.podHover : P.podBase);
  deskGrad.addColorStop(1, P.podEdge);
  ctx.fillStyle = deskGrad;
  rrect(ctx, p.x - rw, p.y - rh, rw * 2, rh * 1.4, ws(6));
  ctx.fill();
  ctx.strokeStyle = opts?.rank === 1 ? P.accent : P.podEdge;
  ctx.lineWidth = ws(opts?.rank === 1 ? 2.5 : 1.5);
  ctx.stroke();

  const monW = ws(36);
  const monH = ws(22);
  ctx.fillStyle = P.screenBg;
  rrect(ctx, p.x - monW / 2, p.y - rh - monH + ws(4), monW, monH, ws(3));
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = ws(1.5);
  ctx.stroke();

  const rgbPulse = 0.35 + 0.25 * Math.sin(t * 5 + pod.slot);
  ctx.fillStyle = `rgba(0,212,255,${rgbPulse})`;
  ctx.fillRect(p.x - rw + ws(2), p.y + rh * 0.9, rw * 2 - ws(4), ws(3));

  if (opts?.direction) {
    const isUp = opts.direction === 'LONG' || opts.direction === 'up';
    ctx.fillStyle = isUp ? P.up : P.down;
    ctx.font = `700 ${Math.max(7, ws(9))}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(isUp ? '▲ LONG' : '▼ SHORT', p.x, p.y - rh - monH / 2 + ws(2));
  } else {
    const emptyLabel = opts?.emptyLabel || 'READY';
    ctx.fillStyle = emptyLabel === '报名' ? P.accent : P.textMuted;
    ctx.font = `${Math.max(6, ws(7))}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(emptyLabel, p.x, p.y - rh - monH / 2 + ws(2));
  }

  if (opts?.label) {
    ctx.fillStyle = P.text;
    ctx.font = `700 ${Math.max(8, ws(10))}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(opts.label.slice(0, 8), p.x, p.y + ws(8));
  }

  if (opts?.returnPct != null && opts.returnPct !== 0) {
    ctx.fillStyle = opts.returnPct >= 0 ? P.up : P.down;
    ctx.font = `700 ${Math.max(8, ws(10))}px monospace`;
    ctx.fillText(`${opts.returnPct >= 0 ? '+' : ''}${opts.returnPct}%`, p.x, p.y + ws(22));
  }

  if (opts?.rank && opts.rank <= 3) {
    ctx.font = `${Math.max(10, ws(13))}px system-ui`;
    ctx.fillText(['', '🥇', '🥈', '🥉'][opts.rank] || '', p.x + rw - ws(4), p.y - rh - ws(8));
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
    canJoin?: boolean;
    display?: ArenaDisplayData;
    pulseSlots?: Set<number>;
  },
) {
  const P = arenaPalette(skinKey);

  const floor = toScreen(360, 430);
  const floorGrad = ctx.createRadialGradient(floor.x, floor.y, 0, floor.x, floor.y, ws(ARENA_PIT.r + 40));
  floorGrad.addColorStop(0, P.floorRing);
  floorGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = floorGrad;
  ctx.beginPath();
  ctx.ellipse(floor.x, floor.y, ws(ARENA_PIT.r + 24), ws(78), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.accentDim;
  ctx.lineWidth = ws(2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    const gy = floor.y + i * ws(22);
    ctx.beginPath();
    ctx.moveTo(floor.x - ws(ARENA_PIT.r), gy);
    ctx.lineTo(floor.x + ws(ARENA_PIT.r), gy);
    ctx.stroke();
  }

  drawPkStage(ctx, toScreen, ws, t, P);
  drawKlineScreen(ctx, toScreen, ws, t, P, opts?.display);

  const entries = opts?.entries ?? [];
  ARENA_PODS.forEach((pod, i) => {
    const entry = entries[i];
    const recentDir = entry?.recent_legs?.[0]?.direction;
    const pulse = opts?.status === 'running' && (opts.pulseSlots?.has(i) ?? false);
    drawArenaPod(ctx, pod, toScreen, ws, t, P, {
      label: entry?.agent_name || `选手 ${i + 1}`,
      returnPct: entry?.return_pct,
      direction: entry?.direction || recentDir,
      pulse,
      hover: opts?.hoverPodId === pod.id,
      rank: entry?.rank,
      emptyLabel: !entry
        ? (opts?.canJoin ? '报名' : '空位')
        : undefined,
    });
  });

  const ava = toScreen(360, 535);
  ctx.fillStyle = P.npcDesk;
  rrect(ctx, ava.x - ws(90), ava.y - ws(14), ws(180), ws(28), ws(8));
  ctx.fill();
  ctx.strokeStyle = P.accentDim;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = P.textMuted;
  ctx.font = `600 ${Math.max(8, ws(10))}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🎙 解说 Ava · 实时点评', ava.x, ava.y + ws(4));
}

export function hitTestArenaPod(paper: { px: number; py: number }): ArenaPodDef | null {
  for (const pod of ARENA_PODS) {
    if (Math.hypot(paper.px - pod.px, paper.py - pod.py) < 44) return pod;
  }
  return null;
}
