import { useGameStore, assignPath, pickWanderTarget, onPathComplete, maybeDispatchLeisure } from '../store/useGameStore';
import { OfficePath } from './pathfinding';
import { moveWithCollision } from './collision';

const WALK_SPEED = 2.8;

function nextWanderDelay(state: import('./constants').CharState['state']): number {
  if (state === 'trading') return 6000 + Math.random() * 10000;
  if (state === 'scanning') return 2000 + Math.random() * 3500;
  return 3500 + Math.random() * 5500;
}

/** 单帧角色模拟（供 Canvas 2D 引擎调用，不依赖 Three.js） */
export function tickCharacterSim(dt: number) {
  const { paused, agents, patchChar, addMessage, simSpeed } = useGameStore.getState();
  if (paused) return;
  const scaledDt = dt * simSpeed;
  const now = performance.now();
  Object.values(agents).forEach(char => {
    let c = { ...char };

    if (c.inTransit) {
      if (now < (c.transitUntil ?? 0)) return;
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
      c = { ...c, activity: null, activityUntil: 0, moveTimer: 0, nextMoveTime: 1500, travelIntent: null };
      c = assignPath(c, OfficePath.deskByAgent[c.agentId]);
      addMessage(`${c.data.name} 结束休闲，返回工位`);
      patchChar(c.agentId, c);
      return;
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
          c = { ...assignPath(c, target), travelIntent: intent };
        } else if (target === booth || target?.startsWith('rest_l')) {
          c = { ...assignPath(c, target), travelIntent: 'rest' };
        } else {
          c = assignPath(c, target);
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
          c.x = moved.x;
          c.z = moved.z;
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
