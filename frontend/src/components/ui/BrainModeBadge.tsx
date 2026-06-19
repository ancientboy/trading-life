import { getAgentBrainMode, brainModeLabel, type BrainMode } from '../../lib/agentBrain';

const MODE_STYLE: Record<BrainMode, { bg: string; color: string }> = {
  social: { bg: '#3a6bb5', color: '#fff' },
  explore: { bg: '#48d093', color: '#fff' },
  self_care: { bg: '#d4af37', color: '#fff' },
};

export function BrainModeBadge({ agentId, size = 'sm' }: { agentId: string; size?: 'sm' | 'md' }) {
  const mode = getAgentBrainMode(agentId);
  if (!mode) return null;
  const s = MODE_STYLE[mode];
  const fs = size === 'md' ? 11 : 9;
  const pad = size === 'md' ? '2px 8px' : '1px 6px';
  return (
    <span style={{
      fontSize: fs, fontWeight: 600, padding: pad, borderRadius: 4,
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>
      🧠 {brainModeLabel(mode)}
    </span>
  );
}
