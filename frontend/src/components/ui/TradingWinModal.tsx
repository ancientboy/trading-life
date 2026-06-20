import { useEffect, useRef, useState } from 'react';
import type { TradeRecord } from '../../lib/constants';
import { useGameStore } from '../../store/useGameStore';
import {
  appBaseUrl, buildTradingShareText, downloadPremiumTradingShareCard,
  shareOrCopy, shareResultMessage,
} from '../../lib/shareUtils';

export type TradingWinData = {
  trade: TradeRecord & { agent_id?: string; agent_name?: string };
  agentName: string;
  first_win: boolean;
};

export function TradingWinModal({ data }: { data: TradingWinData }) {
  const closeModal = useGameStore(s => s.closeModal);
  const addMessage = useGameStore(s => s.addMessage);
  const [sharing, setSharing] = useState(false);
  const autoShared = useRef(false);

  const pnl = data.trade.pnl_amount ?? 0;
  const sym = data.trade.symbol || 'BTCUSDT';

  useEffect(() => {
    if (!data.first_win || autoShared.current) return;
    autoShared.current = true;
    (async () => {
      try {
        const text = buildTradingShareText(data);
        const r = await shareOrCopy({
          title: '交易人生 · 模拟盘首盈',
          text,
          url: appBaseUrl(),
        });
        addMessage(`🎁 首笔盈利 · ${shareResultMessage(r)}`);
        await downloadPremiumTradingShareCard(data, appBaseUrl());
        addMessage('首盈高价值分享卡已保存');
      } catch {
        addMessage('自动分享未完成，可手动点下方按钮');
      }
    })();
  }, [data, addMessage]);

  return (
    <div style={{ color: '#3d3530', textAlign: 'center' }}>
      <div style={{
        padding: 16, borderRadius: 10, marginBottom: 14,
        background: 'linear-gradient(135deg,#fff8e0,#ffe08233)',
        border: '2px solid #ffd700',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🎁</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#8a6e00' }}>
          {data.first_win ? '首笔盈利大礼包！' : '模拟盘盈利！'}
        </div>
        <div style={{ fontSize: 14, marginTop: 10, fontWeight: 600 }}>
          {data.agentName} · {sym} {data.trade.direction}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#2ea872', marginTop: 8 }}>
          +${pnl.toFixed(2)}
        </div>
        <div style={{ fontSize: 11, color: '#8a7e72', marginTop: 6 }}>
          {data.trade.reason || '止盈'} · 模拟盘自动成交
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ui-btn" style={{ flex: 1, padding: '10px 0' }}
          disabled={sharing}
          onClick={async () => {
            setSharing(true);
            try {
              const text = buildTradingShareText(data);
              const r = await shareOrCopy({ title: '交易人生 · 模拟盘', text, url: appBaseUrl() });
              addMessage(shareResultMessage(r));
            } finally {
              setSharing(false);
            }
          }}>
          📤 分享
        </button>
        <button className="ui-btn" style={{ flex: 1, padding: '10px 0' }}
          disabled={sharing}
          onClick={async () => {
            setSharing(true);
            try {
              await downloadPremiumTradingShareCard(data, appBaseUrl());
              addMessage('分享卡已保存');
            } finally {
              setSharing(false);
            }
          }}>
          🖼 海报
        </button>
        <button className="ui-btn" style={{ flex: 1, padding: '10px 0' }} onClick={closeModal}>
          关闭
        </button>
      </div>
    </div>
  );
}
