import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts';

export type KlineCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function MiniKlineChart({
  candles,
  height = 160,
  symbol,
}: {
  candles: KlineCandle[];
  height?: number;
  symbol?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      width: hostRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#faf6ef' },
        textColor: '#6a5a4a',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(180,160,140,0.15)' },
        horzLines: { color: 'rgba(180,160,140,0.15)' },
      },
      rightPriceScale: { borderColor: 'rgba(180,160,140,0.25)' },
      timeScale: { borderColor: 'rgba(180,160,140,0.25)', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#2e7d32',
      downColor: '#c62828',
      borderUpColor: '#2e7d32',
      borderDownColor: '#c62828',
      wickUpColor: '#2e7d32',
      wickDownColor: '#c62828',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (hostRef.current) chart.applyOptions({ width: hostRef.current.clientWidth });
    });
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    seriesRef.current.setData(
      candles.map(c => ({
        time: c.time as import('lightweight-charts').UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  if (!candles.length) {
    return (
      <div style={{
        height, background: '#faf6ef', borderRadius: 8, border: '1px solid #ebe4d8',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#9a8b7a',
      }}>
        K 线加载中…
      </div>
    );
  }

  const last = candles[candles.length - 1];
  const first = candles[0];
  const chg = first.close ? ((last.close - first.close) / first.close) * 100 : 0;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, fontSize: 11 }}>
        <span style={{ fontWeight: 700, color: '#5a4a3a' }}>{symbol || 'BTC'} · 实时 K 线</span>
        <span className={chg >= 0 ? 'profit' : 'loss'} style={{ fontWeight: 600 }}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
        </span>
      </div>
      <div ref={hostRef} style={{ width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid #ebe4d8' }} />
    </div>
  );
}
