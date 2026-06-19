import { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { LoginPanel } from './components/ui/LoginPanel';
import { useGameStore } from './store/useGameStore';
import { fetchOverview, fetchTicker } from './lib/api';
import { lifeSessionStart } from './lib/lifeApi';
import { isLoggedIn } from './lib/lifeAuth';
import { syncMood } from './lib/lifeEngagementApi';

import { preloadAllSprites } from './lib/spriteTextures';

export default function App() {
  const initAgents = useGameStore(s => s.initAgents);
  const syncLifeState = useGameStore(s => s.syncLifeState);
  const syncSeats = useGameStore(s => s.syncSeats);
  const syncEngagement = useGameStore(s => s.syncEngagement);
  const updateFromOverview = useGameStore(s => s.updateFromOverview);
  const syncUserPortfolio = useGameStore(s => s.syncUserPortfolio);
  const setTicker = useGameStore(s => s.setTicker);
  const addMessage = useGameStore(s => s.addMessage);
  const loggedIn = isLoggedIn();

  useEffect(() => {
    if (!loggedIn) return;
    initAgents();
    syncLifeState().then(() => useGameStore.getState().restorePokerRoom().catch(() => {}));
    preloadAllSprites().catch(() => {});
    const pollSystem = () => fetchOverview().then(data => {
      updateFromOverview(data);
    }).catch(() => {});
    const pollPortfolio = () => syncUserPortfolio().catch(() => {});
    const tick = () => fetchTicker().then(setTicker).catch(() => {});
    pollSystem(); pollPortfolio(); tick();
    addMessage('欢迎来到交易人生 · 登录后开始挂机与派遣');
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
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        lifeSessionStart().catch(() => {});
        useGameStore.setState({ lastIdleClientTick: 0 });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(a); clearInterval(g); clearInterval(b); clearInterval(c); clearInterval(d); clearInterval(e); clearInterval(f); clearInterval(pokerPoll);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [loggedIn, initAgents, syncLifeState, syncSeats, syncEngagement, updateFromOverview, syncUserPortfolio, setTicker, addMessage]);

  if (!loggedIn) return <LoginPanel />;
  return <AppShell />;
}
