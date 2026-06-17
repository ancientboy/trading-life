import { useFrame } from '@react-three/fiber';
import { useGameStore, assignPath, pickWanderTarget, onPathComplete, maybeDispatchLeisure } from '../../store/useGameStore';
import { OfficePath } from '../../lib/pathfinding';

const WALK_SPEED = 2.8;

function nextWanderDelay(state: import('../../lib/constants').CharState['state']): number {
  if (state === 'trading') return 6000 + Math.random() * 10000;
  if (state === 'scanning') return 2000 + Math.random() * 3500;
  return 3500 + Math.random() * 5500;
}

/** 全地图 Agent 行走模拟 — 世界坐标 + 跨区寻路 */
export function CharacterSim() {
  const patchChar = useGameStore(s => s.patchChar);
  const agents = useGameStore(s => s.agents);
  const paused = useGameStore(s => s.paused);
  const simSpeed = useGameStore(s => s.simSpeed);
  const addMessage = useGameStore(s => s.addMessage);

  useFrame((_, dt) => {
    if (paused) return;
    const now = performance.now();
    Object.values(agents).forEach(char => {
      let c = { ...char };
      if (c.activity && now < c.activityUntil) return;
      if (c.activity && now >= c.activityUntil) {
        c = { ...c, activity: null, activityUntil: 0, moveTimer: 0, nextMoveTime: 1500, travelIntent: null };
        c = assignPath(c, OfficePath.deskByAgent[c.agentId]);
        addMessage(`${c.data.name} 结束休闲，返回工位`);
        patchChar(c.agentId, c);
        return;
      }
      if (!c.isWalking && !c.travelIntent && !c.activity) {
        c = maybeDispatchLeisure(c);
      }
      c.moveTimer += dt * 1000 * simSpeed;
      if (!c.isWalking && !c.travelIntent && c.moveTimer > c.nextMoveTime) {
        const skipTrading = c.state === 'trading' && Math.random() > 0.25;
        if (!skipTrading) {
          c.moveTimer = 0;
          c.nextMoveTime = nextWanderDelay(c.state);
          const target = pickWanderTarget(c);
          if ([OfficePath.massageByAgent[c.agentId], OfficePath.dineByAgent[c.agentId], OfficePath.pokerByAgent[c.agentId]].includes(target)) {
            const intent = target === OfficePath.massageByAgent[c.agentId] ? 'massage'
              : target === OfficePath.dineByAgent[c.agentId] ? 'dine' : 'poker';
            c = { ...assignPath(c, target), travelIntent: intent };
          } else if (target === OfficePath.boothByAgent[c.agentId]) {
            c = assignPath(c, target);
          } else {
            c = assignPath(c, target);
          }
        } else {
          c.moveTimer = 0;
          c.nextMoveTime = 4000 + Math.random() * 6000;
        }
      }
      if (c.state === 'panic' && !c.isWalking && !c.travelIntent) c = assignPath(c, 'scr_ctr');
      if (c.isWalking && c.pathQueue.length) {
        const wp = c.pathQueue[c.pathIndex];
        if (wp) {
          const dx = wp.x - c.x, dz = wp.z - c.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const step = WALK_SPEED * dt * simSpeed;
          if (dist <= step) {
            c.x = wp.x; c.z = wp.z;
            c.pathIndex++;
            if (c.pathIndex >= c.pathQueue.length) c = onPathComplete(c, now);
          } else {
            c.x += (dx / dist) * step;
            c.z += (dz / dist) * step;
          }
        }
      }
      if (c.x !== char.x || c.z !== char.z || c.isWalking !== char.isWalking
        || c.activity !== char.activity || c.travelIntent !== char.travelIntent) {
        patchChar(c.agentId, c);
      }
    });
  });
  return null;
}
