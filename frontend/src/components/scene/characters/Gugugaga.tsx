import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { NameTag } from '../ui/NameTag';

export interface GugugagaProps {
  accentColor?: string;
  scale?: number;
  role?: 'agent' | 'reception' | 'waiter' | 'dealer' | 'masseur';
  label?: string;
  status?: string;
  stress?: number;
  selected?: boolean;
  activity?: 'idle' | 'rest' | 'massage' | 'dine' | 'poker' | null;
  charState?: 'idle' | 'scanning' | 'trading' | 'panic';
  isWalking?: boolean;
  onClick?: () => void;
}

const MAT = new Map<string, THREE.MeshBasicMaterial>();
function flat(color: string) {
  if (!MAT.has(color)) MAT.set(color, new THREE.MeshBasicMaterial({ color }));
  return MAT.get(color)!;
}

function PaperFace({ accentColor }: { accentColor: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const map = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffdfc8';
    ctx.beginPath(); ctx.ellipse(64, 68, 46, 52, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(34, 38, 22, 16, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(88, 40, 20, 14, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(44, 58, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(80, 58, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a9eff';
    ctx.beginPath(); ctx.arc(44, 60, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffaa33';
    ctx.beginPath(); ctx.arc(80, 60, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(44, 60, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(80, 60, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(42, 58, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffb8b8';
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.ellipse(32, 72, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(96, 72, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffc832';
    ctx.beginPath(); ctx.moveTo(64, 78); ctx.lineTo(58, 92); ctx.lineTo(70, 92); ctx.closePath(); ctx.fill();
    ctx.fillStyle = accentColor;
    ctx.beginPath(); ctx.arc(64, 98, 10, 0, Math.PI * 2); ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }, [accentColor]);

  useFrame(() => {
    if (ref.current) ref.current.lookAt(camera.position);
  });

  return (
    <mesh ref={ref} position={[0, 0.88, 0.12]} renderOrder={5}>
      <planeGeometry args={[0.52, 0.58]} />
      <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
    </mesh>
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

  const roleAcc: Record<string, { extra?: JSX.Element }> = {
    reception: { extra: <mesh position={[0, 1.05, 0.35]} material={flat('#d4af37')}><boxGeometry args={[0.5, 0.08, 0.02]} /></mesh> },
    waiter: { extra: <mesh position={[0.35, 0.55, 0.2]} rotation={[0.3,0,0]} material={flat('#ffffff')}><boxGeometry args={[0.25, 0.02, 0.18]} /></mesh> },
    masseur: { extra: <mesh position={[0, 0.9, 0.3]} material={flat('#c8a8e8')}><boxGeometry args={[0.45, 0.5, 0.05]} /></mesh> },
    dealer: { extra: <mesh position={[0, 1.12, 0.2]} material={flat('#1a1a1a')}><boxGeometry args={[0.28, 0.06, 0.22]} /></mesh> },
  };

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
      {/* 剪纸扁圆身体 */}
      <mesh position={[0, 0.48, 0]} scale={[1, 0.75, 0.85]} material={flat('#f8f8f8')}>
        <sphereGeometry args={[0.42, 12, 12]} />
      </mesh>
      <mesh position={[0, 0.52, -0.08]} scale={[1.05, 0.7, 0.9]} material={flat('#1a1a1a')}>
        <sphereGeometry args={[0.4, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      </mesh>
      {/* 侧发 — 俯视可见，不遮挡头顶 */}
      <mesh position={[-0.22, 0.86, 0.06]} rotation={[0, 0.2, 0.15]} material={flat('#1a1a1a')}>
        <boxGeometry args={[0.14, 0.22, 0.18]} />
      </mesh>
      <mesh position={[0.2, 0.88, 0.08]} rotation={[0, -0.15, -0.1]} material={flat('#1a1a1a')}>
        <boxGeometry args={[0.12, 0.18, 0.16]} />
      </mesh>
      <PaperFace accentColor={accentColor} />
      <mesh position={[0, 0.54, 0.36]} rotation={[-Math.PI / 2, 0, 0]} material={flat(accentColor)}>
        <circleGeometry args={[0.07, 12]} />
      </mesh>
      <group ref={wingL} position={[-0.44, 0.52, 0.02]}>
        <mesh rotation={[0, 0, 0.55]} material={flat('#1a1a1a')}><boxGeometry args={[0.12, 0.28, 0.04]} /></mesh>
      </group>
      <group ref={wingR} position={[0.44, 0.52, 0.02]}>
        <mesh rotation={[0, 0, -0.55]} material={flat('#1a1a1a')}><boxGeometry args={[0.12, 0.28, 0.04]} /></mesh>
      </group>
      <mesh position={[-0.14, 0.06, 0.08]} scale={[1.3, 0.35, 1.5]} material={flat('#ffc832')}>
        <sphereGeometry args={[0.1, 8, 8]} />
      </mesh>
      <mesh position={[0.14, 0.06, 0.08]} scale={[1.3, 0.35, 1.5]} material={flat('#ffc832')}>
        <sphereGeometry args={[0.1, 8, 8]} />
      </mesh>
      {charState === 'trading' && !activity && (
        <mesh position={[0.35, 0.62, 0.25]} material={flat('#2a2a2a')}><boxGeometry args={[0.22, 0.14, 0.03]} /></mesh>
      )}
      {roleAcc[role]?.extra}
      {label && <NameTag label={label} status={status} accentColor={accentColor} />}
    </group>
  );
}
