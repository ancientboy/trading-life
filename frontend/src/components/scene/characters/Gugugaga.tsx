import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { NameTag } from '../ui/NameTag';
import { NpcAccessories } from './NpcAccessories';
import { AgentHat3d } from './AgentHat3d';
import type { NpcRole } from '../../../lib/npcOutfits';
import { DEFAULT_SCARF, scarfColorsFromAccent, scarfPaletteForCharacter, type ScarfPalette } from '../../../lib/scarfColors';
import type { AgentHeadwear, HatStyleId } from '../../../lib/agentAppearance';

export interface GugugagaProps {
  accentColor?: string;
  scale?: number;
  role?: 'agent' | NpcRole;
  label?: string;
  status?: string;
  stress?: number;
  selected?: boolean;
  activity?: 'idle' | 'rest' | 'massage' | 'dine' | 'poker' | null;
  charState?: 'idle' | 'scanning' | 'trading' | 'panic';
  isWalking?: boolean;
  headwear?: AgentHeadwear;
  hatStyle?: HatStyleId;
  onClick?: () => void;
}

const MAT = new Map<string, THREE.MeshBasicMaterial>();
function flat(color: string) {
  if (!MAT.has(color)) MAT.set(color, new THREE.MeshBasicMaterial({ color }));
  return MAT.get(color)!;
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** 经典 Q 版企鹅脸：白眼圈 + 黑眼珠 + 橙喙 */
function PenguinFace() {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const map = useMemo(() => canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(64, 70, 48, 54, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f7f7f7';
    ctx.beginPath(); ctx.ellipse(44, 58, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(84, 58, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(44, 60, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(84, 60, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f5a623';
    ctx.beginPath(); ctx.moveTo(64, 78); ctx.lineTo(56, 94); ctx.lineTo(72, 94); ctx.closePath(); ctx.fill();
  }), []);

  useFrame(() => {
    if (ref.current) ref.current.lookAt(camera.position);
  });

  return (
    <mesh ref={ref} position={[0, 0.88, 0.14]} renderOrder={5}>
      <planeGeometry args={[0.5, 0.56]} />
      <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

/** 围脖 + 垂坠条纹 */
function PenguinScarf({ palette }: { palette: ScarfPalette }) {
  const wrapMap = useMemo(() => canvasTex(64, 16, (ctx) => {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = palette.wrap[i % 2];
      ctx.fillRect(0, i * (16 / 6), 64, 16 / 6 + 0.5);
    }
  }), [palette.wrap[0], palette.wrap[1]]);
  const tailMap = useMemo(() => canvasTex(16, 48, (ctx) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = palette.tail[i % 2];
      ctx.fillRect(0, i * 12, 16, 12 + 0.5);
    }
  }), [palette.tail[0], palette.tail[1]]);

  return (
    <group position={[0, 0.68, 0.1]}>
      <mesh position={[0, 0, 0.22]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
        <planeGeometry args={[0.52, 0.14]} />
        <meshBasicMaterial map={wrapMap} toneMapped={false} />
      </mesh>
      <mesh position={[-0.18, -0.06, 0.18]} renderOrder={4}>
        <planeGeometry args={[0.1, 0.28]} />
        <meshBasicMaterial map={tailMap} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Gugugaga({
  accentColor = '#FFD700',
  scale = 1,
  role = 'agent',
  label,
  status,
  stress = 0,
  selected,
  activity,
  charState = 'idle',
  isWalking = false,
  headwear = 'scarf',
  hatStyle = 'beanie',
  onClick,
}: GugugagaProps) {
  const g = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const t = useRef(0);

  useFrame((_, dt) => {
    t.current += dt;
    const trading = charState === 'trading' && !activity;
    const resting = activity === 'rest';
    const flapBase = resting ? 0.03 : activity === 'massage' ? 0.05 : activity === 'dine' ? 0.07 : isWalking ? 0.22 : trading ? 0.1 : 0.14;
    if (wingL.current && wingR.current) {
      wingL.current.rotation.z = 0.55 + Math.sin(t.current * (isWalking ? 9 : 5)) * flapBase;
      wingR.current.rotation.z = -0.55 - Math.sin(t.current * (isWalking ? 9 : 5)) * flapBase;
    }
    if (g.current) {
      if (activity === 'dine') g.current.position.y = Math.sin(t.current * 3) * 0.02;
      else if (trading) g.current.position.y = Math.sin(t.current * 4) * 0.025;
      else if (isWalking) g.current.position.y = Math.abs(Math.sin(t.current * 10)) * 0.04;
      else if (resting) g.current.position.y = Math.sin(t.current * 1.5) * 0.01;
      else g.current.position.y = 0;
    }
  });

  const isNpc = role !== 'agent';
  const scarfPalette = useMemo(
    () => (isNpc ? scarfPaletteForCharacter(accentColor, true) : scarfColorsFromAccent(accentColor)),
    [accentColor, isNpc],
  );
  const agentHeadwear = isNpc ? 'scarf' as const : headwear;

  return (
    <group ref={g} scale={scale} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.55, 0.65, 32]} />
          <meshBasicMaterial color="#d4af37" transparent opacity={0.7} />
        </mesh>
      )}
      {stress > 50 && (
        <mesh position={[0, 0.75, 0]}>
          <sphereGeometry args={[0.65, 10, 10]} />
          <meshBasicMaterial color="#888888" transparent opacity={0.06 + stress * 0.0008} depthWrite={false} />
        </mesh>
      )}
      <mesh position={[0, 0.48, 0]} scale={[1, 0.75, 0.85]} material={flat('#f2f2f2')}>
        <sphereGeometry args={[0.42, 12, 12]} />
      </mesh>
      <mesh position={[0, 0.52, -0.08]} scale={[1.05, 0.7, 0.9]} material={flat('#1a1a1a')}>
        <sphereGeometry args={[0.4, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      </mesh>
      <PenguinFace />
      {agentHeadwear === 'scarf' && <PenguinScarf palette={isNpc ? DEFAULT_SCARF : scarfPalette} />}
      {agentHeadwear === 'hat' && !isNpc && <AgentHat3d style={hatStyle} color={accentColor} />}
      <group ref={wingL} position={[-0.44, 0.52, 0.02]}>
        <mesh rotation={[0, 0, 0.55]} material={flat('#1a1a1a')}><boxGeometry args={[0.12, 0.28, 0.04]} /></mesh>
      </group>
      <group ref={wingR} position={[0.44, 0.52, 0.02]}>
        <mesh rotation={[0, 0, -0.55]} material={flat('#1a1a1a')}><boxGeometry args={[0.12, 0.28, 0.04]} /></mesh>
      </group>
      <mesh position={[-0.14, 0.06, 0.08]} scale={[1.3, 0.35, 1.5]} material={flat('#f5a623')}>
        <sphereGeometry args={[0.1, 8, 8]} />
      </mesh>
      <mesh position={[0.14, 0.06, 0.08]} scale={[1.3, 0.35, 1.5]} material={flat('#f5a623')}>
        <sphereGeometry args={[0.1, 8, 8]} />
      </mesh>
      {charState === 'trading' && !activity && (
        <mesh position={[0.35, 0.62, 0.25]} material={flat('#2a2a2a')}><boxGeometry args={[0.22, 0.14, 0.03]} /></mesh>
      )}
      {isNpc && <NpcAccessories role={role} />}
      {label && <NameTag label={label} status={status} accentColor={accentColor} />}
    </group>
  );
}
