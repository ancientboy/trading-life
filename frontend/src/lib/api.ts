const API = '/trading';

export async function fetchOverview() {
  const r = await fetch(`${API}/api/overview`);
  return r.json();
}

export async function fetchTicker() {
  const r = await fetch(`${API}/api/ticker`);
  return r.json();
}

export async function fetchAgentProfile(agentId: string) {
  const r = await fetch(`${API}/api/agent/${agentId}/profile`);
  return r.json();
}

export async function saveAgentConfig(agentId: string, config: Record<string, unknown>) {
  const r = await fetch(`${API}/api/agent/${agentId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  return r.json();
}

export async function saveAgentSoul(agentId: string, content: string) {
  const r = await fetch(`${API}/api/agent/${agentId}/soul`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return r.json();
}
