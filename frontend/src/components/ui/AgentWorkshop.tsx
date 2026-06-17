import { useEffect, useState } from 'react';
import { getStoredAccount } from '../../lib/lifeAuth';
import { PlusIcon } from '@heroicons/react/24/outline';
import { useGameStore } from '../../store/useGameStore';
import { AppIcon } from '../icons/AppIcon';
import { LucideIcons, MiniLucide } from '../icons/lucideIcons';
import { fetchAgentProfile, saveAgentConfig, saveAgentSoul } from '../../lib/api';
import {
  APPEARANCE_PRESETS, DEFAULT_ENTERTAINMENT_SOUL, DEFAULT_TRADING_SOUL,
  countCustomByType, canCreateAgentType, loadCustomAgentMeta, type CustomAgentDraft,
} from '../../lib/customAgents';
import { unlockedColors, unlockedHatStyles } from '../../lib/lifeShop';
import { PenguinAvatar } from './PenguinAvatar';
import { AgentScenePreview } from './AgentScenePreview';
import { HatStylePicker } from './HatStylePicker';
import type { AgentHeadwear } from '../../lib/agentAppearance';
import type { AgentType, CharState } from '../../lib/constants';

const DEFAULT_DRAFT: CustomAgentDraft = {
  agentType: 'entertainment',
  name: '', headwear: 'scarf', hatStyle: 'beanie', color: APPEARANCE_PRESETS.colors[0],
  desc: '', soul: DEFAULT_ENTERTAINMENT_SOUL(''),
  strategy: '趋势跟踪', market: 'BTC/ETH', interval: '15m/1h', risk: '中',
};

function isCustomAgent(id: string) {
  return id.startsWith('custom_');
}

function agentTypeOf(d: CharState['data'] | undefined): AgentType {
  return d?.agentType ?? 'trading';
}

export function AgentWorkshop() {
  const agents = useGameStore(s => s.agents);
  const selectedAgentId = useGameStore(s => s.selectedAgentId);
  const selectAgent = useGameStore(s => s.selectAgent);
  const createAgent = useGameStore(s => s.createAgent);
  const setProfile = useGameStore(s => s.setProfile);
  const schema = useGameStore(s => s.profileSchema);
  const config = useGameStore(s => s.profileConfig);
  const soulMd = useGameStore(s => s.soulMd);
  const saveCustomAgentSoul = useGameStore(s => s.saveCustomAgentSoul);
  const closeModal = useGameStore(s => s.closeModal);
  const setFollowAgent = useGameStore(s => s.setFollowAgent);
  const workshopMode = useGameStore(s => s.workshopMode);

  const [mode, setMode] = useState<'list' | 'create'>(workshopMode === 'create' ? 'create' : 'list');
  const [editId, setEditId] = useState(selectedAgentId || Object.keys(agents)[0] || 'xau');
  const [tab, setTab] = useState<'info' | 'config' | 'soul'>('info');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const [draft, setDraft] = useState<CustomAgentDraft>({ ...DEFAULT_DRAFT });

  const shopUnlocks = useGameStore(s => s.shopUnlocks);
  const shopCatalog = useGameStore(s => s.shopCatalog);
  const customMeta = loadCustomAgentMeta(getStoredAccount()?.id);
  const limits = countCustomByType(customMeta);

  const agentList = Object.values(agents) as CharState[];
  const current = editId ? agents[editId] : null;
  const d = current?.data;
  const custom = editId ? isCustomAgent(editId) : false;
  const aType = agentTypeOf(d);
  const showConfigTab = !custom && aType === 'trading';
  const localSoul = custom ? (d?.soulMd ?? '') : soulMd;

  useEffect(() => {
    if (workshopMode === 'create') setMode('create');
    else if (workshopMode === 'list') setMode('list');
  }, [workshopMode]);

  useEffect(() => {
    const fallback = selectedAgentId || Object.keys(agents)[0];
    if (fallback && fallback !== editId && mode === 'list') setEditId(fallback);
  }, [selectedAgentId, agents, editId, mode]);

  useEffect(() => {
    if (!editId || mode !== 'list' || custom) {
      if (custom && d?.soulMd) setProfile([], {}, d.soulMd);
      return;
    }
    setLoading(true);
    fetchAgentProfile(editId).then(data => {
      if (!data.error) setProfile(data.schema?.fields || [], data.config || {}, data.soul_md || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [editId, setProfile, mode, custom, d?.soulMd]);

  const pickAgent = (id: string) => {
    setMode('list');
    setEditId(id);
    selectAgent(id);
    setTab('info');
    setMsg('');
  };

  const handleCreate = async () => {
    if (!draft.name.trim()) {
      setMsg('请填写 Agent 名称');
      return;
    }
    if (draft.soul.trim().length < 20) {
      setMsg('请填写 SOUL 文档（至少 20 字）');
      return;
    }
    if (!canCreateAgentType(draft.agentType, customMeta)) {
      setMsg(draft.agentType === 'entertainment' ? '娱乐 Agent 已达上限（1 个）' : '交易 Agent 已达上限（3 个）');
      return;
    }
    const ok = await createAgent(draft);
    if (ok) {
      setMode('list');
      setDraft({ ...DEFAULT_DRAFT, soul: DEFAULT_ENTERTAINMENT_SOUL('') });
      setMsg('');
    }
  };

  const setCreateType = (agentType: AgentType) => {
    setDraft(prev => ({
      ...prev,
      agentType,
      soul: agentType === 'entertainment'
        ? DEFAULT_ENTERTAINMENT_SOUL(prev.name)
        : DEFAULT_TRADING_SOUL(prev.name),
    }));
  };

  const colorOptions = unlockedColors(shopCatalog, shopUnlocks);
  const hatOptions = unlockedHatStyles(shopUnlocks);

  if (mode === 'create') {
    const entertainment = draft.agentType === 'entertainment';
    return (
      <div style={{ color: '#3d3530', maxHeight: 520, overflowY: 'auto' }} className="workshop-create">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>创建新 Agent</div>
          <button className="ui-btn" onClick={() => setMode('list')}>返回列表</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['entertainment', 'trading'] as AgentType[]).map(t => (
            <button key={t} type="button" className={`ui-btn ${draft.agentType === t ? 'active' : ''}`}
              style={{ flex: 1, padding: '10px 0' }} onClick={() => setCreateType(t)}>
              {t === 'entertainment' ? '🎮 娱乐 Agent' : '📈 交易 Agent'}
            </button>
          ))}
        </div>

        <p style={{ fontSize: 12, color: '#8a7e72', marginBottom: 14, lineHeight: 1.5 }}>
          {entertainment
            ? '娱乐 Agent 只需配置外形与 SOUL，不占交易工位，出生在沙发休息区。'
            : '交易 Agent 需配置策略与 SOUL，占用扩展工位（最多 3 个）。'}
          <br />
          <span style={{ fontSize: 11, color: '#9a8b7a' }}>
            已创建：娱乐 {limits.entertainment}/1 · 交易 {limits.trading}/3
          </span>
        </p>

        <div className="workshop-grid-create" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
          <div>
            <Field label="名称">
              <input value={draft.name}
                onChange={e => setDraft({
                  ...draft,
                  name: e.target.value,
                  soul: entertainment ? DEFAULT_ENTERTAINMENT_SOUL(e.target.value) : DEFAULT_TRADING_SOUL(e.target.value),
                })}
                placeholder="例如：小凤、Alpha Hunter" style={inputStyle} />
            </Field>

            <Field label="外形 · 配饰类型">
              <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                {(['scarf', 'hat'] as AgentHeadwear[]).map(hw => (
                  <button key={hw} type="button" className={`ui-btn ${draft.headwear === hw ? 'active' : ''}`}
                    onClick={() => setDraft({ ...draft, headwear: hw })}
                    style={{ flex: 1, padding: '8px 0' }}>
                    {hw === 'scarf' ? '围巾' : '帽子'}
                  </button>
                ))}
              </div>
            </Field>

            {draft.headwear === 'hat' && (
              <Field label="帽子款式">
                <HatStylePicker value={draft.hatStyle} color={draft.color}
                  onChange={hatStyle => setDraft({ ...draft, hatStyle })} />
              </Field>
            )}

            <Field label={draft.headwear === 'scarf' ? '围巾颜色' : '帽子颜色'}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {colorOptions.map(c => (
                  <button key={c} type="button" onClick={() => setDraft({ ...draft, color: c })}
                    style={{
                      width: 28, height: 28, borderRadius: 6,
                      border: draft.color === c ? '2px solid #d4af37' : '1px solid #ddd',
                      background: c, cursor: 'pointer',
                    }} />
                ))}
              </div>
            </Field>

            <Field label="简介">
              <input value={draft.desc} onChange={e => setDraft({ ...draft, desc: e.target.value })}
                placeholder={entertainment ? '例如：爱逛餐厅的开心果' : 'Agent 职能描述'} style={inputStyle} />
            </Field>

            <Field label="SOUL 文档（必填）">
              <textarea value={draft.soul} onChange={e => setDraft({ ...draft, soul: e.target.value })}
                placeholder={entertainment ? '描述性格、说话方式、行为偏好…' : '描述交易策略灵魂、风控原则、交易性格…'}
                style={{ ...inputStyle, minHeight: 140, fontFamily: 'monospace', fontSize: 12 }} />
            </Field>

            {!entertainment && (
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
            )}

            <button className="ui-btn" style={{ width: '100%', padding: '10px 0', marginTop: 4 }} onClick={handleCreate}>
              {entertainment ? '创建娱乐 Agent 并加入大厅' : '创建交易 Agent 并加入大厅'}
            </button>
            {msg && <div style={{ marginTop: 8, fontSize: 11, color: '#e74c3c' }}>{msg}</div>}
          </div>

          <div style={{ position: 'sticky', top: 0 }}>
            <AgentScenePreview
              color={draft.color}
              headwear={draft.headwear}
              hatStyle={draft.hatStyle}
              name={draft.name}
            />
            <p style={{ fontSize: 10, color: '#9a8b7a', marginTop: 8, lineHeight: 1.45, textAlign: 'center' }}>
              实时预览 · 与游戏场景渲染一致
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tabs = (['info', 'soul'] as const).concat(showConfigTab ? (['config'] as const) : []);

  return (
    <div className="workshop-grid-list" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, minHeight: 360, color: '#3d3530' }}>
      <div style={{ borderRight: '1px dashed #e0d8cc', paddingRight: 12, overflowY: 'auto', maxHeight: 420 }}>
        <button className="ui-btn" style={{
          width: '100%', marginBottom: 10, padding: '8px 0', display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 6, background: '#eef8f0', borderColor: '#48d093',
        }} onClick={() => { setMode('create'); setMsg(''); setDraft({ ...DEFAULT_DRAFT, soul: DEFAULT_ENTERTAINMENT_SOUL('') }); }}>
          <AppIcon icon={PlusIcon} size="mini" color="profit" />
          创建 Agent
        </button>
        <div style={{ fontSize: 11, color: '#9a8b7a', marginBottom: 8 }}>我的 Agent ({agentList.length})</div>
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
              <PenguinAvatar color={a.data.color} headwear={a.data.headwear} hatStyle={a.data.hatStyle} size={36} selected={editId === a.agentId} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{a.data.name}</div>
                <div style={{ fontSize: 10, color: '#8a7e72' }}>
                  {a.data.agentType === 'entertainment' ? '🎮 娱乐' : a.data.running ? '🟢 运行' : '⚪ 停止'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowY: 'auto', maxHeight: 420 }}>
        {!d ? (
          <p style={{ color: '#8a7e72', fontSize: 13 }}>请从左侧选择一个 Agent</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <PenguinAvatar color={d.color} headwear={d.headwear} hatStyle={d.hatStyle} size={64} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: '#8a7e72' }}>{d.desc}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span style={{
                    color: aType === 'entertainment' ? '#a855f7' : '#9a8b7a',
                    fontWeight: aType === 'entertainment' ? 600 : 400,
                  }}>
                    {aType === 'entertainment' ? '娱乐 Agent' : d.strategy}
                  </span>
                  {aType === 'trading' && <> · {d.market} · {d.interval}</>}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {tabs.map(t => (
                <button key={t} className={`panel-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t === 'info' ? '基本信息' : t === 'config' ? '策略参数' : 'SOUL 文档'}
                </button>
              ))}
            </div>

            {loading && !custom && <p style={{ color: '#999', fontSize: 12 }}>加载中…</p>}

            {tab === 'info' && current && (
              <div style={{ fontSize: 13 }}>
                {aType === 'trading' ? (
                  <>
                    <InfoRow k="资金" v={'$' + (d.capital || 0).toLocaleString()} />
                    <InfoRow k="盈亏" v={(d.pnl || 0) >= 0 ? '+$' + d.pnl : '-$' + Math.abs(d.pnl || 0)} cls={(d.pnl || 0) >= 0 ? 'profit' : 'loss'} />
                    <InfoRow k="胜率" v={(d.win_rate || 0).toFixed(1) + '%'} />
                    <InfoRow k="成交" v={String(d.trades || 0) + ' 笔'} />
                    <InfoRow k="风险等级" v={d.risk || '--'} />
                  </>
                ) : (
                  <>
                    <InfoRow k="类型" v="娱乐陪伴" />
                    <InfoRow k="职能" v="场景互动 · 赚取积分" />
                  </>
                )}
                <InfoRow k="压力值" v={Math.round(current.stress) + '%'} icon={<MiniLucide icon={LucideIcons.debuffStress} color="loss" />} />
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button className="ui-btn" style={{ flex: 1 }} onClick={() => { setFollowAgent(editId); closeModal(); }}>跟随镜头</button>
                  <button className="ui-btn" style={{ flex: 1 }} onClick={closeModal}>返回场景</button>
                </div>
              </div>
            )}

            {tab === 'config' && showConfigTab && (
              <>
                {schema.map(f => (
                  <div key={f.key} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: '#7a6e62' }}>{f.label}</label>
                    <input type="number" defaultValue={String(config[f.key] ?? '')} id={'ws-cfg-' + f.key}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #d4c8b8', marginTop: 3 }} />
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
                  key={editId + localSoul.slice(0, 20)}
                  defaultValue={localSoul}
                  id="ws-soul"
                  style={{ width: '100%', minHeight: 200, padding: 8, borderRadius: 6, border: '1px solid #d4c8b8', fontFamily: 'monospace', fontSize: 12 }}
                />
                <button className="ui-btn" style={{ width: '100%', marginTop: 8 }} onClick={async () => {
                  const content = (document.getElementById('ws-soul') as HTMLTextAreaElement).value;
                  if (custom) {
                    const ok = await saveCustomAgentSoul(editId, content);
                    setMsg(ok ? 'SOUL 已保存' : '保存失败');
                  } else {
                    const r = await saveAgentSoul(editId, content);
                    setMsg(r.message || '已保存');
                  }
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: '#7a6e62' }}>{label}</label>
      {children}
    </div>
  );
}
