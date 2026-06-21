/**
 * 三层 Agent 智能体大脑（对标 AI 坦克控制逻辑）
 *
 * ┌─ 感知层 Perception ─ 压力、区域、附近 Agent、师徒关系
 * ├─ 决策层 Decision  ─ 三套自由逻辑（随机加权）
 * │    social    ≈ 坦克「狩猎」— 主动社交、找人聊天
 * │    explore   ≈ 坦克「巡逻」— 按好奇心漫游探索
 * │    self_care ≈ 坦克「撤退」— 压力高时自我调节
 * └─ 执行层 Action   ─ 路径、活动、气泡、频道发言
 */
import type { CharState } from './constants';
import { zoneAtPosition } from './collision';
import { OfficePath } from './pathfinding';
import {
  assignPath, useGameStore,
} from '../store/useGameStore';
import { ACTIVITY_ZONE } from './seatRegistry';
import { chatChannelForZone, agentBrainDialogue, agentBrainTeaParty, type ChatMessage } from './lifeEngagementApi';
import { agentBrainSpeak } from './lifeEngagementApi';

export type BrainMode = 'social' | 'explore' | 'self_care';

export interface AgentTraits {
  social: number;
  curiosity: number;
  selfCare: number;
  randomness: number;
  patience: number;
}

export interface AgentPerception {
  agentId: string;
  zone: string;
  stress: number;
  state: CharState['state'];
  activity: CharState['activity'];
  nearbyAgents: CharState[];
  nearbyNames: string[];
  traits: AgentTraits;
  moodTag: string;
  hasMentorLink: boolean;
}

export interface BrainDecision {
  mode: BrainMode;
  /** 移动目标节点 */
  targetNode: string;
  travelIntent: CharState['travelIntent'];
  /** 是否到达后发言 */
  speakOnArrive: boolean;
  /** 是否写入区域频道 */
  postToChat: boolean;
  speakContext: string;
  targetAgentName: string;
}

interface BrainMemory {
  nextThinkAt: number;
  lastMode: BrainMode;
  lastSpeakAt: number;
  lastChatAt: number;
  traits: AgentTraits;
  socialTargetId?: string;
  pendingDialogueTargetId?: string;
}

const brainMem = new Map<string, BrainMemory>();
const dialogueCooldown = new Map<string, number>();
const teaPartyCooldown = new Map<string, number>();
let lastSocialScanAt = 0;
let socialEventsBusy = false;

const DIALOGUE_COOLDOWN_MS = 90000;
const TEA_PARTY_COOLDOWN_MS = 180000;
const SOCIAL_SCAN_INTERVAL_MS = 5000;
const PROXIMITY_DIST = 1.8;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 从 SOUL + 类型推导稳定性格（与后端 agent_brain.derive_traits 对齐） */
export function deriveAgentTraits(char: CharState): AgentTraits {
  const soul = char.data.soulMd || '';
  const type = char.data.agentType || 'trading';
  const h = hashStr(`${char.agentId}:${soul}:${type}`);
  let social = 35 + (h % 45);
  let curiosity = 35 + ((h >> 4) % 45);
  let selfCare = 35 + ((h >> 8) % 45);
  let randomness = 30 + ((h >> 12) % 50);
  let patience = 35 + ((h >> 16) % 45);

  if (/活泼|热情|社交|陪伴|幽默|外向/i.test(soul)) { social += 18; curiosity += 8; }
  if (/冷静|理性|专注|观望|纪律/i.test(soul)) { social -= 12; selfCare += 8; patience += 15; }
  if (/冒险|激进|冲动|高波动/i.test(soul)) { randomness += 20; curiosity += 12; selfCare -= 10; }
  if (/休息|按摩|放松|休闲|扑克|德州/i.test(soul)) { selfCare += 15; curiosity += 5; }
  if (/好奇|探索|闲逛|见闻/i.test(soul)) { curiosity += 20; social += 5; }
  if (type === 'entertainment') { social += 22; curiosity += 12; }
  else { social -= 15; patience += 10; selfCare += 5; }

  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return {
    social: clamp(social),
    curiosity: clamp(curiosity),
    selfCare: clamp(selfCare),
    randomness: clamp(randomness),
    patience: clamp(patience),
  };
}

function moodFromStress(stress: number): string {
  if (stress >= 75) return 'anxious';
  if (stress >= 55) return 'tired';
  if (stress <= 25) return 'relaxed';
  return 'neutral';
}

function getMemory(char: CharState): BrainMemory {
  let m = brainMem.get(char.agentId);
  if (!m) {
    m = {
      nextThinkAt: 0,
      lastMode: 'explore',
      lastSpeakAt: 0,
      lastChatAt: 0,
      traits: deriveAgentTraits(char),
    };
    brainMem.set(char.agentId, m);
  }
  return m;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function agentDist(a: CharState, b: CharState): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function appendChatMessages(
  channel: string,
  rows: Array<{ id: number; body: string; agent_id: string; created_at: number }>,
  agents: Record<string, CharState>,
) {
  const store = useGameStore.getState();
  if (channel !== chatChannelForZone(store.activeZone)) return;
  const newMsgs: ChatMessage[] = rows.map(r => ({
    id: r.id,
    channel,
    user_id: '',
    display_name: agents[r.agent_id]?.data.name || r.agent_id,
    agent_id: r.agent_id,
    body: r.body,
    kind: 'agent',
    created_at: r.created_at,
  }));
  store.setChatMessages([...store.chatMessages, ...newMsgs]);
  if (rows.length > 0) store.addMessage(`💬 Agent 们正在聊天（${rows.length} 条）`);
}

async function tryAgentDialogue(a: CharState, b: CharState, channel: string, now: number): Promise<void> {
  const key = pairKey(a.agentId, b.agentId);
  if ((dialogueCooldown.get(key) ?? 0) > now) return;
  if (agentDist(a, b) > PROXIMITY_DIST) return;
  const memA = getMemory(a);
  const memB = getMemory(b);
  if (memA.lastMode !== 'social' && memB.lastMode !== 'social') return;
  if (Math.random() > 0.35) return;

  dialogueCooldown.set(key, now + DIALOGUE_COOLDOWN_MS);
  const res = await agentBrainDialogue({
    channel,
    agent_a_id: a.agentId, agent_a_name: a.data.name, agent_a_soul: a.data.soulMd || '',
    agent_b_id: b.agentId, agent_b_name: b.data.name, agent_b_soul: b.data.soulMd || '',
    rounds: 2,
  });
  if (res.ok && res.messages?.length) {
    appendChatMessages(channel, res.messages, useGameStore.getState().agents);
    useGameStore.getState().setAgentBubble(a.agentId, res.messages[0]?.body || '…', now + 5000);
    const last = res.messages[res.messages.length - 1];
    if (last) useGameStore.getState().setAgentBubble(b.agentId, last.body, now + 5500);
  }
}

async function tryTeaParty(zone: string, group: CharState[], channel: string, now: number): Promise<void> {
  if (group.length < 3) return;
  if ((teaPartyCooldown.get(zone) ?? 0) > now) return;
  const avgSocial = group.reduce((s, c) => s + getMemory(c).traits.social, 0) / group.length;
  if (avgSocial < 40 && Math.random() > 0.15) return;
  if (Math.random() > 0.12) return;

  teaPartyCooldown.set(zone, now + TEA_PARTY_COOLDOWN_MS);
  const picked = group.slice(0, 5);
  const res = await agentBrainTeaParty({
    channel, zone,
    agents: picked.map(c => ({ agent_id: c.agentId, name: c.data.name, soul_md: c.data.soulMd || '' })),
  });
  if (res.ok && res.messages?.length) {
    appendChatMessages(channel, res.messages, useGameStore.getState().agents);
    useGameStore.getState().addMessage(`🍵 ${zone} 茶话会 · ${res.topic || '闲聊'}`);
    picked.forEach((c, i) => {
      const msg = res.messages![i];
      if (msg) useGameStore.getState().setAgentBubble(c.agentId, msg.body, now + 6000 + i * 800);
    });
  }
}

/** 区域社交扫描 — Agent 互聊链 + 茶话会 */
export function tickSocialEvents(now: number): void {
  if (socialEventsBusy || now - lastSocialScanAt < SOCIAL_SCAN_INTERVAL_MS) return;
  lastSocialScanAt = now;

  const idle = Object.values(useGameStore.getState().agents).filter(a =>
    !a.isWalking && !a.activity && !a.inTransit && !a.travelIntent && !a.userDispatched,
  );
  const byZone: Record<string, CharState[]> = {};
  idle.forEach(a => {
    const z = zoneAtPosition(a.x, a.z);
    (byZone[z] = byZone[z] || []).push(a);
  });

  socialEventsBusy = true;
  void (async () => {
    try {
      for (const [zone, group] of Object.entries(byZone)) {
        const channel = chatChannelForZone(zone);
        if (group.length >= 3) await tryTeaParty(zone, group, channel, now);
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            await tryAgentDialogue(group[i], group[j], channel, now);
          }
        }
      }
    } finally {
      socialEventsBusy = false;
    }
  })();
}

/** 感知层 — 采集当前 Agent 环境信息 */
export function perceiveAgent(char: CharState, allAgents: CharState[]): AgentPerception {
  const zone = zoneAtPosition(char.x, char.z);
  const nearbyAgents = Object.values(allAgents).filter(a => {
    if (a.agentId === char.agentId || a.inTransit) return false;
    return zoneAtPosition(a.x, a.z) === zone;
  });
  const mentorPairs = useGameStore.getState().mentorPairs;
  const hasMentorLink = mentorPairs.some(
    p => p.mentor_agent_id === char.agentId || p.mentee_agent_id === char.agentId,
  );
  return {
    agentId: char.agentId,
    zone,
    stress: char.stress,
    state: char.state,
    activity: char.activity,
    nearbyAgents,
    nearbyNames: nearbyAgents.map(a => a.data.name),
    traits: getMemory(char).traits,
    moodTag: moodFromStress(char.stress),
    hasMentorLink,
  };
}

/** 决策层 — 三套自由逻辑加权 + 性格随机扰动 */
export function decideAgentAction(perception: AgentPerception, mem: BrainMemory): BrainDecision {
  const { traits, stress, nearbyAgents, state, hasMentorLink } = perception;
  const noise = traits.randomness / 100;
  const jitter = () => (Math.random() - 0.5) * noise * 30;

  let socialScore = traits.social * 0.45 + nearbyAgents.length * 12 + jitter();
  let exploreScore = traits.curiosity * 0.55 + jitter();
  let selfCareScore = traits.selfCare * 0.4 + stress * 0.55 + jitter();

  if (state === 'panic') selfCareScore += 45;
  else if (state === 'trading') { exploreScore -= 25; socialScore -= 15; }
  if (stress > 65) selfCareScore += 20;
  if (nearbyAgents.length > 0) socialScore += 28;
  if (stress < 35) exploreScore += 12;
  if (hasMentorLink) socialScore += 15;

  const scores: Record<BrainMode, number> = {
    social: socialScore,
    explore: exploreScore,
    self_care: selfCareScore,
  };
  const mode = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]) as BrainMode;
  mem.lastMode = mode;
  useGameStore.setState(s => ({ brainVersion: s.brainVersion + 1 }));

  return buildActionForMode(mode, perception, mem);
}

function applyTravelIntent(char: CharState, decision: BrainDecision): CharState {
  const focus = useGameStore.getState().activeZone;
  if (!char.userDispatched && decision.travelIntent) {
    const targetZone = ACTIVITY_ZONE[decision.travelIntent];
    if (targetZone && targetZone !== focus) return char;
  }
  const moved = assignPath({ ...char, userDispatched: false }, decision.targetNode);
  if (moved.activity) return moved;
  if (!decision.travelIntent || moved.travelIntent) return moved;
  return { ...moved, travelIntent: decision.travelIntent };
}

function pickSelfCareIntent(char: CharState, traits: AgentTraits, stress: number): { intent: CharState['travelIntent']; node: string } {
  const weights = [
    { w: traits.selfCare + stress * 0.3, intent: 'massage' as const, node: 'massage' },
    { w: traits.selfCare * 0.8, intent: 'dine' as const, node: 'dine' },
    { w: traits.social * 0.5 + 10, intent: 'poker' as const, node: 'poker' },
    { w: 30, intent: 'rest' as const, node: 'rest' },
  ];
  const total = weights.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const item of weights) {
    r -= item.w;
    if (r <= 0) return { intent: item.intent, node: item.node };
  }
  return { intent: 'rest', node: 'rest' };
}

function resolveNode(char: CharState, kind: string, target?: CharState): string {
  if (target) {
    if (target.destNode) return target.destNode;
    const booth = OfficePath.boothByAgent[target.agentId];
    const desk = OfficePath.deskByAgent[target.agentId];
    if (booth) return booth;
    if (desk) return desk;
  }
  switch (kind) {
    case 'massage': return OfficePath.massageByAgent[char.agentId];
    case 'dine': return OfficePath.dineByAgent[char.agentId];
    case 'poker': return OfficePath.pokerByAgent[char.agentId];
    case 'rest': return OfficePath.boothByAgent[char.agentId];
    case 'hall': return 'hall_coffee';
    case 'scr': return 'scr_ctr';
    default: return OfficePath.boothByAgent[char.agentId];
  }
}

function pickExploreTarget(char: CharState, traits: AgentTraits): string {
  const desk = OfficePath.deskByAgent[char.agentId];
  const booth = OfficePath.boothByAgent[char.agentId];
  const entertainment = char.data.agentType === 'entertainment';
  const r = Math.random() + traits.curiosity / 200;

  if (entertainment) {
    if (r > 0.85) return OfficePath.massageByAgent[char.agentId];
    if (r > 0.65) return OfficePath.dineByAgent[char.agentId];
    if (r > 0.45) return OfficePath.pokerByAgent[char.agentId];
    if (r > 0.25) return booth;
    return 'hall_coffee';
  }
  if (char.state === 'trading') {
    if (r > 0.65) return booth;
    if (r > 0.35) return 'scr_ctr';
    return desk;
  }
  if (char.stress > 45 && r > 0.6) return OfficePath.massageByAgent[char.agentId];
  if (r > 0.55) return booth;
  if (r > 0.35) return 'scr_ctr';
  return desk;
}

function pickSocialTarget(char: CharState, nearby: CharState[], mem: BrainMemory): CharState | null {
  if (!nearby.length) return null;
  const mentorPairs = useGameStore.getState().mentorPairs;
  const linked = nearby.filter(a =>
    mentorPairs.some(p =>
      (p.mentor_agent_id === char.agentId && p.mentee_agent_id === a.agentId)
      || (p.mentee_agent_id === char.agentId && p.mentor_agent_id === a.agentId),
    ),
  );
  if (linked.length) return linked[Math.floor(Math.random() * linked.length)];
  if (mem.socialTargetId) {
    const prev = nearby.find(a => a.agentId === mem.socialTargetId);
    if (prev && Math.random() > 0.35) return prev;
  }
  return nearby[Math.floor(Math.random() * nearby.length)];
}

function buildActionForMode(mode: BrainMode, p: AgentPerception, mem: BrainMemory): BrainDecision {
  const char = useGameStore.getState().agents[p.agentId];
  if (!char) {
    return {
      mode, targetNode: 'hall_coffee', travelIntent: null,
      speakOnArrive: false, postToChat: false, speakContext: 'greeting', targetAgentName: '',
    };
  }

  if (mode === 'self_care') {
    const pick = pickSelfCareIntent(char, p.traits, p.stress);
    const node = resolveNode(char, pick.node);
    const isLeisure = pick.intent === 'massage' || pick.intent === 'dine' || pick.intent === 'poker';
    return {
      mode,
      targetNode: node,
      travelIntent: isLeisure ? pick.intent : 'rest',
      speakOnArrive: true,
      postToChat: Math.random() < 0.15,
      speakContext: 'self_care',
      targetAgentName: '',
    };
  }

  if (mode === 'social') {
    const target = pickSocialTarget(char, p.nearbyAgents, mem);
    mem.socialTargetId = target?.agentId;
    if (target) {
      const node = resolveNode(char, 'rest', target);
      return {
        mode,
        targetNode: node,
        travelIntent: null,
        speakOnArrive: true,
        postToChat: Math.random() < 0.45,
        speakContext: 'agent_to_agent',
        targetAgentName: target.data.name,
      };
    }
    const hub = Math.random() > 0.5 ? 'hall_coffee' : resolveNode(char, 'rest');
    return {
      mode,
      targetNode: hub,
      travelIntent: hub.startsWith('rest') ? 'rest' : null,
      speakOnArrive: true,
      postToChat: Math.random() < 0.25,
      speakContext: 'social_approach',
      targetAgentName: '',
    };
  }

  // explore
  const target = pickExploreTarget(char, p.traits);
  const isMassage = target === OfficePath.massageByAgent[char.agentId];
  const isDine = target === OfficePath.dineByAgent[char.agentId];
  const isPoker = target === OfficePath.pokerByAgent[char.agentId];
  const isRest = target === OfficePath.boothByAgent[char.agentId] || target.startsWith('rest_l');
  let travelIntent: CharState['travelIntent'] = null;
  if (isMassage) travelIntent = 'massage';
  else if (isDine) travelIntent = 'dine';
  else if (isPoker) travelIntent = 'poker';
  else if (isRest) travelIntent = 'rest';

  return {
    mode,
    targetNode: target,
    travelIntent,
    speakOnArrive: Math.random() < 0.2,
    postToChat: Math.random() < 0.08,
    speakContext: 'wandering',
    targetAgentName: '',
  };
}

/** 执行层 — 异步发言（气泡 + 可选频道） */
export async function executeBrainSpeak(
  char: CharState,
  decision: BrainDecision,
  now: number,
): Promise<void> {
  const mem = getMemory(char);
  if (now - mem.lastSpeakAt < 8000) return;
  mem.lastSpeakAt = now;

  const zone = zoneAtPosition(char.x, char.z);
  const channel = chatChannelForZone(zone, char.destNode);
  const perception = perceiveAgent(char, Object.values(useGameStore.getState().agents));

  try {
    const res = await agentBrainSpeak({
      agent_id: char.agentId,
      agent_name: char.data.name,
      soul_md: char.data.soulMd || '',
      context: decision.speakContext,
      activity: char.activity,
      stress: char.stress,
      mood_tag: perception.moodTag,
      decision_mode: decision.mode,
      nearby_names: perception.nearbyNames,
      target_agent_name: decision.targetAgentName,
      post_to_chat: decision.postToChat && now - mem.lastChatAt > 25000,
      channel,
    });
    if (!res?.ok) return;
    if (res.line) {
      useGameStore.getState().setAgentBubble(char.agentId, res.line, now + 4800);
    }
    if (res.chat && decision.postToChat) {
      mem.lastChatAt = now;
      const msgs = useGameStore.getState().chatMessages;
      if (channel === chatChannelForZone(useGameStore.getState().activeZone)) {
        useGameStore.getState().setChatMessages([
          ...msgs,
          {
            id: res.chat.id,
            channel,
            user_id: '',
            display_name: char.data.name,
            agent_id: char.agentId,
            body: res.line || '',
            kind: 'agent',
            created_at: res.chat.created_at,
          },
        ]);
      }
    }
  } catch { /* ignore */ }
}

function thinkIntervalMs(traits: AgentTraits): number {
  return 3500 + traits.patience * 40 + Math.random() * 4000;
}

/**
 * 大脑主循环 — 在 characterSimLoop 中调用
 * 返回更新后的 char（可能已开始移动）
 */
export function tickAgentBrain(char: CharState, now: number): CharState {
  if (char.inTransit || char.activity || char.isWalking || char.travelIntent) return char;
  if (char.userDispatched) return char;

  const mem = getMemory(char);
  if (now < mem.nextThinkAt) return char;
  mem.nextThinkAt = now + thinkIntervalMs(mem.traits);

  const agents = Object.values(useGameStore.getState().agents);
  const perception = perceiveAgent(char, agents);
  const decision = decideAgentAction(perception, mem);

  let c = char;
  if (decision.travelIntent || decision.targetNode) {
    c = applyTravelIntent(c, decision);
  }

  if (decision.speakOnArrive) {
    // 到达后再说 — 存到 pending；简化为立即说（社交模式）
    if (decision.mode === 'social' || decision.postToChat) {
      void executeBrainSpeak(c, decision, now);
    }
  }

  return c;
}

/** 兼容旧接口 — 高压力自我调节（并入 self_care 决策） */
export function brainDispatchLeisure(char: CharState, now: number): CharState {
  if (char.stress < 50) return char;
  const mem = getMemory(char);
  mem.nextThinkAt = now;
  const perception = perceiveAgent(char, Object.values(useGameStore.getState().agents));
  const decision = buildActionForMode('self_care', perception, mem);
  if (!decision.travelIntent) return char;
  return applyTravelIntent(char, decision);
}

export function getAgentBrainMode(agentId: string): BrainMode | null {
  return brainMem.get(agentId)?.lastMode ?? null;
}

export function brainModeLabel(mode: BrainMode): string {
  return { social: '社交', explore: '漫游', self_care: '调节' }[mode];
}
