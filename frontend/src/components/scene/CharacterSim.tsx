import { useFrame } from '@react-three/fiber';
import { useGameStore, assignPath, onPathComplete } from '../../store/useGameStore';
import { tickAgentBrain, brainDispatchLeisure } from '../../lib/agentBrain';
import { OfficePath } from '../../lib/pathfinding';

const WALK_SPEED = 2.8;

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
        c = brainDispatchLeisure(c, now);
        if (!c.isWalking && !c.travelIntent) c = tickAgentBrain(c, now);
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
