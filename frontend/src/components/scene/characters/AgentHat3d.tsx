import * as THREE from 'three';
import type { HatStyleId } from '../../lib/agentAppearance';

const MAT = new Map<string, THREE.MeshBasicMaterial>();
function flat(color: string) {
  if (!MAT.has(color)) MAT.set(color, new THREE.MeshBasicMaterial({ color }));
  return MAT.get(color)!;
}

/** Agent 帽子 3D */
export function AgentHat3d({ style, color }: { style: HatStyleId; color: string }) {
  const shade = color; // flat materials; slight size diff for brim
  switch (style) {
    case 'beanie':
      return (
        <group position={[0, 1.02, 0.06]}>
          <mesh material={flat(color)}><sphereGeometry args={[0.24, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>
          <mesh position={[0, -0.04, 0]} material={flat(color)}><cylinderGeometry args={[0.26, 0.26, 0.05, 12]} /></mesh>
        </group>
      );
    case 'bobble':
      return (
        <group position={[0, 1.02, 0.06]}>
          <mesh material={flat(color)}><sphereGeometry args={[0.24, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>
          <mesh position={[0, 0.18, 0]} material={flat(color)}><sphereGeometry args={[0.08, 10, 10]} /></mesh>
        </group>
      );
    case 'cap':
      return (
        <group position={[0, 1.0, 0.04]}>
          <mesh material={flat(color)}><sphereGeometry args={[0.22, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} /></mesh>
          <mesh position={[0, -0.02, 0.12]} rotation={[0.35, 0, 0]} material={flat(shade)}>
            <boxGeometry args={[0.34, 0.03, 0.2]} />
          </mesh>
        </group>
      );
    case 'top':
      return (
        <group position={[0, 1.06, 0.06]}>
          <mesh material={flat(color)}><cylinderGeometry args={[0.22, 0.22, 0.2, 14]} /></mesh>
          <mesh position={[0, -0.12, 0]} material={flat(color)}><cylinderGeometry args={[0.28, 0.28, 0.05, 14]} /></mesh>
        </group>
      );
    case 'beret':
      return (
        <mesh position={[0.04, 1.0, 0.08]} rotation={[0, 0, 0.2]} material={flat(color)}>
          <cylinderGeometry args={[0.24, 0.24, 0.07, 14]} />
        </mesh>
      );
  }
}
