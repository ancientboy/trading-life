import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

function SteamParticles({ position, color = '#ffffff', count = 12 }: { position: [number, number, number]; color?: string; count?: number }) {
  const ref = useRef<THREE.Group>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (Math.random() - 0.5) * 0.8,
    z: (Math.random() - 0.5) * 0.8,
    speed: 0.3 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
    scale: 0.04 + Math.random() * 0.06,
  })), [count]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.children.forEach((child, i) => {
      const s = seeds[i];
      const cycle = ((t * s.speed + s.phase) % 2);
      child.position.set(s.x, 0.2 + cycle * 0.8, s.z);
      const sc = s.scale * (1 - cycle / 2);
      child.scale.setScalar(Math.max(0.01, sc));
      (child as THREE.Mesh).material.opacity = Math.max(0, 0.35 * (1 - cycle / 2));
    });
  });

  return (
    <group ref={ref} position={position}>
      {seeds.map((s, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function PulseLight({ position, color, intensity = 0.6 }: { position: [number, number, number]; color: string; intensity?: number }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.intensity = intensity + Math.sin(clock.elapsedTime * 2) * 0.2;
  });
  return <pointLight ref={ref} color={color} intensity={intensity} distance={6} position={position} />;
}

function FloatingCards({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.8) * 0.15;
  });
  const cards: [number, number, number, number][] = [[-0.3, 0.7, 0, 0.2], [0, 0.75, 0.05, -0.1], [0.3, 0.7, 0, 0.15]];
  return (
    <group ref={ref} position={position}>
      {cards.map(([x, y, z, ry], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, ry, 0]}>
          <boxGeometry args={[0.18, 0.25, 0.02]} />
          <meshToonMaterial color={i === 1 ? '#d4af37' : '#f8f8f8'} />
        </mesh>
      ))}
    </group>
  );
}

function ChipStack({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {[0, 0.04, 0.08].map((y, i) => (
        <mesh key={i} position={[0, 0.65 + y, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.035, 16]} />
          <meshToonMaterial color={i === 2 ? '#d4af37' : i === 1 ? '#48d093' : '#56a3ff'} />
        </mesh>
      ))}
    </group>
  );
}

function RestaurantTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.7, 0.7, 0.06, 16]} />
        <meshToonMaterial color="#d4c8b8" />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.5, 8]} />
        <meshToonMaterial color="#8b7355" />
      </mesh>
      {[[-0.5, 0.2, 0.5], [0.5, 0.2, 0.5], [-0.5, 0.2, -0.5], [0.5, 0.2, -0.5]].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <boxGeometry args={[0.25, 0.4, 0.25]} />
          <meshToonMaterial color="#a08060" />
        </mesh>
      ))}
      <mesh position={[0, 0.52, 0.15]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshToonMaterial color="#ff8866" />
      </mesh>
      <mesh position={[0.15, 0.51, -0.1]}>
        <cylinderGeometry args={[0.08, 0.08, 0.06, 8]} />
        <meshToonMaterial color="#f8f8f8" />
      </mesh>
      <SteamParticles position={[0, 0.55, 0.1]} color="#ffe8d0" count={8} />
    </group>
  );
}

function SpaBed({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[1.6, 0.35, 0.7]} />
        <meshToonMaterial color="#f0ebe3" />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[1.4, 0.08, 0.6]} />
        <meshToonMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.5, 0.04, 0.35]} />
        <meshToonMaterial color="#c8a8e8" />
      </mesh>
      <SteamParticles position={[0, 0.5, 0]} color="#e8d0ff" count={10} />
      <PulseLight position={[0, 1.2, 0]} color="#c8a8e8" />
    </group>
  );
}

function CasinoTable({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 0.5 + Math.sin(clock.elapsedTime * 1.5) * 0.05;
      ref.current.children[0]?.scale.set(s, 1, s);
    }
  });
  return (
    <group position={position}>
      <group ref={ref}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[1.8, 1.8, 0.12, 24]} />
          <meshToonMaterial color="#1a5c3a" />
        </mesh>
      </group>
      <mesh position={[0, 0.62, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 0.02, 24]} />
        <meshToonMaterial color="#0d3d25" />
      </mesh>
      <FloatingCards position={[0, 0, 0]} />
      <ChipStack position={[-1, 0, 0.8]} />
      <ChipStack position={[1, 0, -0.8]} />
      <PulseLight position={[0, 2, 0]} color="#d4af37" intensity={0.8} />
    </group>
  );
}

export function ZoneEffects() {
  return (
    <group>
      <RestaurantTable position={[7, 0, 18.5]} />
      <RestaurantTable position={[12, 0, 18.5]} />
      <RestaurantTable position={[17, 0, 18.5]} />
      <SpaBed position={[27, 0, 11.8]} />
      <SpaBed position={[30, 0, 11.8]} />
      <SpaBed position={[33, 0, 11.8]} />
      <CasinoTable position={[36, 0, 21]} />
    </group>
  );
}
