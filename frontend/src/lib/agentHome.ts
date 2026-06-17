import { OfficePath } from './pathfinding';
import type { AgentData } from './constants';

/** Agent 活动结束后返回的「家」节点 */
export function homeNodeForAgent(agentId: string, data: AgentData): string | null {
  if (data.agentType === 'entertainment') {
    return OfficePath.boothByAgent[agentId] ?? null;
  }
  return OfficePath.deskByAgent[agentId] ?? null;
}
