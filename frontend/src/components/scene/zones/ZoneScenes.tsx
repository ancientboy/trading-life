import { useMemo } from 'react';
import * as THREE from 'three';
import { InstancedBoxes } from '../furniture/InstancedFurniture';
import { Gugugaga } from '../characters/Gugugaga';
import { SceneSprite } from '../ui/SceneSprite';
import { useGameStore } from '../../../store/useGameStore';
import { HALL_BOOTHS, HALL_COFFEE, HALL_DESKS, CASINO_SEATS, agentDisplayZone, LEISURE_SPOTS } from '../../../lib/zones';
import { CasinoLounge } from './CasinoLounge';
import { SpaLounge } from './SpaLounge';
import type { CharState } from '../../../lib/constants';
import type { ZoneId } from '../../../store/useGameStore';

function Floor({ color, w, d }: { color: string; w: number; d: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshToonMaterial color={color} />
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
    <group position={[0, 0, -5]}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[6, 2.2, 0.15]} />
        <meshToonMaterial color="#2a2a2a" />
      </mesh>
      <mesh position={[0, 1.1, 0.09]}>
        <planeGeometry args={[5.4, 1.8]} />
        <meshBasicMaterial map={tex} />
      </mesh>
    </group>
  );
}

function RestBooth({ x, z, flip = false }: { x: number; z: number; flip?: boolean }) {
  const sx = flip ? -1 : 1;
  return (
    <group position={[x, 0, z]} scale={[sx, 1, 1]}>
      <mesh position={[0, 0.9, -0.55]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 1.8, 0.12]} />
        <meshToonMaterial color="#c8baa8" />
      </mesh>
      <mesh position={[-1.05, 0.9, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.12, 1.8, 1.6]} />
        <meshToonMaterial color="#b8aa98" />
      </mesh>
      <mesh position={[0, 0.35, 0.15]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.5, 0.8]} />
        <meshToonMaterial color="#8b7355" />
      </mesh>
      <mesh position={[0, 0.62, 0.15]}>
        <boxGeometry args={[1.6, 0.12, 0.65]} />
        <meshToonMaterial color="#d4c8b8" />
      </mesh>
      <mesh position={[0.55, 0.45, 0.55]} castShadow>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 12]} />
        <meshToonMaterial color="#d4c8b8" />
      </mesh>
      <SceneSprite id="plateCoffee" position={[-0.5, 1.15, 0.35]} scale={0.32} />
      <pointLight color="#ffe8c8" intensity={0.35} distance={3} position={[0, 1.2, 0.3]} />
    </group>
  );
}

function CoffeeCorner({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.2, 1.1, 0.6]} />
        <meshToonMaterial color="#a08060" />
      </mesh>
      <SceneSprite id="plateCoffee" position={[0, 1.35, 0]} scale={0.38} />
    </group>
  );
}

function ZoneAgents({ zone }: { zone: ZoneId }) {
  const agents = useGameStore(s => s.agents);
  const selected = useGameStore(s => s.selectedAgentId);
  const focusAgent = useGameStore(s => s.focusAgent);
  const effectsOn = useGameStore(s => s.effectsOn);

  const list = (Object.values(agents) as CharState[]).filter(c => agentDisplayZone(c) === zone);

  return (
    <>
      {list.map(char => {
        const spot = zone === 'hall'
          ? { x: char.x, z: char.z }
          : (LEISURE_SPOTS[zone][char.agentId] ?? { x: 0, z: 0 });
        const meta = char.data;
        const seat = zone === 'casino' ? CASINO_SEATS.find(s => s.id === char.agentId) : null;
        const isMassage = char.activity === 'massage';
        const poseY = isMassage ? 0.45
          : char.activity === 'dine' ? 0.15
          : char.activity === 'rest' ? 0.1
          : char.activity === 'poker' ? 0.18 : 0;
        const poseRotX = isMassage ? -Math.PI / 2.2 : 0;
        const status = char.activity === 'rest' ? '休息中'
          : isMassage ? '按摩中'
          : char.activity === 'poker' ? '打德州'
          : char.state === 'trading' ? '交易中'
          : char.state === 'scanning' ? '扫描中'
          : char.state === 'panic' ? '熔断'
          : char.activity || '空闲';
        return (
          <group key={char.agentId} position={[spot.x, poseY, spot.z]} rotation={[poseRotX, seat?.rotY ?? 0, 0]}>
            {selected === char.agentId && <SceneSprite id="monitor" position={[0, 2.2, 0]} scale={0.38} />}
            {char.stress > 70 && !isMassage && <SceneSprite id="stormCloud" position={[0, 2.4, 0]} scale={0.34} />}
            {isMassage && char.stress < 45 && <SceneSprite id="healStar" position={[0, 2.3, 0]} scale={0.34} />}
            <Gugugaga
              accentColor={meta.color}
              headwear={meta.headwear}
              hatStyle={meta.hatStyle}
              outfitId={meta.outfitId}
              speciesId={meta.speciesId}
              hairStyle={meta.hairStyle}
              scarfEnabled={meta.scarfEnabled}
              hatEnabled={meta.hatEnabled}
              label={meta.name}
              status={status}
              stress={char.stress}
              selected={selected === char.agentId}
              activity={char.activity}
              scale={char.activity === 'poker' ? 0.88 : isMassage ? 0.95 : 1}
              onClick={() => focusAgent(char.agentId)}
            />
            {effectsOn && char.stress > 70 && !isMassage && <pointLight color="#888" intensity={0.3} distance={2} position={[0, 1, 0]} />}
            {effectsOn && isMassage && <pointLight color="#48d093" intensity={0.45} distance={2.5} position={[0, 0.8, 0]} />}
          </group>
        );
      })}
    </>
  );
}

export function HallZone() {
  const ticker = useGameStore(s => s.ticker);
  const selectFacility = useGameStore(s => s.selectFacility);
  return (
    <group>
      <Floor color="#f5f0e8" w={22} d={14} />
      <InstancedBoxes positions={HALL_DESKS} />
      <BigScreen ticker={ticker} />
      {HALL_BOOTHS.map((b, i) => (
        <group key={b.id} onClick={(e) => { e.stopPropagation(); selectFacility(b.id); }}>
          <RestBooth x={b.x} z={b.z} flip={i % 2 === 1} />
        </group>
      ))}
      <CoffeeCorner x={HALL_COFFEE.x} z={HALL_COFFEE.z} />
      <ZoneAgents zone="hall" />
    </group>
  );
}

export function RestaurantZone() {
  const selectNpc = useGameStore(s => s.selectNpc);
  const selectFacility = useGameStore(s => s.selectFacility);
  const setRightTab = useGameStore(s => s.setRightTab);
  const openFacilityPanel = () => {
    setRightTab('facility');
    useGameStore.setState({ rightPanelCollapsed: false });
  };
  return (
    <group>
      <Floor color="#fff8eb" w={20} d={14} />
      {[[-4, 1], [0, 1], [4, 1]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <cylinderGeometry args={[0.7, 0.7, 0.06, 16]} />
            <meshToonMaterial color="#d4c8b8" />
          </mesh>
          <SceneSprite id="plateCoffee" position={[0, 1.2, 0]} scale={0.4} />
        </group>
      ))}
      <group position={[-6, 0, 4]} onClick={(e) => { e.stopPropagation(); selectNpc('lily'); }}>
        <SceneSprite id="tray" position={[0, 2.2, 0]} scale={0.4} />
        <Gugugaga role="waiter" accentColor="#e879a9" label="服务员 Lily" status="餐厅服务" onClick={() => selectNpc('lily')} />
      </group>
      <mesh position={[0, 0.5, 1]} onClick={(e) => { e.stopPropagation(); selectFacility('table'); openFacilityPanel(); }}>
        <boxGeometry args={[8, 0.1, 6]} /><meshBasicMaterial visible={false} />
      </mesh>
      <ZoneAgents zone="restaurant" />
    </group>
  );
}

export function SpaZone() {
  const selectNpc = useGameStore(s => s.selectNpc);
  const selectFacility = useGameStore(s => s.selectFacility);
  const setRightTab = useGameStore(s => s.setRightTab);
  const openFacilityPanel = () => {
    setRightTab('facility');
    useGameStore.setState({ rightPanelCollapsed: false });
  };
  return (
    <group>
      <SpaLounge
        onSelectTherapist={() => selectNpc('masseur')}
        onSelectBed={() => { selectFacility('bed'); openFacilityPanel(); }}
      />
      <ZoneAgents zone="spa" />
    </group>
  );
}

export function CasinoZone() {
  const selectNpc = useGameStore(s => s.selectNpc);
  const selectFacility = useGameStore(s => s.selectFacility);
  const setRightTab = useGameStore(s => s.setRightTab);
  const openFacilityPanel = () => {
    setRightTab('facility');
    useGameStore.setState({ rightPanelCollapsed: false });
  };
  return (
    <group>
      <CasinoLounge
        onSelectDealer={() => selectNpc('dealer')}
        onSelectTable={() => { selectFacility('poker'); openFacilityPanel(); }}
      />
      <ZoneAgents zone="casino" />
    </group>
  );
}

export function ZoneScene({ zone }: { zone: ZoneId }) {
  switch (zone) {
    case 'hall': return <HallZone />;
    case 'restaurant': return <RestaurantZone />;
    case 'spa': return <SpaZone />;
    case 'casino': return <CasinoZone />;
    default: return <HallZone />;
  }
}
