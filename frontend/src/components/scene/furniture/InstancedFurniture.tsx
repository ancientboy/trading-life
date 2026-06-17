import { useMemo } from 'react';
import * as THREE from 'three';

interface Props {
  positions: [number, number, number][];
  color?: string;
  scale?: [number, number, number];
}

export function InstancedBoxes({ positions, color = '#8b7355', scale = [1.2, 0.08, 0.6] }: Props) {
  const meshRef = useMemo(() => new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshToonMaterial({ color }),
    positions.length,
  ), [positions.length, color]);

  useMemo(() => {
    const m = new THREE.Matrix4();
    positions.forEach(([x, y, z], i) => {
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(scale[0], scale[1], scale[2]));
      meshRef.setMatrixAt(i, m);
    });
    meshRef.instanceMatrix.needsUpdate = true;
  }, [positions, scale, meshRef]);

  return <primitive object={meshRef} castShadow receiveShadow />;
}

export function InstancedBeds({ positions }: { positions: [number, number, number][] }) {
  return (
    <>
      <InstancedBoxes positions={positions} color="#f0ebe3" scale={[1.6, 0.35, 0.7]} />
      <InstancedBoxes positions={positions.map(([x,,z]) => [x, 0.42, z] as [number,number,number])} color="#ffffff" scale={[1.4, 0.08, 0.6]} />
    </>
  );
}
