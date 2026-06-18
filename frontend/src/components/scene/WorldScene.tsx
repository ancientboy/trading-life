import { useMemo } from 'react';
import * as THREE from 'three';
import { ZONES } from '../../lib/pathfinding';
import { WORLD_BOOTHS } from '../../lib/worldMap';
import { InstancedBoxes } from './furniture/InstancedFurniture';
import { Gugugaga } from './characters/Gugugaga';
import { ZoneEffects } from './effects/ZoneEffects';
import { SceneSprite } from './ui/SceneSprite';
import { RestBoothWorld } from './world/RestBoothWorld';
import { ZoneNavArrows } from './world/ZoneNavArrows';
import { useGameStore } from '../../store/useGameStore';
import type { CharState } from '../../lib/constants';
import type { ZoneId } from '../../store/useGameStore';

function Wall({ x, z, w, d, h = 1.8 }: { x: number; z: number; w: number; d: number; h?: number }) {
  return (
    <mesh position={[x, h / 2, z]}>
      <boxGeometry args={[w, h, d]} />
      <meshToonMaterial color="#c8baa8" />
    </mesh>
  );
}

function ZoneLabel3D({ label, position, color = '#6b5e4e' }: {
  label: string; position: [number, number, number]; color?: string;
}) {
  const map = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,252,247,0.94)';
    ctx.strokeStyle = '#e0d8cc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 40, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 22px Inter,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 128, 30);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [label, color]);

  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} renderOrder={8}>
      <planeGeometry args={[2.8, 0.52]} />
      <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function BigScreen({ ticker }: { ticker: Record<string, number> }) {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [canvas]);

  useMemo(() => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a1520';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#4a90c8';
    ctx.font = 'bold 22px Inter,sans-serif';
    ctx.fillText('实时行情', 16, 32);
    [{ k: 'BTC/USDT', f: 'BTCUSDT' }, { k: 'ETH/USDT', f: 'ETHUSDT' }, { k: 'XAU/USDT', f: 'XAUUSDT' }].forEach((s, i) => {
      const y = 62 + i * 36;
      ctx.fillStyle = '#8aa8c8'; ctx.font = '18px Inter,sans-serif';
      ctx.fillText(s.k, 16, y);
      const p = ticker[s.f];
      const txt = p != null ? (s.f === 'XAUUSDT' ? '$' + p.toFixed(2) : '$' + Math.round(p).toLocaleString()) : '--';
      ctx.fillStyle = '#e8f0ff'; ctx.font = 'bold 18px Inter,sans-serif';
      ctx.fillText(txt, 512 - 16 - ctx.measureText(txt).width, y);
    });
    tex.needsUpdate = true;
  }, [canvas, tex, ticker]);

  return (
    <group position={[14, 0, 1.3]}>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[6, 2.2, 0.15]} />
        <meshToonMaterial color="#2a2a2a" />
      </mesh>
      <mesh position={[0, 1.1, 0.09]}>
        <planeGeometry args={[5.4, 1.8]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function activityPose(activity: CharState['activity'], state: CharState['state']): { y: number; rotX: number; scale: number } {
  switch (activity) {
    case 'massage': return { y: 0.45, rotX: -Math.PI / 2.2, scale: 0.95 };
    case 'dine': return { y: 0.15, rotX: 0, scale: 0.85 };
    case 'poker': return { y: 0.2, rotX: 0, scale: 0.9 };
    case 'rest': return { y: 0.12, rotX: -0.15, scale: 0.92 };
    default:
      if (state === 'trading') return { y: 0, rotX: 0.08, scale: 1 };
      return { y: 0, rotX: 0, scale: 1 };
  }
}

export function WorldScene() {
  const agents = useGameStore(s => s.agents);
  const ticker = useGameStore(s => s.ticker);
  const selected = useGameStore(s => s.selectedAgentId);
  const selectAgent = useGameStore(s => s.selectAgent);
  const selectNpc = useGameStore(s => s.selectNpc);
  const selectFacility = useGameStore(s => s.selectFacility);
  const effectsOn = useGameStore(s => s.effectsOn);
  const openModal = useGameStore(s => s.openModal);
  const flyToZone = useGameStore(s => s.flyToZone);

  const deskPos: [number, number, number][] = [
    [4.2, 0.5, 5.6], [7, 0.5, 5.6], [9.8, 0.5, 5.6], [12.6, 0.5, 5.6], [15.4, 0.5, 5.6],
  ];

  return (
    <group>
      {ZONES.map(z => (
        <group key={z.id}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[z.x, 0, z.z]}>
            <planeGeometry args={[z.w, z.d]} />
            <meshBasicMaterial color={z.color} />
          </mesh>
          <ZoneLabel3D
            label={z.label}
            position={[z.x, 0.4, z.z]}
            color={z.id === 'casino' ? '#8b7355' : '#6b5e4e'}
          />
        </group>
      ))}

      <ZoneNavArrows />

      <Wall x={28} z={3.65} w={0.25} d={7.3} />
      <Wall x={28} z={10.15} w={0.25} d={7.3} />
      <Wall x={5.75} z={15} w={11.5} d={0.25} />
      <Wall x={18.25} z={15} w={11.5} d={0.25} />
      <Wall x={42.25} z={15} w={11.5} d={0.25} />
      <Wall x={28} z={23} w={0.25} d={6} />

      <InstancedBoxes positions={deskPos} />
      <ZoneEffects />
      <BigScreen ticker={ticker} />

      {WORLD_BOOTHS.map(b => (
        <RestBoothWorld key={b.id} x={b.x} z={b.z} flip={b.flip} />
      ))}

      <SceneSprite id="plateCoffee" position={[7, 1.8, 18.5]} scale={0.45} />
      <SceneSprite id="plateCoffee" position={[12, 1.8, 18.5]} scale={0.45} />
      <SceneSprite id="plateCoffee" position={[17, 1.8, 18.5]} scale={0.45} />
      <SceneSprite id="spaBubble" position={[27, 1.6, 11.8]} scale={0.4} />
      <SceneSprite id="spaBubble" position={[30, 1.6, 11.8]} scale={0.4} />
      <SceneSprite id="spaBubble" position={[33, 1.6, 11.8]} scale={0.4} />
      <SceneSprite id="pokerChips" position={[36, 2.2, 21]} scale={0.5} />

      <group position={[14, 0, 25]} onClick={(e) => { e.stopPropagation(); selectNpc('reception'); flyToZone('reception'); }}>
        <Gugugaga role="reception" accentColor="#d4af37" label="迎宾 Gugu" status="欢迎光临" onClick={() => selectNpc('reception')} />
      </group>
      <group position={[30, 0, 8.2]} onClick={(e) => { e.stopPropagation(); selectNpc('masseur'); flyToZone('spa'); }}>
        <Gugugaga role="masseur" accentColor="#c8a8e8" label="技师 Gaga" status="按摩放松" scale={1.05} onClick={() => selectNpc('masseur')} />
      </group>
      <group position={[36, 0, 20.4]} onClick={(e) => { e.stopPropagation(); selectNpc('dealer'); flyToZone('casino'); }}>
        <Gugugaga role="dealer" accentColor="#d4af37" label="荷官 Jack" status="德州扑克" scale={1.05} onClick={() => selectNpc('dealer')} />
      </group>
      <group position={[10, 0, 18.5]} onClick={(e) => { e.stopPropagation(); selectNpc('lily'); flyToZone('restaurant'); }}>
        <Gugugaga role="waiter" accentColor="#e879a9" label="服务员 Lily" status="餐厅服务" scale={1.05} onClick={() => selectNpc('lily')} />
      </group>

      <mesh position={[12, 0.5, 18.5]} onClick={(e) => { e.stopPropagation(); selectFacility('table'); openModal('dine'); flyToZone('restaurant'); }}>
        <boxGeometry args={[2.5, 0.1, 2.5]} /><meshBasicMaterial visible={false} />
      </mesh>
      <mesh position={[30, 0.5, 11.8]} onClick={(e) => { e.stopPropagation(); selectFacility('bed'); openModal('massage'); flyToZone('spa'); }}>
        <boxGeometry args={[2, 0.1, 1.2]} /><meshBasicMaterial visible={false} />
      </mesh>
      <mesh position={[36, 0.5, 21]} onClick={(e) => { e.stopPropagation(); selectFacility('poker'); openModal('poker'); flyToZone('casino'); }}>
        <cylinderGeometry args={[2.2, 2.2, 0.1, 16]} /><meshBasicMaterial visible={false} />
      </mesh>

      {(Object.values(agents) as CharState[]).map(char => {
        const meta = char.data;
        const status = char.travelIntent === 'massage' ? '前往按摩区'
          : char.travelIntent === 'dine' ? '前往餐厅'
          : char.travelIntent === 'poker' ? '前往德州区'
          : char.activity === 'massage' ? '按摩中'
          : char.activity === 'dine' ? '就餐中'
          : char.activity === 'poker' ? '打德州'
          : char.activity === 'rest' ? '休息中'
          : char.state === 'trading' ? '交易中'
          : char.state === 'panic' ? '熔断'
          : char.state === 'scanning' ? '扫描中' : '空闲';
        const pose = activityPose(char.activity, char.state);
        return (
          <group key={char.agentId} position={[char.x, pose.y, char.z]} rotation={[pose.rotX, 0, 0]}>
            {selected === char.agentId && <SceneSprite id="monitor" position={[0, 2.4, 0]} scale={0.38} />}
            {char.stress > 70 && !char.activity && <SceneSprite id="stormCloud" position={[0, 2.6, 0]} scale={0.36} />}
            {(char.activity || char.travelIntent) && char.stress < 40 && (
              <SceneSprite id="healStar" position={[0, 2.5, 0]} scale={0.34} />
            )}
            <Gugugaga
              accentColor={meta.color}
              headwear={meta.headwear}
              hatStyle={meta.hatStyle}
              outfitId={meta.outfitId}
              speciesId={meta.speciesId}
              scarfEnabled={meta.scarfEnabled}
              hatEnabled={meta.hatEnabled}
              label={meta.name}
              status={status}
              stress={char.stress}
              selected={selected === char.agentId}
              scale={pose.scale}
              activity={char.activity}
              charState={char.state}
              isWalking={char.isWalking}
              onClick={() => selectAgent(char.agentId)}
            />
            {effectsOn && char.stress > 70 && !char.activity && (
              <pointLight color="#888888" intensity={0.3} distance={2} position={[0, 1, 0]} />
            )}
            {effectsOn && (char.activity === 'massage' || char.travelIntent === 'massage') && (
              <pointLight color="#48d093" intensity={0.4} distance={2.5} position={[0, 1, 0]} />
            )}
          </group>
        );
      })}
    </group>
  );
}
