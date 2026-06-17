import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../../store/useGameStore';
import { ZONE_NAV_ARROWS } from '../../../lib/worldMap';
import type { ZoneId } from '../../../store/useGameStore';

function NavArrow({ x, z, rotY, label, target }: {
  x: number; z: number; rotY: number; label: string; target: ZoneId;
}) {
  const flyToZone = useGameStore(s => s.flyToZone);
  const ref = useRef<THREE.Group>(null);
  const t = useRef(0);

  const map = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 120;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,252,247,0.95)';
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 184, 104, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.moveTo(100, 28);
    ctx.lineTo(72, 68);
    ctx.lineTo(128, 68);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3d3530';
    ctx.font = 'bold 22px Inter,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 100, 98);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }, [label]);

  useFrame(({ clock }) => {
    t.current = clock.elapsedTime;
    if (ref.current) ref.current.position.y = 0.35 + Math.sin(t.current * 2.5) * 0.06;
  });

  return (
    <group
      ref={ref}
      position={[x, 0.35, z]}
      rotation={[0, rotY, 0]}
      onClick={(e) => { e.stopPropagation(); flyToZone(target); }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={15}>
        <planeGeometry args={[2.2, 1.35]} />
        <meshBasicMaterial map={map} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 当前区域可见的导航箭头 */
export function ZoneNavArrows() {
  const activeZone = useGameStore(s => s.activeZone);
  const arrows = ZONE_NAV_ARROWS.filter(a => a.showWhen === 'always' || a.showWhen === activeZone);
  return (
    <>
      {arrows.map(a => (
        <NavArrow key={`${a.showWhen}-${a.target}-${a.x}`} {...a} />
      ))}
    </>
  );
}
