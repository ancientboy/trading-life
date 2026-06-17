/** 大屏滚动行情条目 */
export const MARKET_TICKER_ITEMS: {
  label: string; key: string; mock?: number; fmt?: 'usd' | 'gold' | 'index';
}[] = [
  { label: 'BTC/USDT', key: 'BTCUSDT', fmt: 'usd' },
  { label: 'ETH/USDT', key: 'ETHUSDT', fmt: 'usd' },
  { label: 'XAU/USDT', key: 'XAUUSDT', fmt: 'gold' },
  { label: 'SOL/USDT', key: 'SOLUSDT', fmt: 'usd' },
  { label: '标普 500', key: 'SPX', mock: 5280.4, fmt: 'index' },
  { label: '纳斯达克', key: 'NDX', mock: 16842, fmt: 'index' },
  { label: 'AAPL', key: 'AAPL', mock: 195.3, fmt: 'usd' },
  { label: 'TSLA', key: 'TSLA', mock: 248.6, fmt: 'usd' },
  { label: 'NVDA', key: 'NVDA', mock: 875.2, fmt: 'usd' },
];

export function formatTickerPrice(
  item: typeof MARKET_TICKER_ITEMS[number],
  ticker: Record<string, number>,
): string {
  const p = ticker[item.key] ?? item.mock;
  if (p == null) return '--';
  if (item.fmt === 'gold') return '$' + p.toFixed(2);
  if (item.fmt === 'index') return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (p >= 1000) return '$' + Math.round(p).toLocaleString();
  return '$' + p.toFixed(2);
}
