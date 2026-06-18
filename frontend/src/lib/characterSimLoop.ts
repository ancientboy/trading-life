import { useGameStore, assignPath, pickWanderTarget, onPathComplete, maybeDispatchLeisure, teleportAgentToDestination, awardActivityPoints } from '../store/useGameStore';
import { homeNodeForAgent } from '../lib/agentHome';
import { OfficePath } from './pathfinding';
import { moveWithCollision } from './collision';

const WALK_SPEED = 2.8;
const STUCK_SKIP_FRAMES = 24;
const stuckFrames = new Map<string, number>();

function nextWanderDelay(state: import('./constants').CharState['state']): number {
  if (state === 'trading') return 6000 + Math.random() * 10000;
  if (state === 'scanning') return 2000 + Math.random() * 3500;
  return 3500 + Math.random() * 5500;
}

/** 单帧角色模拟（供 Canvas 2D 引擎调用，不依赖 Three.js） */
const ACTIVITY_END_LABEL: Record<string, string> = {
  rest: '休息', dine: '用餐', massage: '按摩', poker: '德州',
};

export function tickCharacterSim(dt: number) {
  const { paused, agents, patchChar, simSpeed } = useGameStore.getState();
  if (paused) return;
  const scaledDt = dt * simSpeed;
  const now = performance.now();
  const store = useGameStore.getState();
  const mentorPairs = store.mentorPairs;

  // 情绪传染：同座位/同桌 Agent 互相减压
  const bySeat: Record<string, import('./constants').CharState[]> = {};
  Object.values(store.agents).forEach(a => {
    if (a.activity && a.destNode) {
      (bySeat[a.destNode] = bySeat[a.destNode] || []).push(a);
    }
  });
  Object.values(bySeat).forEach(group => {
    if (group.length < 2) return;
    group.forEach(a => {
      let bonus = 0.015 * scaledDt * 1000;
      const mentored = mentorPairs.some(p => p.mentor_agent_id === a.agentId || p.mentee_agent_id === a.agentId);
      if (mentored) bonus *= 1.5;
      const ns = Math.max(0, a.stress - bonus);
      if (ns < a.stress - 0.01) store.patchChar(a.agentId, { ...a, stress: ns });
    });
  });

  Object.values(agents).forEach(char => {
    let c = { ...char };

    if (c.inTransit) {
      const node = c.destNode;
      const pos = node ? OfficePath.nodes[node] : null;
      if (pos) { c.x = pos.x; c.z = pos.z; }
      c = {
        ...c,
        inTransit: false,
        transitUntil: 0,
        transitZone: undefined,
        isWalking: false,
        pathQueue: [],
        pathIndex: 0,
      };
      c = onPathComplete(c, now);
      patchChar(c.agentId, c);
      return;
    }

    if (c.activity && now < c.activityUntil) return;
    if (c.activity && now >= c.activityUntil) {
      const finished = c.activity;
      const seatId = c.destNode;
      const userDispatched = c.userDispatched;
      useGameStore.getState().releaseAgentSeat(c.agentId, seatId);
      c = { ...c, activity: null, activityUntil: 0, activityPose: undefined, moveTimer: 0, nextMoveTime: 1500, travelIntent: null, destNode: null, userDispatched: false };
      if (finished && finished !== 'idle') awardActivityPoints(finished, c.data.name, !!userDispatched);
      const label = ACTIVITY_END_LABEL[finished ?? ''] ?? '休闲';
      const dest = c.data.agentType === 'entertainment' ? '休息区' : '工位';
      if (userDispatched) {
        useGameStore.getState().addMessage(`${c.data.name} 结束${label}，返回${dest}`);
      } else {
        useGameStore.getState().setAgentBubble(c.agentId, `${label}结束～`, now + 3200);
      }
      const home = homeNodeForAgent(c.agentId, c.data);
      if (home) c = assignPath(c, home);
      patchChar(c.agentId, c);
      return;
    }
    if (!c.isWalking && !c.inTransit && c.travelIntent && !c.activity) {
      const node = c.destNode
        || (c.travelIntent === 'massage' ? OfficePath.massageByAgent[c.agentId]
          : c.travelIntent === 'dine' ? OfficePath.dineByAgent[c.agentId]
          : c.travelIntent === 'poker' ? OfficePath.pokerByAgent[c.agentId]
          : OfficePath.boothByAgent[c.agentId]);
      if (node) c = teleportAgentToDestination(c, node, now);
      else c = { ...c, travelIntent: null };
    }
    if (!c.isWalking && !c.travelIntent && !c.activity) c = maybeDispatchLeisure(c);
    c.moveTimer += scaledDt * 1000;
    if (!c.isWalking && !c.travelIntent && c.moveTimer > c.nextMoveTime) {
      const skipTrading = c.state === 'trading' && Math.random() > 0.25;
      if (!skipTrading) {
        c.moveTimer = 0;
        c.nextMoveTime = nextWanderDelay(c.state);
        const target = pickWanderTarget(c);
        const booth = OfficePath.boothByAgent[c.agentId];
        if ([OfficePath.massageByAgent[c.agentId], OfficePath.dineByAgent[c.agentId], OfficePath.pokerByAgent[c.agentId]].includes(target)) {
          const intent = target === OfficePath.massageByAgent[c.agentId] ? 'massage'
            : target === OfficePath.dineByAgent[c.agentId] ? 'dine' : 'poker';
          c = { ...assignPath({ ...c, userDispatched: false }, target), travelIntent: intent };
        } else if (target === booth || target?.startsWith('rest_l')) {
          c = { ...assignPath({ ...c, userDispatched: false }, target), travelIntent: 'rest' };
        } else {
          c = assignPath({ ...c, userDispatched: false }, target);
        }
      } else {
        c.moveTimer = 0;
        c.nextMoveTime = 4000 + Math.random() * 6000;
      }
    }
    if (c.state === 'panic' && !c.isWalking && !c.travelIntent && !c.inTransit) c = assignPath(c, 'scr_ctr');
    if (c.isWalking && c.pathQueue.length) {
      const wp = c.pathQueue[c.pathIndex];
      if (wp) {
        const dx = wp.x - c.x, dz = wp.z - c.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const step = WALK_SPEED * scaledDt;
        if (dist <= step) {
          c.x = wp.x; c.z = wp.z;
          c.pathIndex++;
          if (c.pathIndex >= c.pathQueue.length) c = onPathComplete(c, now);
        } else {
          if (Math.abs(dx) > Math.abs(dz)) c.facing = dx > 0 ? 'e' : 'w';
          else c.facing = dz > 0 ? 's' : 'n';
          const nx = c.x + (dx / dist) * step;
          const nz = c.z + (dz / dist) * step;
          const moved = moveWithCollision(c.x, c.z, nx, nz);
          const newDist = Math.hypot(wp.x - moved.x, wp.z - moved.z);
          if (newDist < dist - 0.04) {
            stuckFrames.set(c.agentId, 0);
            c.x = moved.x;
            c.z = moved.z;
          } else {
            const stuck = (stuckFrames.get(c.agentId) ?? 0) + 1;
            stuckFrames.set(c.agentId, stuck);
            if (moved.x !== c.x || moved.z !== c.z) {
              c.x = moved.x;
              c.z = moved.z;
            }
            if (stuck >= STUCK_SKIP_FRAMES) {
              c.x = wp.x;
              c.z = wp.z;
              c.pathIndex++;
              stuckFrames.set(c.agentId, 0);
              if (c.pathIndex >= c.pathQueue.length) c = onPathComplete(c, now);
            }
          }
        }
      }
    }
    if (c.x !== char.x || c.z !== char.z || c.isWalking !== char.isWalking
      || c.activity !== char.activity || c.travelIntent !== char.travelIntent
      || c.facing !== char.facing || c.inTransit !== char.inTransit) {
      patchChar(c.agentId, c);
    }
  });
}
