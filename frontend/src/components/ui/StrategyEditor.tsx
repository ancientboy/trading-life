import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { STRATEGY_PRESET_OPTIONS, applyStrategyPreset } from '../../lib/customAgents';
import { parseStrategyPreference, submitStrategyFeedback, fetchMarketKlines, type KlineCandle } from '../../lib/lifeApi';
import { PenguinAvatar } from './PenguinAvatar';
import { MiniKlineChart } from './MiniKlineChart';

export interface StrategyDraft {
  strategyPreset: string;
  strategy: string;
  market: string;
  interval: string;
  risk: string;
  leverage: number;
  thresholdPct: number;
  maxPositions: number;
  soulMd: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid #d4c8b8', fontSize: 13, background: '#fff',
};

function presetDefaults(presetId: string): Partial<StrategyDraft> {
  const p = STRATEGY_PRESET_OPTIONS.find(o => o.id === presetId) || STRATEGY_PRESET_OPTIONS[1];
  const base = applyStrategyPreset(presetId);
  const levMap: Record<string, number> = { xau: 3, major: 5, altcoin: 8, newcoin: 10, momentum: 12, custom: 5 };
  const thMap: Record<string, number> = { xau: 0.35, major: 0.28, altcoin: 0.45, newcoin: 0.55, momentum: 0.22, custom: 0.3 };
  return {
    ...base,
    leverage: levMap[presetId] ?? 5,
    thresholdPct: thMap[presetId] ?? 0.3,
    maxPositions: 2,
  };
}

function draftFromAgent(agentId: string): StrategyDraft {
  const a = useGameStore.getState().agents[agentId]?.data;
  const pf = useGameStore.getState().userPortfolio?.agents?.find(x => x.id === agentId);
  const preset = a?.strategyPreset || pf?.strategy_preset || 'major';
  const defs = presetDefaults(preset);
  return {
    strategyPreset: preset,
    strategy: a?.strategy || pf?.strategy || defs.strategy || '',
    market: a?.market || pf?.market || defs.market || '',
    interval: a?.interval || pf?.interval || defs.interval || '',
    risk: a?.risk || pf?.risk || defs.risk || '中',
    leverage: pf?.leverage ?? a?.leverage ?? defs.leverage ?? 5,
    thresholdPct: pf?.threshold_pct ?? a?.thresholdPct ?? defs.thresholdPct ?? 0.3,
    maxPositions: pf?.max_positions ?? a?.maxPositions ?? 2,
    soulMd: a?.soulMd || '',
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: '#7a6e62', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10, color: '#9a8b7a', marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

const BEGINNER_PROMPTS = [
  '我比较保守，稳一点做 BTC，杠杆别太高',
  '想跟 Major Agent 一样做 BTC/ETH 趋势',
  '我喜欢激进追涨，可以接受高波动',
  '专注黄金 XAU，中长线趋势',
];

function marketToSymbol(market: string): string {
  const m = (market || 'BTC').toUpperCase();
  if (m.includes('XAU') || m.includes('黄金')) return 'XAUUSDT';
  if (m.includes('ETH') && !m.includes('BTC')) return 'ETHUSDT';
  if (m.includes('SOL')) return 'SOLUSDT';
  return 'BTCUSDT';
}

function intervalEntry(interval: string): string {
  const part = (interval || '15m/1h').split('/')[0]?.trim().toLowerCase();
  return part || '15m';
}

function AgentDuelBanner() {
  const duels = useGameStore(s => s.userPortfolio?.agent_duels);
  if (!duels?.length) return null;
  const d = duels[0];
  const sym = d.symbol.replace('USDT', '');
  return (
    <div style={{
      marginBottom: 12, padding: 10, borderRadius: 8,
      background: 'linear-gradient(135deg,#fff3e0,#fce4ec)', border: '1px solid #ffb74d',
      fontSize: 12, lineHeight: 1.5,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚔️ 交易员对决 · {sym}</div>
      <div>
        <span className={d.agent_a_pnl >= 0 ? 'profit' : 'loss'}>{d.agent_a_name} {d.agent_a_direction}</span>
        {' vs '}
        <span className={d.agent_b_pnl >= 0 ? 'profit' : 'loss'}>{d.agent_b_name} {d.agent_b_direction}</span>
      </div>
      <div style={{ fontSize: 10, color: '#8a6a4a', marginTop: 4 }}>
        盈亏 {d.agent_a_name} ${Math.round(d.agent_a_pnl)} · {d.agent_b_name} ${Math.round(d.agent_b_pnl)}
      </div>
    </div>
  );
}

export function StrategyEditor({
  agentId: propAgentId,
  compact,
  onSaved,
}: {
  agentId?: string | null;
  compact?: boolean;
  onSaved?: () => void;
}) {
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const operableAgentIds = useGameStore(s => s.operableAgentIds);
  const userPortfolio = useGameStore(s => s.userPortfolio);
  const updateTradingStrategy = useGameStore(s => s.updateTradingStrategy);
  const resetAgentSim = useGameStore(s => s.resetAgentSim);
  const selectAgent = useGameStore(s => s.selectAgent);
  const openModal = useGameStore(s => s.openModal);

  const tradingAgents = useMemo(
    () => operableAgentIds.filter(id => agents[id]?.data?.agentType !== 'entertainment'),
    [operableAgentIds, agents],
  );

  const [editId, setEditId] = useState(propAgentId || selectedAgentId || tradingAgents[0] || '');
  const [draft, setDraft] = useState<StrategyDraft>(() => draftFromAgent(editId));
  const [preference, setPreference] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [klines, setKlines] = useState<KlineCandle[]>([]);

  const chartSymbol = useMemo(() => marketToSymbol(draft.market), [draft.market]);
  const chartInterval = useMemo(() => intervalEntry(draft.interval), [draft.interval]);

  useEffect(() => {
    let cancelled = false;
    fetchMarketKlines(chartSymbol, chartInterval, 80).then(r => {
      if (!cancelled && r.ok && r.candles?.length) setKlines(r.candles);
    }).catch(() => {});
    const t = window.setInterval(() => {
      fetchMarketKlines(chartSymbol, chartInterval, 80).then(r => {
        if (!cancelled && r.ok && r.candles?.length) setKlines(r.candles);
      }).catch(() => {});
    }, 60_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [chartSymbol, chartInterval]);

  useEffect(() => {
    const id = propAgentId || selectedAgentId || tradingAgents[0] || '';
    setEditId(id);
  }, [propAgentId, selectedAgentId, tradingAgents]);

  useEffect(() => {
    if (editId) setDraft(draftFromAgent(editId));
  }, [editId, agents, userPortfolio]);

  const agent = editId ? agents[editId] : null;
  const pfAgent = userPortfolio?.agents?.find(a => a.id === editId);
  const snapshot = pfAgent?.strategy_snapshot as {
    applied_at?: string; pnl?: number; trades?: number; wins?: number; capital?: number;
  } | undefined;

  const sincePnl = snapshot ? (pfAgent?.pnl ?? 0) - (snapshot.pnl ?? 0) : null;
  const sinceTrades = snapshot ? (pfAgent?.trades ?? 0) - (snapshot.trades ?? 0) : null;

  if (tradingAgents.length === 0) {
    return (
      <div style={{ color: '#8a7e72', fontSize: 13, lineHeight: 1.6 }}>
        <p>你还没有可配置的交易 Agent。</p>
        <button className="ui-btn" style={{ marginTop: 8 }} onClick={() => openModal('workshop')}>前往 Agent 工坊创建</button>
      </div>
    );
  }

  const applyPreset = (presetId: string) => {
    const base = applyStrategyPreset(presetId);
    const defs = presetDefaults(presetId);
    setDraft(d => ({ ...d, ...base, ...defs, strategyPreset: presetId }));
  };

  const handleParsePreference = async () => {
    if (!editId || preference.trim().length < 4) {
      setMsg('请用一句话描述你的投资偏好（至少 4 字）');
      return;
    }
    setParsing(true);
    setMsg('');
    try {
      const res = await parseStrategyPreference(editId, preference.trim());
      if (!res.ok || !res.config) {
        setMsg(res.error || '解析失败');
        return;
      }
      const c = res.config;
      const presetId = c.strategy_preset || 'major';
      const defs = presetDefaults(presetId);
      setDraft(d => ({
        ...d,
        strategyPreset: presetId,
        strategy: c.strategy || defs.strategy || d.strategy,
        market: c.market || defs.market || d.market,
        interval: c.interval || defs.interval || d.interval,
        risk: c.risk || d.risk,
        leverage: c.leverage ?? defs.leverage ?? d.leverage,
        thresholdPct: c.threshold_pct ?? defs.thresholdPct ?? d.thresholdPct,
        maxPositions: c.max_positions ?? d.maxPositions,
        soulMd: c.soul_summary ? `# 交易人格\n\n${c.soul_summary}\n\n${d.soulMd}`.trim() : d.soulMd,
      }));
      setMsg(res.message || `已解析（${res.source === 'llm' ? 'AI' : '规则引擎'}），请确认后保存`);
    } catch {
      setMsg('解析失败，请稍后重试');
    } finally {
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!editId) return;
    setSaving(true);
    setMsg('');
    const ok = await updateTradingStrategy(editId, {
      strategy_preset: draft.strategyPreset,
      strategy: draft.strategy,
      market: draft.market,
      interval: draft.interval,
      risk: draft.risk,
      leverage: draft.leverage,
      threshold_pct: draft.thresholdPct,
      max_positions: draft.maxPositions,
      soul_md: draft.soulMd,
    });
    setSaving(false);
    setMsg(ok ? '策略已保存并应用到模拟盘' : '保存失败');
    if (ok) onSaved?.();
  };

  return (
    <div style={{ color: '#3d3530', fontSize: 13 }}>
      {!propAgentId && tradingAgents.length > 1 && (
        <Field label="选择 Agent">
          <select value={editId} onChange={e => { setEditId(e.target.value); selectAgent(e.target.value); }} style={inputStyle}>
            {tradingAgents.map(id => (
              <option key={id} value={id}>{agents[id]?.data.name || id}</option>
            ))}
          </select>
        </Field>
      )}

      {agent && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12,
          padding: compact ? 8 : 10, background: '#faf6ef', borderRadius: 8,
        }}>
          <PenguinAvatar color={agent.data.color} headwear={agent.data.headwear} hatStyle={agent.data.hatStyle} speciesId={agent.data.speciesId} outfitId={agent.data.outfitId} scarfEnabled={agent.data.scarfEnabled} hatEnabled={agent.data.hatEnabled} size={compact ? 36 : 44} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{agent.data.name}</div>
            <div style={{ fontSize: 11, color: '#8a7e72' }}>
              模拟资金 ${(pfAgent?.capital ?? agent.data.capital ?? 0).toLocaleString()}
              {' · '}盈亏 {(pfAgent?.pnl ?? agent.data.pnl ?? 0) >= 0 ? '+' : ''}${Math.round(pfAgent?.pnl ?? agent.data.pnl ?? 0)}
            </div>
          </div>
        </div>
      )}

      <AgentDuelBanner />
      <MiniKlineChart candles={klines} symbol={chartSymbol.replace('USDT', '')} height={compact ? 140 : 168} />

      {/* 自然语言偏好 */}
      <div style={{
        padding: 10, marginBottom: 12, background: '#f0f4ff', borderRadius: 8,
        border: '1px solid #c8d4f0',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>一句话描述投资偏好 · 小白 30 秒上手</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {BEGINNER_PROMPTS.map(p => (
            <button key={p} type="button" className="ui-btn" style={{ fontSize: 10, padding: '4px 8px' }}
              onClick={() => setPreference(p)}>
              {p.slice(0, 14)}…
            </button>
          ))}
        </div>
        <textarea
          value={preference}
          onChange={e => setPreference(e.target.value)}
          placeholder="例：我想跟 Major 一样做 BTC/ETH 趋势，但杠杆不超过 3 倍，偏稳健少交易"
          style={{ ...inputStyle, minHeight: 56, resize: 'vertical', marginBottom: 8 }}
        />
        <button className="ui-btn" style={{ width: '100%' }} disabled={parsing} onClick={handleParsePreference}>
          {parsing ? 'AI 解析中…' : 'AI 解析偏好 → 填入下方表单'}
        </button>
      </div>

      {/* 投资风格 */}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>① 投资风格（跟大厅 Agent 同款逻辑）</div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
        {STRATEGY_PRESET_OPTIONS.map(p => (
          <button
            key={p.id}
            type="button"
            className="ui-btn"
            style={{
              padding: '8px 6px', fontSize: 11, textAlign: 'left',
              background: draft.strategyPreset === p.id ? '#eef8f0' : '#faf6ef',
              borderColor: draft.strategyPreset === p.id ? '#48d093' : '#e8e0d4',
              gridColumn: p.id === 'custom' ? 'span 2' : undefined,
            }}
            onClick={() => applyPreset(p.id)}
          >
            <div style={{ fontWeight: 600 }}>{p.label}</div>
            <div style={{ color: '#9a8b7a', fontSize: 10, marginTop: 2 }}>
              {p.id === 'custom' ? '自选市场与参数' : `${p.market} · ${p.risk}`}
            </div>
          </button>
        ))}
      </div>

      {/* 交易参数 */}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>② 交易参数（直接影响模拟开平仓）</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <Field label="风险等级">
          <select value={draft.risk} onChange={e => setDraft({ ...draft, risk: e.target.value })} style={inputStyle}>
            {['低', '中', '中高', '高'].map(r => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="K 线周期">
          <input value={draft.interval} onChange={e => setDraft({ ...draft, interval: e.target.value })} style={inputStyle} placeholder="15m/1h" />
        </Field>
        <Field label="市场 / 标的">
          <input value={draft.market} onChange={e => setDraft({ ...draft, market: e.target.value })} style={inputStyle} placeholder="BTC/ETH" />
        </Field>
        <Field label="策略名称（展示用）">
          <input value={draft.strategy} onChange={e => setDraft({ ...draft, strategy: e.target.value })} style={inputStyle} />
        </Field>
      </div>

      <Field label={`杠杆 · ${draft.leverage}x`} hint="1～20 倍，影响仓位大小与盈亏幅度">
        <input type="range" min={1} max={20} value={draft.leverage}
          onChange={e => setDraft({ ...draft, leverage: Number(e.target.value) })}
          style={{ width: '100%' }} />
      </Field>
      <Field label={`信号灵敏度 · ${draft.thresholdPct.toFixed(2)}%`} hint="越低越灵敏（交易更频繁）；越高越保守">
        <input type="range" min={0.15} max={0.8} step={0.01} value={draft.thresholdPct}
          onChange={e => setDraft({ ...draft, thresholdPct: Number(e.target.value) })}
          style={{ width: '100%' }} />
      </Field>
      <Field label={`最大同时持仓 · ${draft.maxPositions} 个`}>
        <input type="range" min={1} max={3} step={1} value={draft.maxPositions}
          onChange={e => setDraft({ ...draft, maxPositions: Number(e.target.value) })}
          style={{ width: '100%' }} />
      </Field>

      {/* SOUL */}
      <div style={{ fontSize: 12, fontWeight: 700, margin: '12px 0 8px' }}>
        ③ 交易人格 SOUL（轻量影响信号：保守 +阈值/-杠杆，激进相反）
      </div>
      {(pfAgent?.soul_bias_tags as string[] | undefined)?.length ? (
        <div style={{ fontSize: 10, color: '#6a8a5a', marginBottom: 6 }}>
          当前 SOUL 偏移：{(pfAgent?.soul_bias_tags as string[]).join(' · ')}
          {' · '}阈值 {pfAgent?.threshold_pct?.toFixed(2)}% · 杠杆 {pfAgent?.leverage}x
        </div>
      ) : null}
      <textarea
        value={draft.soulMd}
        onChange={e => setDraft({ ...draft, soulMd: e.target.value })}
        style={{ ...inputStyle, minHeight: compact ? 80 : 120, fontFamily: 'monospace', fontSize: 12 }}
      />

      {/* 反馈微调 — 对标扑克风格 feedback */}
      <div style={{
        marginTop: 12, padding: 10, background: '#fff8e8', borderRadius: 8,
        border: '1px solid #e8dcc8',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>④ 观察后反馈 · 训练 AI 交易员</div>
        <textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder="例：太保守了机会太少 / 太激进亏太多 / 信号太慢"
          style={{ ...inputStyle, minHeight: 44, marginBottom: 8 }}
        />
        <button className="ui-btn" style={{ width: '100%' }} disabled={feedbackBusy || feedback.trim().length < 2}
          onClick={async () => {
            if (!editId) return;
            setFeedbackBusy(true);
            setMsg('');
            try {
              const res = await submitStrategyFeedback(editId, feedback.trim());
              if (!res.ok) {
                setMsg(res.error || '反馈失败');
                return;
              }
              if (res.portfolio) useGameStore.getState().applyUserPortfolio(res.portfolio);
              if (res.agent) {
                const a = res.agent;
                setDraft(d => ({
                  ...d,
                  leverage: a.leverage ?? d.leverage,
                  thresholdPct: a.threshold_pct ?? a.thresholdPct ?? d.thresholdPct,
                  risk: a.risk ?? d.risk,
                }));
              }
              setMsg(res.message || '已根据反馈微调策略');
              setFeedback('');
            } finally {
              setFeedbackBusy(false);
            }
          }}>
          {feedbackBusy ? '…' : '提交反馈 → 微调杠杆/灵敏度'}
        </button>
      </div>

      {/* 表现对比 */}
      {pfAgent && (
        <div style={{ marginTop: 12, padding: 10, background: '#faf6ef', borderRadius: 8, border: '1px solid #ebe4d8' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>模拟盘表现</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
            <span>总盈亏</span><span className={(pfAgent.pnl || 0) >= 0 ? 'profit' : 'loss'} style={{ textAlign: 'right' }}>
              {(pfAgent.pnl || 0) >= 0 ? '+' : ''}${Math.round(pfAgent.pnl || 0)}
            </span>
            <span>胜率</span><span style={{ textAlign: 'right' }}>{(pfAgent.win_rate || 0).toFixed(1)}%</span>
            <span>成交笔数</span><span style={{ textAlign: 'right' }}>{pfAgent.trades ?? 0}</span>
            <span>持仓</span><span style={{ textAlign: 'right' }}>{pfAgent.positions?.length ?? 0} 个</span>
          </div>
          {snapshot && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e0d8cc', fontSize: 10, color: '#8a7e72', lineHeight: 1.5 }}>
              自上次保存策略（{snapshot.applied_at?.slice(0, 16).replace('T', ' ')}）以来：
              盈亏 {sincePnl != null ? `${sincePnl >= 0 ? '+' : ''}$${Math.round(sincePnl)}` : '--'}
              · 新增成交 {sinceTrades ?? 0} 笔
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="ui-btn" style={{ flex: 2, padding: '10px 0' }} disabled={saving} onClick={handleSave}>
          {saving ? '保存中…' : '保存并应用到模拟盘'}
        </button>
        {!compact && (
          <button className="ui-btn" style={{ flex: 1, background: '#fff5f5', borderColor: '#e8b4b4' }}
            onClick={async () => {
              if (!editId || !window.confirm('重置该 Agent 模拟盘？')) return;
              await resetAgentSim(editId);
            }}>
            重置模拟盘
          </button>
        )}
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 11, color: msg.includes('失败') ? '#e74c3c' : '#48d093' }}>{msg}</div>}
    </div>
  );
}
