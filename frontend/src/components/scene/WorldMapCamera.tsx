import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/useGameStore';
import { WORLD_MAP, ZONE_CAMERA } from '../../lib/worldMap';

/** 纯俯视 2D 正交相机 — 默认交易大厅，可拖拽平移 */
export function WorldMapCamera() {
  const { camera, size, gl } = useThree();
  const lookAt = useGameStore(s => s.cameraLookAt);
  const zoom = useGameStore(s => s.cameraZoom);
  const followAgentId = useGameStore(s => s.followAgentId);
  const agents = useGameStore(s => s.agents);
  const panCamera = useGameStore(s => s.panCamera);
  const setCameraZoom = useGameStore(s => s.setCameraZoom);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const smooth = useRef({ ...ZONE_CAMERA.hall });

  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { dragging.current = false; };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dist = Math.hypot(e.clientX - last.current.x, e.clientY - last.current.y);
      if (dist < 4) return;
      const scale = 24 / zoom;
      panCamera(-(e.clientX - last.current.x) * scale, (e.clientY - last.current.y) * scale);
      last.current = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCameraZoom(zoom + (e.deltaY > 0 ? -2 : 2));
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl.domElement, panCamera, setCameraZoom, zoom]);

  useFrame((_, dt) => {
    const ortho = camera as THREE.OrthographicCamera;
    if (!ortho.isOrthographicCamera) return;

    let tx = lookAt.x;
    let tz = lookAt.z;
    if (followAgentId && agents[followAgentId]) {
      tx = agents[followAgentId].x;
      tz = agents[followAgentId].z;
    }

    const k = Math.min(1, dt * 5);
    smooth.current.x += (tx - smooth.current.x) * k;
    smooth.current.z += (tz - smooth.current.z) * k;
    const cx = smooth.current.x;
    const cz = smooth.current.z;
    const h = WORLD_MAP.cameraHeight;

    ortho.position.set(cx, h, cz);
    ortho.up.set(0, 1, 0);
    ortho.left = -size.width / 2;
    ortho.right = size.width / 2;
    ortho.top = size.height / 2;
    ortho.bottom = -size.height / 2;
    ortho.zoom = zoom;
    ortho.near = 0.1;
    ortho.far = 200;
    ortho.lookAt(cx, 0, cz);
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld(true);
  });

  return null;
}

export function createWorldOrthoCamera(size: { width: number; height: number }) {
  const hall = ZONE_CAMERA.hall;
  const cam = new THREE.OrthographicCamera(
    -size.width / 2, size.width / 2,
    size.height / 2, -size.height / 2,
    0.1, 200,
  );
  cam.position.set(hall.x, WORLD_MAP.cameraHeight, hall.z);
  cam.up.set(0, 1, 0);
  cam.zoom = WORLD_MAP.defaultZoom;
  cam.lookAt(hall.x, 0, hall.z);
  cam.updateProjectionMatrix();
  return cam;
}
