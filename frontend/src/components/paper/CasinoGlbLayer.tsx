import { Component, Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Center, useGLTF } from '@react-three/drei';
import { useGameStore } from '../../store/useGameStore';
import { WORLD_MAP, ZONE_CAMERA } from '../../lib/worldMap';
import { PAPER } from '../../lib/zoneProjection';
import { CASINO_TABLE } from '../../lib/zoneFurniture';
import { POKER_MODEL, POKER_MODEL_URL } from '../../lib/pokerModelConfig';
import { makePaperCamera, camToScreen } from './renderZone';

function PokerTableMesh() {
  const { scene } = useGLTF(POKER_MODEL_URL);
  const setPokerGlbReady = useGameStore(s => s.setPokerGlbReady);
  const model = useMemo(() => scene.clone(), [scene]);
  useEffect(() => {
    setPokerGlbReady(true);
    return () => setPokerGlbReady(false);
  }, [setPokerGlbReady]);
  return (
    <Center>
      <group rotation={[0, POKER_MODEL.rotY, 0]} position={[0, POKER_MODEL.offsetY, 0]}>
        <primitive object={model} scale={POKER_MODEL.scale} />
      </group>
    </Center>
  );
}

class GlbErrorBoundary extends Component<
  { onError: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function TableCanvas() {
  const pitch = POKER_MODEL.cameraPitch;
  const dist = POKER_MODEL.cameraDistance;
  const camY = Math.sin(-pitch) * dist;
  const camZ = Math.cos(-pitch) * dist;
  return (
    <Canvas
      gl={{ alpha: true, antialias: true }}
      dpr={Math.min(window.devicePixelRatio, 2)}
      camera={{ position: [0, camY, camZ], fov: 38, near: 0.1, far: 100 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} />
      <directionalLight position={[-4, 2, -2]} intensity={0.35} />
      <Suspense fallback={null}>
        <PokerTableMesh />
      </Suspense>
    </Canvas>
  );
}

export interface CasinoGlbLayerProps {
  cw: number;
  ch: number;
}

export function CasinoGlbLayer({ cw, ch }: CasinoGlbLayerProps) {
  const activeZone = useGameStore(s => s.activeZone);
  const cameraLookAt = useGameStore(s => s.cameraLookAt);
  const cameraZoom = useGameStore(s => s.cameraZoom);
  const setPokerGlbReady = useGameStore(s => s.setPokerGlbReady);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(POKER_MODEL_URL, { method: 'HEAD' })
      .then(res => {
        if (!cancelled) {
          setAvailable(res.ok);
          if (res.ok) useGLTF.preload(POKER_MODEL_URL);
        }
      })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!available) setPokerGlbReady(false);
  }, [available, setPokerGlbReady]);

  if (activeZone !== 'casino' || cw < 1 || ch < 1 || !available) return null;

  const camMeta = ZONE_CAMERA.casino;
  const panX = (cameraLookAt.x - camMeta.x) * PAPER.ppu;
  const panY = (cameraLookAt.z - camMeta.z) * PAPER.ppu;
  const cam = makePaperCamera(cw, ch, cameraZoom, WORLD_MAP.defaultZoom, panX, panY);
  const center = camToScreen(cam, CASINO_TABLE.px, CASINO_TABLE.py);
  const w = CASINO_TABLE.r * POKER_MODEL.viewportFactor * cam.scale;
  const h = w * 0.72;

  return (
    <div
      className="casino-glb-layer"
      style={{
        position: 'absolute',
        left: center.x - w / 2,
        top: center.y - h / 2,
        width: w,
        height: h,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <GlbErrorBoundary onError={() => setPokerGlbReady(false)}>
        <TableCanvas />
      </GlbErrorBoundary>
    </div>
  );
}
