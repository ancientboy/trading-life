const TOKEN_KEY = 'trading-life-auth-token';
const ACCOUNT_KEY = 'trading-life-account';

export interface LifeAccount {
  id: string;
  username: string;
  display_name: string;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredAccount(): LifeAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? JSON.parse(raw) as LifeAccount : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, account: LifeAccount) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

export function isLoggedIn(): boolean {
  return !!getAuthToken();
}
