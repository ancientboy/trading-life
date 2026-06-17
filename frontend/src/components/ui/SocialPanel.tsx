import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
  fetchChat, postChat, fetchNpcEvents, claimNpcEvent,
  fetchMentorPairs, pairMentor, tradingPk, listGuilds, joinGuild, createGuild,
  type ChatMessage, type NpcEvent,
} from '../../lib/lifeEngagementApi';
import { chatChannelForZone } from '../../lib/lifeEngagementApi';

export function SocialPanel() {
  const activeZone = useGameStore(s => s.activeZone);
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const chatMessages = useGameStore(s => s.chatMessages);
  const setChatMessages = useGameStore(s => s.setChatMessages);
  const npcEvents = useGameStore(s => s.npcEvents);
  const setNpcEvents = useGameStore(s => s.setNpcEvents);
  const addMessage = useGameStore(s => s.addMessage);
  const applyLifeState = useGameStore(s => s.applyLifeState);
  const syncEngagement = useGameStore(s => s.syncEngagement);

  const [input, setInput] = useState('');
  const [mentorMentor, setMentorMentor] = useState('');
  const [mentorMentee, setMentorMentee] = useState('');
  const [guildName, setGuildName] = useState('');
  const [guilds, setGuilds] = useState<{ id: string; name: string; member_count: number }[]>([]);
  const [pairs, setPairs] = useState<{ mentor_agent_id: string; mentee_agent_id: string }[]>([]);

  const channel = chatChannelForZone(activeZone);
  const agentList = Object.values(agents);

  useEffect(() => {
    syncEngagement();
    fetchMentorPairs().then(r => { if (r.ok) setPairs(r.pairs); });
    listGuilds().then(r => { if (r.ok) setGuilds(r.guilds); });
  }, [syncEngagement]);

  useEffect(() => {
    fetchChat(channel, 0).then(r => {
      if (r.ok) setChatMessages(r.messages);
    });
  }, [channel, setChatMessages]);

  const send = async () => {
    if (!input.trim()) return;
    const res = await postChat(channel, input.trim(), selectedAgentId || '');
    if (res.ok) {
      setInput('');
      const r = await fetchChat(channel, chatMessages.at(-1)?.created_at ?? 0);
      if (r.ok) setChatMessages(r.messages);
    }
  };

  const claimEvent = async (id: string) => {
    const res = await claimNpcEvent(id);
    if (res.ok) {
      addMessage(`+${res.reward} 积分 · NPC 活动奖励`);
      if (res.balance != null) useGameStore.setState({ points: res.balance });
      syncEngagement();
    } else addMessage(res.error || '领取失败');
  };

  const doMentorPair = async () => {
    const res = await pairMentor(mentorMentor, mentorMentee);
    if (res.ok) {
      addMessage('师徒结对成功！附近压力下降更快');
      fetchMentorPairs().then(r => { if (r.ok) setPairs(r.pairs); });
    } else addMessage(res.error || '结对失败');
  };

  const doPk = async () => {
    const res = await tradingPk('house', 50);
    if (res.ok && res.won) addMessage(`交易 PK 获胜 +${res.won} 积分`);
    else if (res.ok) addMessage(`交易 PK 落败（${res.challenger_score} vs ${res.defender_score}）`);
    else addMessage(res.error || 'PK 失败');
    if (res.balance != null) useGameStore.setState({ points: res.balance });
  };

  return (
    <div style={{ color: '#3d3530', fontSize: 13 }}>
      <Section title="📡 区域聊天" subtitle={`频道：${channel}`}>
        <div style={{ maxHeight: 140, overflowY: 'auto', background: '#faf6ef', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          {chatMessages.length === 0 && <p style={{ color: '#9a8b7a', fontSize: 11 }}>同桌 Agent 会自动发言，也可留言互动</p>}
          {chatMessages.map((m: ChatMessage) => (
            <div key={m.id} style={{ marginBottom: 4, fontSize: 12 }}>
              <span style={{ color: m.kind === 'agent' ? '#48d093' : '#d4af37', fontWeight: 600 }}>
                {m.kind === 'agent' ? '🐧' : m.display_name || '玩家'}
              </span>
              <span style={{ marginLeft: 6 }}>{m.body}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="说点什么…"
            style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #d4c8b8' }}
            onKeyDown={e => e.key === 'Enter' && send()} />
          <button className="ui-btn" onClick={send}>发送</button>
        </div>
      </Section>

      <Section title="🎁 NPC 限时活动">
        {npcEvents.length === 0 && <p style={{ color: '#9a8b7a', fontSize: 11 }}>暂无活动</p>}
        {npcEvents.map((ev: NpcEvent) => (
          <div key={ev.id} className="leisure-option" style={{ marginBottom: 4, cursor: 'default' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{ev.title}</div>
              <div style={{ fontSize: 11, color: '#8a7e72' }}>{ev.body} · +{ev.reward_points} 积分</div>
            </div>
            {ev.claimed ? <span style={{ color: '#48d093', fontSize: 11 }}>已领</span> : (
              <button className="ui-btn" style={{ fontSize: 11 }} onClick={() => claimEvent(ev.id)}>领取</button>
            )}
          </div>
        ))}
      </Section>

      <Section title="🤝 师徒结对">
        <p style={{ fontSize: 11, color: '#8a7e72', marginBottom: 6 }}>娱乐 Agent 为师，交易 Agent 为徒，同桌减压 +15%</p>
        <select value={mentorMentor} onChange={e => setMentorMentor(e.target.value)} style={{ width: '100%', marginBottom: 4, padding: 6, borderRadius: 6 }}>
          <option value="">选择师傅（娱乐）</option>
          {agentList.filter(a => a.data.agentType === 'entertainment').map(a => (
            <option key={a.agentId} value={a.agentId}>{a.data.name}</option>
          ))}
        </select>
        <select value={mentorMentee} onChange={e => setMentorMentee(e.target.value)} style={{ width: '100%', marginBottom: 6, padding: 6, borderRadius: 6 }}>
          <option value="">选择徒弟（交易）</option>
          {agentList.filter(a => a.data.agentType !== 'entertainment').map(a => (
            <option key={a.agentId} value={a.agentId}>{a.data.name}</option>
          ))}
        </select>
        <button className="ui-btn" style={{ width: '100%' }} disabled={!mentorMentor || !mentorMentee} onClick={doMentorPair}>结对</button>
        {pairs.map(p => (
          <div key={p.mentee_agent_id} style={{ fontSize: 11, marginTop: 4, color: '#48d093' }}>
            ✓ {p.mentor_agent_id} → {p.mentee_agent_id}
          </div>
        ))}
      </Section>

      <Section title="⚔️ 交易 PK">
        <button className="ui-btn" style={{ width: '100%' }} onClick={doPk}>挑战系统对手（50 积分）</button>
      </Section>

      <Section title="🏰 公会">
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input value={guildName} onChange={e => setGuildName(e.target.value)} placeholder="公会名"
            style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #d4c8b8' }} />
          <button className="ui-btn" onClick={async () => {
            const r = await createGuild(guildName);
            if (r.ok) { addMessage(`公会「${guildName}」创建成功`); listGuilds().then(x => { if (x.ok) setGuilds(x.guilds); }); }
            else addMessage(r.error || '创建失败');
          }}>创建</button>
        </div>
        {guilds.map(g => (
          <button key={g.id} className="leisure-option" onClick={async () => {
            const r = await joinGuild(g.id);
            if (r.ok) addMessage(`已加入公会 ${g.name}`);
            else addMessage(r.error || '加入失败');
          }}>
            <span style={{ flex: 1, textAlign: 'left' }}>{g.name} · {g.member_count ?? 0} 人</span>
            <span style={{ fontSize: 11, color: '#d4af37' }}>加入</span>
          </button>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: subtitle ? 2 : 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 6 }}>{subtitle}</div>}
      {children}
    </div>
  );
}
