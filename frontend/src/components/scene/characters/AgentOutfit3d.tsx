import { useMemo } from 'react';
import * as THREE from 'three';
import type { OutfitId } from '../../../lib/agentOutfits';

function flat(color: string) {
  return new THREE.MeshBasicMaterial({ color });
}

export function AgentOutfit3d({ outfitId, accentColor = '#FFD700' }: { outfitId: OutfitId; accentColor?: string }) {
  const bodyMat = useMemo(() => flat('#e8eef5'), []);
  const accentMat = useMemo(() => flat(accentColor), [accentColor]);
  const darkMat = useMemo(() => flat('#1a1a1a'), []);
  const plateMat = useMemo(() => flat('#b8c4d0'), []);

  if (outfitId === 'default') return null;

  switch (outfitId) {
    case 'panda':
      return (
        <group position={[0, 0.42, 0.02]}>
          <mesh material={darkMat} scale={[1.05, 0.72, 0.88]}>
            <sphereGeometry args={[0.4, 10, 10]} />
          </mesh>
          <mesh position={[0, 0.02, 0.12]} material={flat('#f5f5f5')} scale={[0.55, 0.45, 0.3]}>
            <sphereGeometry args={[0.42, 10, 10]} />
          </mesh>
        </group>
      );
    case 'astronaut':
      return (
        <group position={[0, 0.44, 0]}>
          <mesh material={bodyMat} scale={[1.08, 0.78, 0.92]}>
            <sphereGeometry args={[0.4, 10, 10]} />
          </mesh>
          <mesh position={[0, -0.08, -0.12]} material={flat('#b0c4de')} scale={[0.35, 0.45, 0.2]}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
        </group>
      );
    case 'chef':
      return (
        <mesh position={[0, 0.42, 0.05]} material={flat('#fafafa')} scale={[1.06, 0.75, 0.9]}>
          <sphereGeometry args={[0.4, 10, 10]} />
        </mesh>
      );
    case 'knight':
      return (
        <group position={[0, 0.42, 0]}>
          <mesh position={[0, 0, -0.08]} material={accentMat} scale={[1.2, 0.9, 0.15]}>
            <boxGeometry args={[0.5, 0.6, 1]} />
          </mesh>
          <mesh material={plateMat} scale={[1.05, 0.72, 0.88]}>
            <sphereGeometry args={[0.4, 10, 10]} />
          </mesh>
        </group>
      );
    case 'street':
      return (
        <group position={[0, 0.44, 0]}>
          <mesh material={accentMat} scale={[1.08, 0.78, 0.92]}>
            <sphereGeometry args={[0.4, 10, 10]} />
          </mesh>
          <mesh position={[0, 0.28, 0.08]} material={accentMat} scale={[0.7, 0.35, 0.5]}>
            <boxGeometry args={[0.5, 0.4, 0.3]} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}
