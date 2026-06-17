import { AppIcon } from '../icons/AppIcon';
import { badgeDef, resolveBadgeId } from '../../lib/agentBadges';
import type { IconColor } from '../icons/tokens';

interface AgentBadgeIconProps {
  badge?: string | null;
  size?: 'mini' | 'modal' | 'canvas' | 'sidebar';
  color?: IconColor;
  style?: React.CSSProperties;
}

/** Agent 胸章 — Lucide 线条图标 */
export function AgentBadgeIcon({ badge, size = 'mini', color = 'gold', style }: AgentBadgeIconProps) {
  const def = badgeDef(badge);
  return <AppIcon icon={def.Icon} size={size} color={color} style={style} />;
}

export { resolveBadgeId, badgeDef, AGENT_BADGE_IDS, AGENT_BADGES } from '../../lib/agentBadges';
export type { AgentBadgeId } from '../../lib/agentBadges';
