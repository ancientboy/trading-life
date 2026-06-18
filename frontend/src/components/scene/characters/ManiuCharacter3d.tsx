import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ManiuSkinId } from '../../../lib/agentSpecies';

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

function ManiuBody({ skinId }: { skinId: ManiuSkinId }) {
  const tagMap = useMemo(() => canvasTex(64, 24, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 64, 24);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 63, 23);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('马牛', 32, 12);
  }), []);

  const suitColor = skinId === 'executive' ? '#1a1a2e' : skinId === 'casual' ? '#4a9e5c' : '#2b7fd4';
  const tieColor = skinId === 'executive' ? '#c0392b' : skinId === 'casual' ? '#fafafa' : '#f4a89a';

  return (
    <group>
      <mesh position={[0, 0.52, 0]} material={flat('#f5efe6')}>
        <sphereGeometry args={[0.44, 16, 16]} />
      </mesh>
      <mesh position={[-0.05, 0.88, 0.04]} scale={[0.55, 0.38, 0.42]} material={flat('#2a2018')}>
        <sphereGeometry args={[0.32, 10, 10]} />
      </mesh>
      <mesh position={[0, 0.36, 0.04]} scale={[1.08, 0.58, 1.05]} material={flat(suitColor)}>
        <sphereGeometry args={[0.4, 14, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58]} />
      </mesh>
      {skinId === 'default' && (
        <>
          <mesh position={[-0.1, 0.48, 0.18]} rotation={[0, 0, 0.35]} scale={[0.12, 0.18, 0.04]} material={flat('#1a4a8a')}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
          <mesh position={[0.1, 0.48, 0.18]} rotation={[0, 0, -0.35]} scale={[0.12, 0.18, 0.04]} material={flat('#1a4a8a')}>
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
        </>
      )}
      {skinId === 'executive' && (
        <mesh position={[0, 0.52, 0.19]} scale={[0.35, 0.12, 0.02]} material={flat('#d4af37')}>
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      )}
      <mesh position={[0, 0.5, 0.2]} scale={[0.06, skinId === 'casual' ? 0.14 : 0.2, 0.04]} material={flat(tieColor)}>
        <boxGeometry args={[1, 1, 1]} />
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

/** 马牛物种 — 独立基础角色（非企鹅换装） */
export function ManiuCharacter3d({ skinId = 'default' }: { skinId?: ManiuSkinId }) {
  return <ManiuBody skinId={skinId} />;
}
