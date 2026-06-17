import type { LucideIcon } from 'lucide-react';
import {
  TrendingUp, TrendingDown, LineChart, Target, Zap, Gem,
  Shield, Flame, Star, Dices,
} from 'lucide-react';

export const AGENT_BADGE_IDS = [
  'trend', 'dip', 'chart', 'target', 'bolt', 'gem', 'shield', 'flame', 'star', 'dice',
] as const;

export type AgentBadgeId = typeof AGENT_BADGE_IDS[number];

export interface AgentBadgeDef {
  id: AgentBadgeId;
  label: string;
  Icon: LucideIcon;
}

export const AGENT_BADGES: Record<AgentBadgeId, AgentBadgeDef> = {
  trend: { id: 'trend', label: '趋势', Icon: TrendingUp },
  dip: { id: 'dip', label: '回调', Icon: TrendingDown },
  chart: { id: 'chart', label: '图表', Icon: LineChart },
  target: { id: 'target', label: '精准', Icon: Target },
  bolt: { id: 'bolt', label: '动量', Icon: Zap },
  gem: { id: 'gem', label: '价值', Icon: Gem },
  shield: { id: 'shield', label: '防守', Icon: Shield },
  flame: { id: 'flame', label: '激进', Icon: Flame },
  star: { id: 'star', label: '明星', Icon: Star },
  dice: { id: 'dice', label: '博弈', Icon: Dices },
};

const LEGACY: Record<string, AgentBadgeId> = {
  '🥇': 'gem', '₿': 'chart', '🪙': 'target', '🚀': 'bolt', '⚡': 'bolt',
  '📈': 'trend', '📉': 'dip', '💹': 'chart', '🎯': 'target', '💎': 'gem',
  '🛡️': 'shield', '🔥': 'flame', '⭐': 'star', '🎲': 'dice',
  '🤖': 'target', '🦊': 'target', '🐧': 'star', '🧠': 'chart', '🌟': 'star',
};

export function resolveBadgeId(raw?: string | null): AgentBadgeId {
  if (!raw) return 'star';
  if (raw in AGENT_BADGES) return raw as AgentBadgeId;
  return LEGACY[raw] ?? 'star';
}

export function badgeDef(raw?: string | null): AgentBadgeDef {
  return AGENT_BADGES[resolveBadgeId(raw)];
}

/** Canvas 2D — 企鹅胸前胸章 */
export function drawAgentBadge(
  ctx: CanvasRenderingContext2D, x: number, y: number, raw: string, size = 7,
) {
  const id = resolveBadgeId(raw);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(26,26,26,0.72)';
  ctx.beginPath();
  ctx.ellipse(0, 0, size + 1, size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f7f7f7';
  ctx.fillStyle = '#f7f7f7';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = size * 0.55;
  switch (id) {
    case 'trend':
      ctx.beginPath(); ctx.moveTo(-s, s * 0.4); ctx.lineTo(-s * 0.1, -s * 0.5); ctx.lineTo(s, s * 0.55); ctx.stroke();
      break;
    case 'dip':
      ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.1, s * 0.5); ctx.lineTo(s, -s * 0.55); ctx.stroke();
      break;
    case 'chart':
      ctx.strokeRect(-s * 0.7, -s * 0.2, s * 0.35, s * 0.9);
      ctx.strokeRect(-s * 0.1, -s * 0.55, s * 0.35, s * 1.25);
      ctx.strokeRect(s * 0.5, -s * 0.85, s * 0.35, s * 1.55);
      break;
    case 'target':
      ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(s * 0.15, -s); ctx.lineTo(-s * 0.45, s * 0.15); ctx.lineTo(s * 0.05, s * 0.15);
      ctx.lineTo(-s * 0.15, s); ctx.lineTo(s * 0.55, -s * 0.05); ctx.lineTo(-s * 0.05, -s * 0.05);
      ctx.closePath(); ctx.fill();
      break;
    case 'gem':
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.85, -s * 0.15); ctx.lineTo(s * 0.55, s);
      ctx.lineTo(-s * 0.55, s); ctx.lineTo(-s * 0.85, -s * 0.15); ctx.closePath(); ctx.stroke();
      break;
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.85, -s * 0.55); ctx.lineTo(s * 0.65, s * 0.35);
      ctx.quadraticCurveTo(0, s * 0.95, -s * 0.65, s * 0.35);
      ctx.lineTo(-s * 0.85, -s * 0.55); ctx.closePath(); ctx.stroke();
      break;
    case 'flame':
      ctx.beginPath();
      ctx.moveTo(0, s); ctx.quadraticCurveTo(s * 0.75, s * 0.2, s * 0.35, -s * 0.55);
      ctx.quadraticCurveTo(0, -s * 0.15, -s * 0.35, -s * 0.55);
      ctx.quadraticCurveTo(-s * 0.75, s * 0.2, 0, s); ctx.fill();
      break;
    case 'star':
      for (let i = 0; i < 5; i++) {
        const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? s : s * 0.42;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.beginPath(), ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    case 'dice':
      ctx.strokeRect(-s * 0.75, -s * 0.75, s * 1.5, s * 1.5);
      ctx.beginPath(); ctx.arc(-s * 0.28, -s * 0.28, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.28, s * 0.28, 0.9, 0, Math.PI * 2); ctx.fill();
      break;
  }
  ctx.restore();
}
