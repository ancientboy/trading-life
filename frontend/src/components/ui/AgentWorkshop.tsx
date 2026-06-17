import { useEffect, useState, useRef } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useGameStore } from '../../store/useGameStore';
import { AppIcon } from '../icons/AppIcon';
import { LucideIcons, MiniLucide } from '../icons/lucideIcons';
import { fetchAgentProfile, saveAgentConfig, saveAgentSoul } from '../../lib/api';
import { APPEARANCE_PRESETS, type CustomAgentDraft } from '../../lib/customAgents';
import type { HatStyle } from '../../lib/constants';
import type { CharState } from '../../lib/constants';

export function AgentWorkshop() {
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const selectAgent = useGameStore(s => s.selectAgent);
  const createAgent = useGameStore(s => s.createAgent);
  const setProfile = useGameStore(s => s.setProfile);
  const schema = useGameStore(s => s.profileSchema);
  const config = useGameStore(s => s.profileConfig);
  const soulMd = useGameStore(s => s.soulMd);
  const closeModal = useGameStore(s => s.closeModal);
  const setFollowAgent = useGameStore(s => s.setFollowAgent);

  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [editId, setEditId] = useState(selectedAgentId || Object.keys(agents)[0] || 'xau');
  const [tab, setTab] = useState<'info' | 'config' | 'soul'>('info');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState<CustomAgentDraft>({
    name: '', icon: '🤖', color: APPEARANCE_PRESETS.colors[0], hat: 'cap',
    desc: '', strategy: '趋势跟踪', market: 'BTC/ETH', interval: '15m/1h', risk: '中',
  });

  const agentList = Object.values(agents) as CharState[];
  const current = editId ? agents[editId] : null;
  const d = current?.data;

  useEffect(() => {
    const fallback = selectedAgentId || Object.keys(agents)[0];
    if (fallback && fallback !== editId && mode === 'list') setEditId(fallback);
  }, [selectedAgentId, agents, editId, mode]);

  useEffect(() => {
    if (!editId || mode !== 'list') return;
    setLoading(true);
    fetchAgentProfile(editId).then(data => {
      if (!data.error) setProfile(data.schema?.fields || [], data.config || {}, data.soul_md || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [editId, setProfile, mode]);

  const pickAgent = (id: string) => {
    setMode('list');
    setEditId(id);
    selectAgent(id);
    setTab('info');
    setMsg('');
  };

  const handleCreate = () => {
    if (!draft.name.trim()) {
      setMsg('请填写 Agent 名称');
      return;
    }
    const ok = createAgent(draft);
    if (ok) {
      setMode('list');
      setDraft({
        name: '', icon: '🤖', color: APPEARANCE_PRESETS.colors[0], hat: 'cap',
        desc: '', strategy: '趋势跟踪', market: 'BTC/ETH', interval: '15m/1h', risk: '中',
      });
      setMsg('');
    }
  };

  if (mode === 'create') {
    return (
      <div style={{ color: '#3d3530', maxHeight: 420, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>创建新 Agent</div>
          <button className="ui-btn" onClick={() => setMode('list')}>返回列表</button>
        </div>
        <p style={{ fontSize: 12, color: '#8a7e72', marginBottom: 14, lineHeight: 1.5 }}>
          创建成功后 Agent 将自动出现在<b>交易大厅</b>工位，可立即在场景中点击选中并派遣至各休闲区。
        </p>

        <Field label="名称">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="例如：Alpha Hunter" style={inputStyle} />
        </Field>

        <Field label="外形 · 图标">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {APPEARANCE_PRESETS.icons.map(ic => (
              <button key={ic} type="button" className={`ui-btn ${draft.icon === ic ? 'active' : ''}`}
                onClick={() => setDraft({ ...draft, icon: ic })} style={{ fontSize: 20, padding: '4px 8px' }}>{ic}</button>
            ))}
          </div>
        </Field>

        <Field label="外形 · 围巾颜色">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {APPEARANCE_PRESETS.colors.map(c => (
              <button key={c} type="button" onClick={() => setDraft({ ...draft, color: c })}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: draft.color === c ? '2px solid #d4af37' : '1px solid #ddd',
                  background: c, cursor: 'pointer',
                }} />
            ))}
          </div>
        </Field>

        <Field label="外形 · 帽子 / 头饰">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {APPEARANCE_PRESETS.hats.map(h => (
              <button key={h.id} type="button" className={`ui-btn ${draft.hat === h.id ? 'active' : ''}`}
                onClick={() => setDraft({ ...draft, hat: h.id as HatStyle })}
                style={{ fontSize: 12, padding: '4px 10px' }}>
                {h.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="简介">
          <input value={draft.desc} onChange={e => setDraft({ ...draft, desc: e.target.value })}
            placeholder="Agent 职能描述" style={inputStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="策略">
            <input value={draft.strategy} onChange={e => setDraft({ ...draft, strategy: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="市场">
            <input value={draft.market} onChange={e => setDraft({ ...draft, market: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="周期">
            <input value={draft.interval} onChange={e => setDraft({ ...draft, interval: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="风险">
            <select value={draft.risk} onChange={e => setDraft({ ...draft, risk: e.target.value })} style={inputStyle}>
              {['低', '中', '中高', '高'].map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
        </div>

        <div style={{
          margin: '14px 0', padding: 12, background: '#faf6ef', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <AppearancePreview color={draft.color} hat={draft.hat} icon={draft.icon} />
          <div style={{ fontSize: 12, color: '#6b5e4e', lineHeight: 1.5 }}>
            预览：俯视剪纸风<br />
            黑圆头 + 彩色围巾 + {APPEARANCE_PRESETS.hats.find(h => h.id === draft.hat)?.label ?? '头饰'}
          </div>
        </div>

        <button className="ui-btn" style={{ width: '100%', padding: '10px 0', marginTop: 4 }} onClick={handleCreate}>
          创建并加入交易大厅
        </button>
        {msg && <div style={{ marginTop: 8, fontSize: 11, color: '#e74c3c' }}>{msg}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, minHeight: 360, color: '#3d3530' }}>
      <div style={{ borderRight: '1px dashed #e0d8cc', paddingRight: 12, overflowY: 'auto', maxHeight: 420 }}>
        <button className="ui-btn" style={{
          width: '100%', marginBottom: 10, padding: '8px 0', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 6, background: '#eef8f0', borderColor: '#48d093',
        }} onClick={() => { setMode('create'); setMsg(''); }}>
          <AppIcon icon={PlusIcon} size="mini" color="profit" />
          创建 Agent
        </button>
        <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 8 }}>我的 Agent ({agentList.length})</div>
        {agentList.length === 0 && (
          <p style={{ fontSize: 12, color: '#8a7e72', lineHeight: 1.6 }}>正在加载 Agent 列表…</p>
        )}
        {agentList.map(a => (
          <div
            key={a.agentId}
            onClick={() => pickAgent(a.agentId)}
            style={{
              padding: 8, marginBottom: 4, borderRadius: 8, cursor: 'pointer',
              background: editId === a.agentId ? '#eef8f0' : '#faf6ef',
              border: `1px solid ${editId === a.agentId ? '#48d093' : 'transparent'}`,
            }}
          >
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 20 }}>{a.data.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{a.data.name}</div>
                <div style={{ fontSize: 10, color: '#8a7e72' }}>{a.data.running ? '🟢 运行' : '⚪ 停止'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 右：详情编辑 */}
      <div style={{ overflowY: 'auto', maxHeight: 420 }}>
        {!d ? (
          <p style={{ color: '#8a7e72', fontSize: 13, lineHeight: 1.6 }}>
            {agentList.length === 0 ? 'Agent 数据加载中，请稍候…' : '请从左侧选择一个 Agent'}
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div style={{
                width: 64, height: 64, borderRadius: 12, background: d.color + '33',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32,
              }}>{d.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: '#8a7e72' }}>{d.desc}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span style={{ color: '#9a8b7a' }}>{d.strategy}</span> · {d.market} · {d.interval}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {(['info', 'config', 'soul'] as const).map(t => (
                <button key={t} className={`panel-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t === 'info' ? '基本信息' : t === 'config' ? '策略参数' : 'SOUL 文档'}
                </button>
              ))}
            </div>

            {loading && <p style={{ color: '#999', fontSize: 12 }}>加载中…</p>}

            {tab === 'info' && current && (
              <div style={{ fontSize: 13 }}>
                <InfoRow k="资金" v={'$' + (d.capital || 0).toLocaleString()} />
                <InfoRow k="初始资金" v={'$' + (d.initial_capital || 0).toLocaleString()} />
                <InfoRow k="盈亏" v={(d.pnl || 0) >= 0 ? '+$' + d.pnl : '-$' + Math.abs(d.pnl || 0)} cls={(d.pnl || 0) >= 0 ? 'profit' : 'loss'} />
                <InfoRow k="胜率" v={(d.win_rate || 0).toFixed(1) + '%'} />
                <InfoRow k="成交" v={String(d.trades || 0) + ' 笔'} />
                <InfoRow k="持仓" v={String(d.positions?.length || 0) + ' 个'} />
                <InfoRow k="风险等级" v={d.risk || '--'} />
                <InfoRow k="压力值" v={Math.round(current.stress) + '%'} icon={<MiniLucide icon={LucideIcons.debuffStress} color="loss" />} />
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button className="ui-btn" style={{ flex: 1 }} onClick={() => { setFollowAgent(editId); closeModal(); }}>跟随镜头</button>
                  <button className="ui-btn" style={{ flex: 1 }} onClick={closeModal}>返回场景</button>
                </div>
              </div>
            )}

            {tab === 'config' && (
              <>
                {schema.map(f => (
                  <div key={f.key} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: '#7a6e62' }}>{f.label}</label>
                    <input
                      type="number"
                      defaultValue={String(config[f.key] ?? '')}
                      id={'ws-cfg-' + f.key}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #d4c8b8', marginTop: 3 }}
                    />
                  </div>
                ))}
                <button className="ui-btn" style={{ width: '100%', marginTop: 8 }} onClick={async () => {
                  const body: Record<string, unknown> = {};
                  schema.forEach(f => {
                    const el = document.getElementById('ws-cfg-' + f.key) as HTMLInputElement;
                    if (el?.value) body[f.key] = el.value;
                  });
                  const r = await saveAgentConfig(editId, body);
                  setMsg(r.message || '已保存');
                }}>保存参数</button>
              </>
            )}

            {tab === 'soul' && (
              <>
                <textarea
                  key={editId + soulMd.slice(0, 20)}
                  defaultValue={soulMd}
                  id="ws-soul"
                  style={{ width: '100%', minHeight: 200, padding: 8, borderRadius: 6, border: '1px solid #d4c8b8', fontFamily: 'monospace', fontSize: 12 }}
                />
                <button className="ui-btn" style={{ width: '100%', marginTop: 8 }} onClick={async () => {
                  const r = await saveAgentSoul(editId, (document.getElementById('ws-soul') as HTMLTextAreaElement).value);
                  setMsg(r.message || '已保存');
                }}>保存 SOUL</button>
              </>
            )}

            {msg && <div style={{ marginTop: 8, fontSize: 11, color: '#48d093' }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({ k, v, cls = '', icon }: { k: string; v: string; cls?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed #eee8dc', fontSize: 13 }}>
      <span style={{ color: '#8A92A0', display: 'flex', alignItems: 'center', gap: 4 }}>{icon}{k}</span>
      <span className={cls}>{v}</span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #d4c8b8', marginTop: 3, fontSize: 13,
};

function AppearancePreview({ color, hat, icon }: { color: string; hat: HatStyle; icon: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const w = el.width, h = el.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(cx, cy, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx - 4, cy - 2, 2.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 4, cy - 2, 2.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(cx, cy + 6, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    drawHatPreview(ctx, cx, cy, hat);
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(icon, cx, cy + 10);
  }, [color, hat, icon]);
  return <canvas ref={canvasRef} width={56} height={56} style={{ borderRadius: 8, background: '#efe8dc' }} />;
}

function drawHatPreview(ctx: CanvasRenderingContext2D, cx: number, cy: number, hat: HatStyle) {
  switch (hat) {
    case 'headband':
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(cx - 12, cy - 14, 24, 5);
      ctx.fillStyle = '#22C55E';
      ctx.fillRect(cx - 12, cy - 9, 24, 2);
      break;
    case 'cap':
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath(); ctx.ellipse(cx, cy - 12, 13, 7, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#2563EB';
      ctx.fillRect(cx - 4, cy - 8, 16, 3);
      break;
    case 'beanie':
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath(); ctx.ellipse(cx, cy - 14, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#D97706';
      ctx.beginPath(); ctx.arc(cx, cy - 20, 3, 0, Math.PI * 2); ctx.fill();
      break;
    case 'tophat':
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(cx - 6, cy - 22, 12, 10);
      ctx.fillRect(cx - 11, cy - 12, 22, 3);
      break;
    default:
      break;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: '#7a6e62' }}>{label}</label>
      {children}
    </div>
  );
}
