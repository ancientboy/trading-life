import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { LoginPanel } from './components/ui/LoginPanel';
import { PublicJoinLanding, PublicLeaderboardView, PublicSpectateView } from './components/ui/PublicViews';
import { useGameStore } from './store/useGameStore';
import { fetchOverview, fetchTicker } from './lib/api';
import { lifeSessionStart } from './lib/lifeApi';
import { isLoggedIn, getStoredAccount } from './lib/lifeAuth';
import { syncMood } from './lib/lifeEngagementApi';
import { clearUrlParams, parseDeepLink, persistDeepLink } from './lib/shareUtils';

import { preloadAllSprites } from './lib/spriteTextures';
import { preloadNiumaSprites } from './lib/characterSprites';

export default function App() {
  const loggedIn = isLoggedIn();
  const deepLink = parseDeepLink();

  useEffect(() => {
    if (!loggedIn) {
      persistDeepLink();
      return;
    }
    const store = () => useGameStore.getState();
    store().initAgents();
    store().syncLifeState().then(async () => {
      const st = store();
      if (!sessionStorage.getItem('tl_onboarding_done')) {
        const account = getStoredAccount();
        const name = account?.display_name || account?.username || '小企鹅';
        const created = await st.runQuickOnboarding(name);
        if (created || store().operableAgentIds.length > 0) {
          sessionStorage.setItem('tl_onboarding_done', '1');
        }
        if (created) {
          st.addMessage('欢迎来到交易人生 · 娱乐 Agent 在大厅走动，交易 Agent 已入驻工位');
          const tid = sessionStorage.getItem('tl_trading_onboard');
          if (tid) {
            sessionStorage.removeItem('tl_trading_onboard');
            setTimeout(() => {
              const s = store();
              s.selectAgent(tid, { tab: 'agent' });
              s.openModal('strategy');
              s.addMessage('💡 用一句话描述投资风格，30 秒训练你的 AI 交易员');
            }, 2200);
          }
        }
      }
      store().restorePokerRoom().catch(() => {});
      const postTab = sessionStorage.getItem('tl_post_login_tab');
      if (postTab === 'events') {
        sessionStorage.removeItem('tl_post_login_tab');
        setTimeout(() => {
          useGameStore.setState({ rightTab: 'events', rightPanelCollapsed: false, sidebarActive: 'events' });
          store().addMessage('🏆 欢迎来到交易竞技 · 猜涨跌 / 短线大赛 / 押冠亚季军');
        }, 800);
      }
      void store().processPendingDeepLink();
      clearUrlParams();
    });
    preloadAllSprites().catch(() => {});
    preloadNiumaSprites();
    const pollSystem = () => {
      if (document.visibilityState !== 'visible') return;
      fetchOverview().then(data => store().updateFromOverview(data)).catch(() => {});
    };
    const pollPortfolio = () => {
      if (document.visibilityState !== 'visible') return;
      store().syncUserPortfolio().catch(() => {});
    };
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      fetchTicker().then(store().setTicker).catch(() => {});
    };
    pollSystem(); pollPortfolio(); tick();
    store().syncTradingLive().catch(() => {});
    const flashInvite = sessionStorage.getItem('tl_flash_invite');
    if (flashInvite) {
      sessionStorage.removeItem('tl_flash_invite');
      store().addMessage(flashInvite);
    } else {
      store().addMessage('欢迎来到交易人生 · 登录后开始挂机与派遣');
    }
    const a = setInterval(pollSystem, 15000);
    const g = setInterval(pollPortfolio, 45000);
    const b = setInterval(tick, 15000);
    const c = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      store().syncSeats();
    }, 15000);
    const d = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      store().tickIdlePoints(performance.now());
    }, 60_000);
    const e = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      store().syncEngagement();
    }, 20000);
    const f = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const st = store();
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
      if (document.visibilityState !== 'visible') return;
      const st = store();
      if (st.activeZone !== 'casino') return;
      if (st.pokerSpectateRoom) return;
      if (st.pokerRoom?.id && st.pokerRoom.status === 'waiting') {
        st.syncPokerRoom().catch(() => {});
      } else {
        st.restorePokerRoom().catch(() => {});
      }
    }, 4000);
    const tradingPoll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const st = store();
      const hot = st.rightTab === 'events' || st.activeZone === 'arena';
      if (!hot && Math.random() > 0.35) return;
      st.syncTradingLive().catch(() => {});
    }, 8000);
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        lifeSessionStart().catch(() => {});
        useGameStore.setState({ lastIdleClientTick: 0 });
        store().syncTradingLive().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(a); clearInterval(g); clearInterval(b); clearInterval(c); clearInterval(d); clearInterval(e); clearInterval(f); clearInterval(pokerPoll); clearInterval(tradingPoll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loggedIn]);

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
