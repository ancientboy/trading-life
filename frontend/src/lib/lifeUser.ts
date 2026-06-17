const USER_KEY = 'trading-life-user-id';

export function getLifeUserId(): string {
  try {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = `u_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  } catch {
    return 'u_anonymous';
  }
}
