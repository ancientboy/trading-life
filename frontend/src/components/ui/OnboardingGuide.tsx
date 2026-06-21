import { useGameStore } from '../../store/useGameStore';

const STEPS = [
  {
    title: '① 认识你的 Agent',
    body: '左侧「Agent 工坊」可查看娱乐 Agent 与交易 Agent。交易 Agent 会 24h 在工位模拟盯盘。',
    action: '打开工坊',
    run: (s: ReturnType<typeof useGameStore.getState>) => s.navigateSidebar('agents'),
  },
  {
    title: '② 看模拟盘盈亏',
    body: '顶部显示模拟总资产。点左侧「资产持仓」查看持仓、现金与 Agent 资金分布。',
    action: '查看资产',
    run: (s: ReturnType<typeof useGameStore.getState>) => s.navigateSidebar('positions'),
  },
  {
    title: '③ 领任务或去竞技',
    body: '右栏「每日任务」领积分；想玩猜涨跌 / 短线大赛，点左侧「交易竞技」进竞技馆。',
    action: '去竞技馆',
    run: (s: ReturnType<typeof useGameStore.getState>) => s.navigateSidebar('events'),
  },
] as const;

export function OnboardingGuide() {
  const step = Number(sessionStorage.getItem('tl_guide_step') || '0');
  const done = sessionStorage.getItem('tl_onboarding_guide_done') === '1' || step >= STEPS.length;
  if (done) return null;

  const current = STEPS[step];
  const advance = () => {
    const next = step + 1;
    if (next >= STEPS.length) sessionStorage.setItem('tl_onboarding_guide_done', '1');
    else sessionStorage.setItem('tl_guide_step', String(next));
    window.dispatchEvent(new Event('tl-guide-update'));
  };

  return (
    <div style={{
      marginBottom: 12, padding: 12, borderRadius: 10,
      background: 'linear-gradient(135deg,#fff8e8,#f0faf4)',
      border: '1px solid #e8dcc8',
    }}>
      <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 4 }}>新手引导 · {step + 1}/{STEPS.length}</div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{current.title}</div>
      <p style={{ fontSize: 11, color: '#7a6e62', lineHeight: 1.5, marginBottom: 10 }}>{current.body}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="ui-btn" style={{ flex: 1, fontSize: 11 }}
          onClick={() => { current.run(useGameStore.getState()); advance(); }}>
          {current.action}
        </button>
        <button type="button" className="ui-btn" style={{ fontSize: 11, padding: '4px 10px' }}
          onClick={advance}>
          跳过
        </button>
      </div>
    </div>
  );
}
