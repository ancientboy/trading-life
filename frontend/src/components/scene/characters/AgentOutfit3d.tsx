import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { OutfitId } from '../../../lib/agentOutfits';

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

function BillboardFace({ draw }: { draw: (ctx: CanvasRenderingContext2D) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const map = useMemo(() => canvasTex(128, 128, draw), [draw]);
  useFrame(() => { if (ref.current) ref.current.lookAt(camera.position); });
  return (
    <mesh ref={ref} position={[0, 0.88, 0.16]} renderOrder={6}>
      <planeGeometry args={[0.52, 0.56]} />
      <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function PandaFull() {
  return (
    <group>
      <mesh position={[0, 0.38, 0]} scale={[1.15, 0.95, 0.95]} material={flat('#f8f8f8')}>
        <sphereGeometry args={[0.42, 14, 14]} />
      </mesh>
      <mesh position={[0, 0.78, 0.06]} scale={[1.05, 0.92, 0.9]} material={flat('#f8f8f8')}>
        <sphereGeometry args={[0.38, 14, 14]} />
      </mesh>
      <mesh position={[-0.22, 1.02, 0.04]} material={flat('#1a1a1a')}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
      <mesh position={[0.22, 1.02, 0.04]} material={flat('#1a1a1a')}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
      <BillboardFace={(ctx) => {
        ctx.fillStyle = '#f8f8f8'; ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath(); ctx.ellipse(44, 58, 16, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(84, 58, 16, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(44, 58, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(84, 58, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.ellipse(64, 78, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      }} />
      <group position={[-0.46, 0.52, 0.02]} rotation={[0, 0, 0.55]}>
        <mesh material={flat('#1a1a1a')}><boxGeometry args={[0.14, 0.3, 0.05]} /></mesh>
      </group>
      <group position={[0.46, 0.52, 0.02]} rotation={[0, 0, -0.55]}>
        <mesh material={flat('#1a1a1a')}><boxGeometry args={[0.14, 0.3, 0.05]} /></mesh>
      </group>
      <mesh position={[-0.14, 0.04, 0.1]} scale={[1.3, 0.35, 1.5]} material={flat('#1a1a1a')}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
      <mesh position={[0.14, 0.04, 0.1]} scale={[1.3, 0.35, 1.5]} material={flat('#1a1a1a')}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
    </group>
  );
}

function AstronautFull() {
  return (
    <group>
      <mesh position={[0, 0.4, 0]} scale={[1.22, 1.0, 1.0]} material={flat('#eef2f7')}>
        <sphereGeometry args={[0.42, 14, 14]} />
      </mesh>
      <mesh position={[0, 0.88, 0]} scale={[1.08, 1.0, 1.0]} material={flat('#eef2f7')}>
        <sphereGeometry args={[0.4, 14, 14]} />
      </mesh>
      <mesh position={[0, 0.88, 0.12]} material={flat('rgba(80,140,200,0.75)')}>
        <sphereGeometry args={[0.36, 14, 14]} />
      </mesh>
      <mesh position={[0, 0.72, -0.14]} scale={[0.42, 0.5, 0.22]} material={flat('#b0c4de')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[0, 0.52, 0.18]} scale={[0.35, 0.12, 0.08]} material={flat('#e67e22')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[-0.12, 0.02, 0.1]} scale={[0.9, 0.35, 1.2]} material={flat('#8a96a8')}><boxGeometry args={[0.12, 0.12, 0.12]} /></mesh>
      <mesh position={[0.12, 0.02, 0.1]} scale={[0.9, 0.35, 1.2]} material={flat('#8a96a8')}><boxGeometry args={[0.12, 0.12, 0.12]} /></mesh>
      <group position={[-0.48, 0.5, 0.02]} rotation={[0, 0, 0.55]}>
        <mesh material={flat('#eef2f7')}><boxGeometry args={[0.14, 0.3, 0.05]} /></mesh>
      </group>
      <group position={[0.48, 0.5, 0.02]} rotation={[0, 0, -0.55]}>
        <mesh material={flat('#eef2f7')}><boxGeometry args={[0.14, 0.3, 0.05]} /></mesh>
      </group>
    </group>
  );
}

function ChefFull() {
  return (
    <group>
      <mesh position={[0, 0.38, 0.04]} scale={[1.12, 1.05, 0.92]} material={flat('#fafafa')}>
        <sphereGeometry args={[0.4, 12, 12]} />
      </mesh>
      <mesh position={[0, 0.72, 0.06]} material={flat('#fafafa')}>
        <sphereGeometry args={[0.34, 12, 12]} />
      </mesh>
      <mesh position={[0, 1.08, 0.04]} scale={[0.55, 0.75, 0.45]} material={flat('#fafafa')}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
      </mesh>
      <mesh position={[0, 1.22, 0.04]} scale={[0.65, 0.22, 0.5]} material={flat('#f0f0f0')}>
        <sphereGeometry args={[0.35, 10, 10]} />
      </mesh>
      <mesh position={[0, 0.62, 0.2]} scale={[0.5, 0.15, 0.08]} material={flat('#c0392b')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <BillboardFace={(ctx) => {
        ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.arc(64, 68, 48, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a2220'; ctx.beginPath(); ctx.arc(48, 62, 6, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(80, 62, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f0c090'; ctx.beginPath(); ctx.ellipse(64, 78, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      }} />
      <group position={[-0.44, 0.52, 0.02]} rotation={[0, 0, 0.55]}>
        <mesh material={flat('#fafafa')}><boxGeometry args={[0.12, 0.28, 0.04]} /></mesh>
      </group>
      <group position={[0.44, 0.52, 0.02]} rotation={[0, 0, -0.55]}>
        <mesh material={flat('#fafafa')}><boxGeometry args={[0.12, 0.28, 0.04]} /></mesh>
      </group>
    </group>
  );
}

function KnightFull({ accent }: { accent: string }) {
  return (
    <group>
      <mesh position={[0, 0.38, -0.06]} scale={[1.35, 1.05, 0.12]} material={flat(accent)}><boxGeometry args={[0.5, 0.65, 1]} /></mesh>
      <mesh position={[0, 0.4, 0]} scale={[1.15, 0.95, 0.95]} material={flat('#b8c4d0')}>
        <sphereGeometry args={[0.4, 12, 12]} />
      </mesh>
      <mesh position={[0, 0.78, 0.04]} scale={[1.05, 0.95, 0.92]} material={flat('#b8c4d0')}>
        <sphereGeometry args={[0.36, 12, 12]} />
      </mesh>
      <mesh position={[0, 0.95, 0.14]} scale={[0.55, 0.35, 0.12]} material={flat('#3a4555')}><boxGeometry args={[1, 1, 1]} /></mesh>
      <mesh position={[0, 1.05, 0.04]} scale={[0.75, 0.18, 0.55]} material={flat('#8a98a8')}><boxGeometry args={[1, 1, 1]} /></mesh>
      <group position={[-0.44, 0.52, 0.02]} rotation={[0, 0, 0.55]}>
        <mesh material={flat('#b8c4d0')}><boxGeometry args={[0.14, 0.28, 0.05]} /></mesh>
      </group>
      <group position={[0.44, 0.52, 0.02]} rotation={[0, 0, -0.55]}>
        <mesh material={flat('#b8c4d0')}><boxGeometry args={[0.14, 0.28, 0.05]} /></mesh>
      </group>
      <mesh position={[-0.14, 0.04, 0.1]} scale={[1.2, 0.35, 1.4]} material={flat('#8a98a8')}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
      <mesh position={[0.14, 0.04, 0.1]} scale={[1.2, 0.35, 1.4]} material={flat('#8a98a8')}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
    </group>
  );
}

function StreetFull({ accent }: { accent: string }) {
  const shade = useMemo(() => {
    const c = new THREE.Color(accent);
    c.multiplyScalar(0.75);
    return `#${c.getHexString()}`;
  }, [accent]);
  return (
    <group>
      <mesh position={[0, 0.4, 0]} scale={[1.18, 1.0, 1.0]} material={flat(accent)}>
        <sphereGeometry args={[0.42, 14, 14]} />
      </mesh>
      <mesh position={[0, 0.82, 0.02]} scale={[1.05, 0.95, 0.95]} material={flat(accent)}>
        <sphereGeometry args={[0.38, 14, 14]} />
      </mesh>
      <mesh position={[0, 0.95, 0.08]} scale={[0.85, 0.55, 0.75]} material={flat(shade)}>
        <sphereGeometry args={[0.38, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.65]} />
      </mesh>
      <mesh position={[0, 0.48, 0.18]} scale={[0.45, 0.22, 0.1]} material={flat(shade)}><boxGeometry args={[1, 1, 1]} /></mesh>
      <BillboardFace={(ctx) => {
        ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(64, 70, 46, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a2220'; ctx.beginPath(); ctx.arc(48, 64, 6, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(80, 64, 6, 0, Math.PI * 2); ctx.fill();
      }} />
      <group position={[-0.46, 0.52, 0.02]} rotation={[0, 0, 0.55]}>
        <mesh material={flat(accent)}><boxGeometry args={[0.14, 0.28, 0.05]} /></mesh>
      </group>
      <group position={[0.46, 0.52, 0.02]} rotation={[0, 0, -0.55]}>
        <mesh material={flat(accent)}><boxGeometry args={[0.14, 0.28, 0.05]} /></mesh>
      </group>
    </group>
  );
}

function ManiuFull() {
  const tagMap = useMemo(() => canvasTex(64, 24, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 64, 24);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 63, 23);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('马牛', 32, 12);
  }), []);
  return (
    <group>
      <mesh position={[0, 0.52, 0]} material={flat('#f5efe6')}>
        <sphereGeometry args={[0.44, 16, 16]} />
      </mesh>
      <mesh position={[-0.05, 0.88, 0.04]} scale={[0.55, 0.38, 0.42]} material={flat('#2a2018')}>
        <sphereGeometry args={[0.32, 10, 10]} />
      </mesh>
      <mesh position={[0, 0.36, 0.04]} scale={[1.08, 0.58, 1.05]} material={flat('#2b7fd4')}>
        <sphereGeometry args={[0.4, 14, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58]} />
      </mesh>
      <mesh position={[-0.1, 0.48, 0.18]} rotation={[0, 0, 0.35]} scale={[0.12, 0.18, 0.04]} material={flat('#1a4a8a')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[0.1, 0.48, 0.18]} rotation={[0, 0, -0.35]} scale={[0.12, 0.18, 0.04]} material={flat('#1a4a8a')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[0, 0.5, 0.2]} scale={[0.06, 0.2, 0.04]} material={flat('#f4a89a')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[0.14, 0.56, 0.2]} scale={[0.1, 0.08, 0.02]} material={flat('#1a4a8a')}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      <mesh position={[0.17, 0.56, 0.22]} material={flat('#e8c547')}>
        <sphereGeometry args={[0.025, 6, 6]} />
      </mesh>
      <mesh position={[-0.14, 0.58, 0.2]} renderOrder={5}>
        <planeGeometry args={[0.14, 0.05]} />
        <meshBasicMaterial map={tagMap} toneMapped={false} />
      </mesh>
      <mesh position={[-0.5, 0.46, 0.1]} material={flat('#faf8f4')}>
        <sphereGeometry args={[0.08, 8, 8]} />
      </mesh>
      <mesh position={[0.5, 0.46, 0.1]} material={flat('#faf8f4')}>
        <sphereGeometry args={[0.08, 8, 8]} />
      </mesh>
      <BillboardFace={(ctx) => {
        ctx.fillStyle = '#f5efe6'; ctx.beginPath(); ctx.arc(64, 68, 48, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a2220';
        ctx.fillRect(40, 54, 12, 3); ctx.fillRect(76, 54, 12, 3);
        ctx.beginPath(); ctx.ellipse(48, 64, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(80, 64, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2a2220'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(64, 76); ctx.quadraticCurveTo(58, 82, 52, 76); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(64, 76); ctx.quadraticCurveTo(70, 82, 76, 76); ctx.stroke();
      }} />
    </group>
  );
}

/** 整套服装角色 — 替换默认企鹅 mesh */
export function AgentOutfit3d({ outfitId, accentColor = '#FFD700' }: { outfitId: OutfitId; accentColor?: string }) {
  if (outfitId === 'default') return null;
  switch (outfitId) {
    case 'panda': return <PandaFull />;
    case 'astronaut': return <AstronautFull />;
    case 'chef': return <ChefFull />;
    case 'knight': return <KnightFull accent={accentColor} />;
    case 'street': return <StreetFull accent={accentColor} />;
    case 'maniu': return <ManiuFull />;
    default: return null;
  }
}
