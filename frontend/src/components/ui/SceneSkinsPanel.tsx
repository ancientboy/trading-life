import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
  SKIN_ZONES, SKIN_ZONE_LABELS, ZONE_SKIN_OPTIONS, isZoneSkinOwned,
  type SkinZone,
} from '../../lib/zoneSkins';

export function SceneSkinsPanel({ compact = false }: { compact?: boolean }) {
  const zoneSkins = useGameStore(s => s.zoneSkins);
  const shopUnlocks = useGameStore(s => s.shopUnlocks);
  const activeZone = useGameStore(s => s.activeZone);
  const setZoneSkin = useGameStore(s => s.setZoneSkin);
  const openModal = useGameStore(s => s.openModal);
  const [skinBusy, setSkinBusy] = useState<string | null>(null);

  const ownedPackCount = shopUnlocks.filter(id => id.startsWith('zone_skin_') || id.startsWith('skin_')).length;

  const applySkin = async (zone: SkinZone, skinId: string) => {
    const key = `${zone}:${skinId}`;
    if (skinBusy === key || zoneSkins[zone] === skinId) return;
    setSkinBusy(key);
    await setZoneSkin(zone, skinId);
    setSkinBusy(null);
  };

  return (
    <div style={{ color: '#3d3530' }}>
      {!compact && (
        <>
          <p style={{ fontSize: 12, color: '#8a7e72', margin: '0 0 12px', lineHeight: 1.5 }}>
            为各区域切换已购买的场景皮肤。切换后进入对应区域即可看到新风格（大厅沙发、餐厅灯笼、理疗装饰、德州厅灯光等）。
          </p>
          {ownedPackCount === 0 && (
            <div style={{ padding: 12, background: '#fff8e8', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#8a6a28' }}>
              你还没有购买区域皮肤包。请先到
              <button type="button" className="ui-btn" style={{ margin: '0 4px', padding: '2px 8px', fontSize: 11 }}
                onClick={() => openModal('shop')}>积分商城</button>
              购买「区域皮肤包」。
            </div>
          )}
        </>
      )}
      <p style={{ fontSize: 11, color: '#9a8b7a', margin: compact ? '0 0 10px' : '0 0 10px' }}>
        当前所在区域：{SKIN_ZONE_LABELS[activeZone as SkinZone] ?? activeZone}
      </p>
      {SKIN_ZONES.map(zone => (
        <div key={zone} style={{ marginBottom: 14, padding: 10, background: '#faf6ef', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>{SKIN_ZONE_LABELS[zone]}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ZONE_SKIN_OPTIONS[zone].filter(opt => isZoneSkinOwned(zone, opt.id, shopUnlocks)).map(opt => {
              const active = zoneSkins[zone] === opt.id;
              const busy = skinBusy === `${zone}:${opt.id}`;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className="ui-btn"
                  disabled={active || !!skinBusy}
                  onClick={() => applySkin(zone, opt.id)}
                  style={{
                    fontSize: 11,
                    padding: '6px 10px',
                    background: active ? '#d4af37' : '#fff',
                    color: active ? '#fff' : '#3d3530',
                    border: active ? 'none' : '1px solid #e0d8cc',
                    opacity: busy ? 0.6 : 1,
                  }}
                  title={opt.desc}
                >
                  {opt.preview} {opt.label}{active ? ' · 使用中' : ''}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
