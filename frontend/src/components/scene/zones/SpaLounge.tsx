import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Gugugaga } from '../characters/Gugugaga';
import { SceneSprite } from '../ui/SceneSprite';
import { useGameStore } from '../../../store/useGameStore';
import { SPA_CUBICLES, SPA_THERAPIST, SPA_WAIT_SOFAS } from '../../../lib/zones';

const flat = (color: string) => new THREE.MeshBasicMaterial({ color });

const MAT = {
  floor: flat('#f0ebf8'),
  corridor: flat('#e8e0f5'),
  partition: flat('#c8bee8'),
  partitionTrim: flat('#d4ccee'),
  wood: flat('#c4a882'),
  woodDark: flat('#a08060'),
  bedding: flat('#ffffff'),
  pillow: flat('#ede8ff'),
  bottle: flat('#9b8ec8'),
  bottleCap: flat('#d4af37'),
};

function FlatFloor({ w, d, color }: { w: number; d: number; color: THREE.MeshBasicMaterial }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={color}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

function InstancedFlatBoxes({
  positions, color, scale,
}: {
  positions: [number, number, number][];
  color: THREE.MeshBasicMaterial;
  scale: [number, number, number];
}) {
  const mesh = useMemo(() => new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    color,
    positions.length,
  ), [positions.length, color]);

  useMemo(() => {
    const m = new THREE.Matrix4();
    positions.forEach(([x, y, z], i) => {
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(scale[0], scale[1], scale[2]));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions, scale, mesh]);

  return <primitive object={mesh} />;
}

/** 批量按摩床：浅木床架 + 白色床品 */
function InstancedMassageBeds({ positions }: { positions: [number, number, number][] }) {
  return (
    <>
      <InstancedFlatBoxes positions={positions} color={MAT.wood} scale={[1.55, 0.32, 0.72]} />
      <InstancedFlatBoxes
        positions={positions.map(([x, , z]) => [x, 0.38, z] as [number, number, number])}
        color={MAT.bedding}
        scale={[1.42, 0.07, 0.62]}
      />
      <InstancedFlatBoxes
        positions={positions.map(([x, , z]) => [x - 0.55, 0.42, z - 0.18] as [number, number, number])}
        color={MAT.pillow}
        scale={[0.38, 0.1, 0.28]}
      />
    </>
  );
}

/** 公共等候走廊沙发 */
function WaitingSofa({ x, z, rotY = 0 }: { x: number; z: number; rotY?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.2, 0.22]} material={MAT.woodDark}>
        <boxGeometry args={[0.95, 0.32, 0.48]} />
      </mesh>
      <mesh position={[0, 0.34, -0.12]} material={MAT.woodDark}>
        <boxGeometry args={[0.95, 0.36, 0.18]} />
      </mesh>
      <mesh position={[0, 0.36, 0.02]} material={MAT.pillow}>
        <boxGeometry args={[0.82, 0.08, 0.42]} />
      </mesh>
    </group>
  );
}

/** 精油置物台 */
function OilCabinet({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.42, 0]} material={MAT.wood}>
        <boxGeometry args={[0.45, 0.84, 0.32]} />
      </mesh>
      <mesh position={[-0.08, 0.72, 0.08]} material={MAT.bottle}>
        <cylinderGeometry args={[0.04, 0.04, 0.14, 8]} />
      </mesh>
      <mesh position={[0.08, 0.68, 0.06]} material={MAT.bottle}>
        <cylinderGeometry args={[0.035, 0.035, 0.11, 8]} />
      </mesh>
      <mesh position={[-0.08, 0.8, 0.08]} material={MAT.bottleCap}>
        <cylinderGeometry args={[0.025, 0.025, 0.03, 8]} />
      </mesh>
      <SceneSprite id="spaBubble" position={[0, 1.05, 0]} scale={0.32} />
    </group>
  );
}

/** 单隔间隔断墙体 */
function SpaCubicleShell({ x, z, isLeft, isRight }: { x: number; z: number; isLeft: boolean; isRight: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.52, 1.35]} material={MAT.partition}>
        <boxGeometry args={[2.5, 1.04, 0.1]} />
      </mesh>
      {isLeft && (
        <mesh position={[-1.22, 0.52, 0.35]} material={MAT.partition}>
          <boxGeometry args={[0.1, 1.04, 2.1]} />
        </mesh>
      )}
      {isRight && (
        <mesh position={[1.22, 0.52, 0.35]} material={MAT.partition}>
          <boxGeometry args={[0.1, 1.04, 2.1]} />
        </mesh>
      )}
      <mesh position={[0, 0.98, 1.35]} material={MAT.partitionTrim}>
        <boxGeometry args={[2.55, 0.06, 0.12]} />
      </mesh>
      <mesh position={[0, 0.28, 0.35]} material={MAT.corridor}>
        <boxGeometry args={[2.3, 0.02, 2]} />
      </mesh>
    </group>
  );
}

/** 香薰薄雾 — 最多 30 粒子，仅按摩区激活 */
function SpaMist({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const activeZone = useGameStore(s => s.activeZone);
  const effectsOn = useGameStore(s => s.effectsOn);
  const count = 6;
  const seeds = useMemo(() => Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 0.5,
    z: (Math.random() - 0.5) * 0.5,
    speed: 0.25 + Math.random() * 0.3,
    phase: Math.random() * Math.PI * 2,
  })), []);

  useFrame(({ clock }) => {
    if (!ref.current || activeZone !== 'spa' || !effectsOn) return;
    const t = clock.elapsedTime;
    ref.current.children.forEach((child, i) => {
      const s = seeds[i];
      const cycle = ((t * s.speed + s.phase) % 2);
      child.position.set(s.x, 0.55 + cycle * 0.5, s.z);
      const sc = 0.05 * (1 - cycle / 2);
      child.scale.setScalar(Math.max(0.01, sc));
      (child as THREE.Mesh).material.opacity = Math.max(0, 0.28 * (1 - cycle / 2));
    });
  });

  if (activeZone !== 'spa' || !effectsOn) return null;

  return (
    <group ref={ref} position={position}>
      {seeds.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial color="#c8bee8" transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export interface SpaLoungeProps {
  onSelectTherapist: () => void;
  onSelectBed: (bedId: string) => void;
}

/** 按摩 lounge — 多隔间 + 等候走廊 + 技师企鹅 */
export function SpaLounge({ onSelectTherapist, onSelectBed }: SpaLoungeProps) {
  const bedPositions = useMemo(
    () => SPA_CUBICLES.map(c => [c.x, 0.24, c.z] as [number, number, number]),
    [],
  );

  return (
    <group>
      <FlatFloor w={20} d={14} color={MAT.floor} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -3.2]} material={MAT.corridor}>
        <planeGeometry args={[18, 3.2]} />
      </mesh>

      {/* 隔间后墙 */}
      <mesh position={[0, 0.55, 4.8]} material={MAT.partition}>
        <boxGeometry args={[18, 1.1, 0.12]} />
      </mesh>

      {SPA_CUBICLES.map((c, i) => (
        <SpaCubicleShell
          key={c.id}
          x={c.x}
          z={c.z}
          isLeft={i === 0}
          isRight={i === SPA_CUBICLES.length - 1}
        />
      ))}

      <InstancedMassageBeds positions={bedPositions} />

      {SPA_CUBICLES.map(c => (
        <group key={`oil-${c.id}`}>
            <OilCabinet x={c.x + 1.05} z={c.z + 0.35} />
          <SpaMist position={[c.x + 1.05, 0, c.z + 0.35]} />
          <SceneSprite id="massageHand" position={[c.x, 1.15, c.z]} scale={0.28} />
          <mesh
            position={[c.x, 0.45, c.z]}
            onClick={(e) => { e.stopPropagation(); onSelectBed(c.id); }}
          >
            <boxGeometry args={[1.6, 0.2, 0.8]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </group>
      ))}

      {SPA_WAIT_SOFAS.map((s, i) => (
        <WaitingSofa key={i} x={s.x} z={s.z} rotY={s.rotY} />
      ))}

      {/* 淡紫柔光 */}
      <pointLight color="#c8bee8" intensity={0.6} distance={16} position={[0, 4.5, 0]} />
      <pointLight color="#ede8ff" intensity={0.3} distance={10} position={[-3, 2.5, 1]} />

      {/* 技师企鹅 — 隔间旁待机 */}
      <group
        position={[SPA_THERAPIST.x, 0, SPA_THERAPIST.z]}
        onClick={(e) => { e.stopPropagation(); onSelectTherapist(); }}
      >
        <SceneSprite id="massageHand" position={[0, 2.3, 0]} scale={0.38} />
        <Gugugaga
          role="masseur"
          accentColor="#c8a8e8"
          label="技师 Gaga"
          status="按摩放松"
          scale={1.05}
          onClick={onSelectTherapist}
        />
      </group>
    </group>
  );
}
