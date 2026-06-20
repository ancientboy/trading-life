import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { LoginPanel } from './components/ui/LoginPanel';
import { PublicJoinLanding, PublicLeaderboardView, PublicSpectateView } from './components/ui/PublicViews';
import { useGameStore } from './store/useGameStore';
import { fetchOverview, fetchTicker } from './lib/api';
import { lifeSessionStart } from './lib/lifeApi';
import { isLoggedIn, getStoredAccount } from './lib/lifeAuth';
import { syncMood, fetchArenaRound } from './lib/lifeEngagementApi';
import { clearUrlParams, parseDeepLink, persistDeepLink } from './lib/shareUtils';

import { preloadAllSprites } from './lib/spriteTextures';
import { preloadNiumaSprites } from './lib/characterSprites';

export default function App() {
  const initAgents = useGameStore(s => s.initAgents);
  const syncLifeState = useGameStore(s => s.syncLifeState);
  const syncSeats = useGameStore(s => s.syncSeats);
  const syncEngagement = useGameStore(s => s.syncEngagement);
  const updateFromOverview = useGameStore(s => s.updateFromOverview);
  const syncUserPortfolio = useGameStore(s => s.syncUserPortfolio);
  const setTicker = useGameStore(s => s.setTicker);
  const addMessage = useGameStore(s => s.addMessage);
  const processPendingDeepLink = useGameStore(s => s.processPendingDeepLink);
  const loggedIn = isLoggedIn();
  const deepLink = parseDeepLink();

  useEffect(() => {
    if (!loggedIn) {
      persistDeepLink();
      return;
    }
    initAgents();
    syncLifeState().then(async () => {
      const st = useGameStore.getState();
      if (!sessionStorage.getItem('tl_onboarding_done')) {
        const account = getStoredAccount();
        const name = account?.display_name || account?.username || '小企鹅';
        const created = await st.runQuickOnboarding(name);
        sessionStorage.setItem('tl_onboarding_done', '1');
        if (created) {
          addMessage('欢迎来到交易人生 · 娱乐 Agent 在大厅走动，交易 Agent 已入驻工位');
          const tid = sessionStorage.getItem('tl_trading_onboard');
          if (tid) {
            sessionStorage.removeItem('tl_trading_onboard');
            setTimeout(() => {
              const st = useGameStore.getState();
              st.selectAgent(tid, { tab: 'agent' });
              st.openModal('strategy');
              addMessage('💡 用一句话描述投资风格，30 秒训练你的 AI 交易员');
            }, 2200);
          }
        }
      }
      useGameStore.getState().restorePokerRoom().catch(() => {});
      const postTab = sessionStorage.getItem('tl_post_login_tab');
      if (postTab === 'events') {
        sessionStorage.removeItem('tl_post_login_tab');
        setTimeout(() => {
          useGameStore.setState({ rightTab: 'events', rightPanelCollapsed: false, sidebarActive: 'events' });
          addMessage('🏆 欢迎来到交易竞技 · 猜涨跌 / 短线大赛 / 押冠亚季军');
        }, 800);
      }
      void processPendingDeepLink();
      clearUrlParams();
    });
    preloadAllSprites().catch(() => {});
    preloadNiumaSprites();
    const pollSystem = () => fetchOverview().then(data => {
      updateFromOverview(data);
    }).catch(() => {});
    const pollPortfolio = () => syncUserPortfolio().catch(() => {});
    const tick = () => fetchTicker().then(setTicker).catch(() => {});
    pollSystem(); pollPortfolio(); tick();
    const flashInvite = sessionStorage.getItem('tl_flash_invite');
    if (flashInvite) {
      sessionStorage.removeItem('tl_flash_invite');
      addMessage(flashInvite);
    } else {
      addMessage('欢迎来到交易人生 · 登录后开始挂机与派遣');
    }
    const a = setInterval(pollSystem, 8000);
    const g = setInterval(pollPortfolio, 45000);
    const b = setInterval(tick, 10000);
    const c = setInterval(() => syncSeats(), 15000);
    const d = setInterval(() => useGameStore.getState().tickIdlePoints(performance.now()), 60_000);
    const e = setInterval(() => syncEngagement(), 20000);
    const f = setInterval(() => {
      const st = useGameStore.getState();
      const agents = Object.values(st.agents).map(a => ({
        agent_id: a.agentId,
        stress: Math.round(a.stress),
        mood_tag: a.stress > 60 ? 'stressed' : a.stress < 30 ? 'happy' : 'neutral',
        zone: st.activeZone,
        channel: a.destNode || '',
      }));
      if (agents.length) syncMood(agents).catch(() => {});
    }, 30000);
    const pokerPoll = setInterval(() => {
      const st = useGameStore.getState();
      if (st.activeZone !== 'casino') return;
      if (st.pokerSpectateRoom) return;
      if (st.pokerRoom?.id && st.pokerRoom.status === 'waiting') {
        st.syncPokerRoom().catch(() => {});
      } else {
        st.restorePokerRoom().catch(() => {});
      }
    }, 4000);
    const arenaPoll = setInterval(() => {
      const st = useGameStore.getState();
      if (st.activeZone !== 'arena') return;
      fetchArenaRound().then(r => {
        if (r.ok && r.current) st.setArenaLive(r.current);
      }).catch(() => {});
    }, 5000);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        lifeSessionStart().catch(() => {});
        useGameStore.setState({ lastIdleClientTick: 0 });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(a); clearInterval(g); clearInterval(b); clearInterval(c); clearInterval(d); clearInterval(e); clearInterval(f); clearInterval(pokerPoll); clearInterval(arenaPoll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loggedIn, initAgents, syncLifeState, syncSeats, syncEngagement, updateFromOverview, syncUserPortfolio, setTicker, addMessage, processPendingDeepLink]);

  if (!loggedIn && deepLink.view === 'spectate' && deepLink.room) {
    return <PublicSpectateView roomId={deepLink.room} loggedIn={false} />;
  }
  if (!loggedIn && deepLink.view === 'leaderboard') {
    return <PublicLeaderboardView loggedIn={false} />;
  }
  if (!loggedIn && deepLink.join) {
    return <PublicJoinLanding roomCode={deepLink.join} />;
  }

  if (!loggedIn) {
    return <LoginPanel initialInvite={deepLink.invite || sessionStorage.getItem('tl_pending_invite') || ''} />;
  }
  return <AppShell />;
}
