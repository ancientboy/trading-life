import * as THREE from 'three';
import { SceneSprite } from '../ui/SceneSprite';

/** 世界地图大号休息包厢卡座 */
export function RestBoothWorld({ x, z, flip = false }: { x: number; z: number; flip?: boolean }) {
  const sx = flip ? -1 : 1;
  return (
    <group position={[x, 0, z]} scale={[sx, 1, 1]}>
      <mesh position={[0, 0.95, -0.85]}>
        <boxGeometry args={[3.6, 2, 0.14]} />
        <meshToonMaterial color="#c8baa8" />
      </mesh>
      <mesh position={[-1.65, 0.95, 0.1]}>
        <boxGeometry args={[0.14, 2, 2.4]} />
        <meshToonMaterial color="#b8aa98" />
      </mesh>
      <mesh position={[1.65, 0.95, 0.1]}>
        <boxGeometry args={[0.14, 2, 2.4]} />
        <meshToonMaterial color="#b8aa98" />
      </mesh>
      <mesh position={[0, 0.38, 0.25]}>
        <boxGeometry args={[2.8, 0.55, 1.2]} />
        <meshToonMaterial color="#8b7355" />
      </mesh>
      <mesh position={[0, 0.68, 0.25]}>
        <boxGeometry args={[2.5, 0.14, 1]} />
        <meshToonMaterial color="#d4c8b8" />
      </mesh>
      <mesh position={[0.85, 0.48, 0.85]}>
        <cylinderGeometry args={[0.28, 0.28, 0.05, 12]} />
        <meshToonMaterial color="#d4c8b8" />
      </mesh>
      <SceneSprite id="plateCoffee" position={[-0.7, 1.35, 0.55]} scale={0.38} />
    </group>
  );
}
