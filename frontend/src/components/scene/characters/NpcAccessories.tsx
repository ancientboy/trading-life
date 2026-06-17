import * as THREE from 'three';
import { outfitForRole, type NpcRole } from '../../../lib/npcOutfits';

const MAT = new Map<string, THREE.MeshBasicMaterial>();
function flat(color: string) {
  if (!MAT.has(color)) MAT.set(color, new THREE.MeshBasicMaterial({ color }));
  return MAT.get(color)!;
}

/** 各 NPC 职业帽子 / 服装 / 道具 — 叠在企鹅本体之上 */
export function NpcAccessories({ role }: { role: NpcRole }) {
  const o = outfitForRole(role);

  return (
    <group>
      {o.vestColor && (
        <mesh position={[0, 0.52, 0.32]} material={flat(o.vestColor)}>
          <boxGeometry args={[0.38, 0.32, 0.06]} />
        </mesh>
      )}
      {o.apronColor && (
        <mesh position={[0, 0.42, 0.34]} material={flat(o.apronColor)}>
          <boxGeometry args={[0.34, 0.38, 0.04]} />
        </mesh>
      )}
      {o.badgeColor && (
        <mesh position={[0, 0.58, 0.36]} material={flat(o.badgeColor)}>
          <circleGeometry args={[0.05, 10]} />
        </mesh>
      )}
      {o.bowtie && (
        <mesh position={[0, 0.72, 0.28]} material={flat('#ffffff')}>
          <boxGeometry args={[0.12, 0.06, 0.03]} />
        </mesh>
      )}

      {o.hat === 'concierge' && (
        <group position={[0, 1.02, 0.08]}>
          <mesh material={flat(o.hatColor)}>
            <cylinderGeometry args={[0.22, 0.24, 0.1, 12]} />
          </mesh>
          <mesh position={[0, 0.06, 0]} material={flat('#1a1a1a')}>
            <cylinderGeometry args={[0.14, 0.14, 0.04, 12]} />
          </mesh>
        </group>
      )}
      {o.hat === 'chef' && (
        <group position={[0, 1.08, 0.06]}>
          <mesh material={flat(o.hatColor)}>
            <cylinderGeometry args={[0.18, 0.22, 0.22, 12]} />
          </mesh>
          <mesh position={[0, 0.14, 0]} material={flat(o.hatColor)}>
            <cylinderGeometry args={[0.24, 0.2, 0.06, 12]} />
          </mesh>
        </group>
      )}
      {o.hat === 'headband' && (
        <mesh position={[0, 0.96, 0.12]} material={flat(o.hatColor)}>
          <boxGeometry args={[0.44, 0.06, 0.08]} />
        </mesh>
      )}
      {o.hat === 'dealer' && (
        <group position={[0, 1.06, 0.06]}>
          <mesh material={flat(o.hatColor)}>
            <cylinderGeometry args={[0.26, 0.26, 0.08, 16]} />
          </mesh>
          <mesh position={[0, 0.06, 0]} material={flat(o.hatColor)}>
            <cylinderGeometry args={[0.18, 0.18, 0.12, 16]} />
          </mesh>
        </group>
      )}

      {o.prop === 'tray' && (
        <mesh position={[0.38, 0.58, 0.22]} rotation={[0.3, 0, 0]} material={flat('#d4c8b8')}>
          <cylinderGeometry args={[0.14, 0.14, 0.02, 12]} />
        </mesh>
      )}
      {o.prop === 'cards' && (
        <mesh position={[0.32, 0.6, 0.24]} rotation={[0.2, -0.3, 0.1]} material={flat('#ffffff')}>
          <boxGeometry args={[0.14, 0.02, 0.18]} />
        </mesh>
      )}
    </group>
  );
}
