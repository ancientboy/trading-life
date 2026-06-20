import { useEffect, useRef, useState } from 'react';
import { fetchPublicTradingDemo, type TradingDemoResult } from '../../lib/lifeEngagementApi';

function drawSparkline(canvas: HTMLCanvasElement, closes: number[], price: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx || closes.length < 2) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const up = closes[closes.length - 1] >= closes[0];

  ctx.strokeStyle = up ? '#48d093' : '#e57373';
  ctx.lineWidth = 2;
  ctx.beginPath();
  closes.forEach((c, i) => {
    const x = (i / (closes.length - 1)) * (w - 8) + 4;
    const y = h - 4 - ((c - lo) / (hi - lo)) * (h - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = up ? 'rgba(72,208,147,0.15)' : 'rgba(229,115,115,0.12)';
  ctx.lineTo(w - 4, h - 4);
  ctx.lineTo(4, h - 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#5c4a32';
  ctx.font = 'bold 11px system-ui,sans-serif';
  ctx.fillText(`BTC $${Math.round(price).toLocaleString()}`, 6, 14);
}

export function TradingDemoHook() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TradingDemoResult | null>(null);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await fetchPublicTradingDemo();
      if (!r.ok) {
        setError(r.error || '加载失败');
        return;
      }
      setData(r);
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!data?.closes?.length || !canvasRef.current) return;
    drawSparkline(canvasRef.current, data.closes, data.price ?? data.closes[data.closes.length - 1]);
  }, [data]);

  return (
    <div style={{
      marginTop: 12, padding: '12px 14px', borderRadius: 10,
      background: 'linear-gradient(135deg,#eef4ff,#faf6ef)',
      border: '1px solid #b8cce8',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3a6bb5', marginBottom: 6 }}>
        📈 AI 模拟交易 · 实时试看
      </div>
      <p style={{ fontSize: 11, color: '#7a6e62', margin: '0 0 8px', lineHeight: 1.45 }}>
        {data?.message || '注册即送 5 万 USDT 模拟盘 · 一句话训练 AI 交易员'}
      </p>

      <canvas ref={canvasRef} width={340} height={72}
        style={{ width: '100%', height: 72, borderRadius: 6, background: '#faf6ef', display: 'block' }} />

      {busy && !data && (
        <p style={{ fontSize: 11, color: '#9a8b7a', marginTop: 8 }}>加载行情…</p>
      )}
      {error && <p style={{ color: '#e55', fontSize: 11, marginTop: 6 }}>{error}</p>}

      {data?.trades && data.trades.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 4 }}>最近成交 · 系统 Agent</div>
          {data.trades.slice(0, 5).map((t, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', fontSize: 10,
              padding: '3px 0', color: '#6b5e4e',
            }}>
              <span>{t.agent} · {t.symbol} {t.direction}</span>
              <span style={{ color: t.pnl_amount >= 0 ? '#2ea872' : '#c07070', fontWeight: 600 }}>
                {t.pnl_amount >= 0 ? '+' : ''}{t.pnl_amount.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}

      <button className="ui-btn" style={{ width: '100%', marginTop: 8, fontSize: 11, padding: '6px 0' }}
        disabled={busy} onClick={() => void load()}>
        刷新行情
      </button>
    </div>
  );
}
