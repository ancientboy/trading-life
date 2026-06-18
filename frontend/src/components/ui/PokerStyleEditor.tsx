import { useEffect, useState } from 'react';
import {
  fetchAgentPokerProfile, parseAgentPokerStyle, feedbackAgentPokerStyle, setAgentPokerPreset,
  type PokerProfile,
} from '../../lib/lifeEngagementApi';

type Props = {
  agentId: string;
  agentName?: string;
  compact?: boolean;
};

const PRESET_LABELS: Record<string, string> = {
  tag: '紧凶 TAG', lag: '松凶 LAG', tight: '紧弱 Rock', loose: '松弱 Fish',
  maniac: '疯子 Maniac', balanced: '均衡 Pro',
};

export function PokerStyleEditor({ agentId, agentName, compact }: Props) {
  const [profile, setProfile] = useState<PokerProfile | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    fetchAgentPokerProfile(agentId).then(r => {
      if (r.ok) {
        setProfile(r.profile);
        setPresets(r.presets || []);
      }
    });
  }, [agentId]);

  if (!agentId) return null;

  return (
    <div style={{ color: '#3d3530', fontSize: compact ? 11 : 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        🃏 扑克风格{agentName ? ` · ${agentName}` : ''}
      </div>

      {profile && (
        <div style={{ padding: 8, background: '#faf6ef', borderRadius: 8, marginBottom: 8, fontSize: 11 }}>
          <div>预设：<b>{PRESET_LABELS[profile.preset] || profile.preset}</b></div>
          <div style={{ color: '#8a7e72', marginTop: 4 }}>
            入池率 {(profile.vpip * 100).toFixed(0)}% · 加注率 {(profile.pfr * 100).toFixed(0)}% ·
            激进度 {(profile.aggression * 100).toFixed(0)}%
          </div>
          {profile.stats && profile.stats.hands > 0 && (
            <div style={{ marginTop: 4, color: '#6a8aad' }}>
              战绩 {profile.stats.wins}/{profile.stats.hands} 胜
            </div>
          )}
          {profile.notes && <div style={{ marginTop: 4, fontStyle: 'italic' }}>{profile.notes}</div>}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {presets.map(p => (
          <button key={p} type="button" className={`ui-btn ${profile?.preset === p ? 'active' : ''}`}
            style={{ fontSize: 10, padding: '4px 8px' }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await setAgentPokerPreset(agentId, p);
              if (r.ok && r.profile) setProfile(r.profile);
              setMsg(r.ok ? `已切换为 ${PRESET_LABELS[p] || p}` : r.error || '失败');
              setBusy(false);
            }}>
            {PRESET_LABELS[p] || p}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="描述打牌习惯，如：偏紧、少诈唬、大牌才加注…"
        rows={compact ? 2 : 3}
        style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d4c8b8', fontSize: 12, marginBottom: 6, resize: 'vertical' }}
      />
      <button className="ui-btn" style={{ width: '100%', marginBottom: 8 }} disabled={busy || text.length < 4}
        onClick={async () => {
          setBusy(true); setMsg('');
          const r = await parseAgentPokerStyle(agentId, text);
          if (r.ok && r.profile) setProfile(r.profile);
          setMsg(r.message || (r.ok ? `已解析（${r.source === 'llm' ? 'AI' : '规则'}）` : r.error || '失败'));
          setBusy(false);
        }}>
        {busy ? '解析中…' : 'AI 解析风格并保存'}
      </button>

      <input
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="观赛后反馈：太怂了 / 太浪了…"
        style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d4c8b8', fontSize: 12, marginBottom: 6 }}
      />
      <button className="ui-btn" style={{ width: '100%' }} disabled={busy || !feedback.trim()}
        onClick={async () => {
          setBusy(true);
          const r = await feedbackAgentPokerStyle(agentId, feedback);
          if (r.ok && r.profile) setProfile(r.profile);
          setMsg(r.message || '已微调');
          setFeedback('');
          setBusy(false);
        }}>
        提交反馈微调
      </button>

      {msg && <div style={{ marginTop: 8, fontSize: 11, color: '#2ea872' }}>{msg}</div>}
    </div>
  );
}
