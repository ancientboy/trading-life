import { useMemo } from 'react';
import * as THREE from 'three';

/** 3D 名牌 — 不用 drei Html，避免 DOM 遮罩盖住画布 */
export function NameTag({ label, status, accentColor = '#FFD700' }: {
  label: string; status?: string; accentColor?: string;
}) {
  const { map, w, h } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = status ? 96 : 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,252,247,0.96)';
    ctx.strokeStyle = '#e0d8cc';
    ctx.lineWidth = 2;
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(canvas.width - r, 0);
    ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r);
    ctx.lineTo(canvas.width, canvas.height - r);
    ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height);
    ctx.lineTo(r, canvas.height);
    ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accentColor;
    ctx.font = 'bold 28px Inter,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, canvas.width / 2, status ? 36 : 40);
    if (status) {
      ctx.fillStyle = '#888888';
      ctx.font = '22px Inter,sans-serif';
      ctx.fillText(status, canvas.width / 2, 72);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { map: tex, w: 1.4, h: status ? 0.42 : 0.28 };
  }, [label, status, accentColor]);

  return (
    <mesh position={[0, 1.55, 0]} renderOrder={20}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={map} transparent depthTest={false} toneMapped={false} />
    </mesh>
  );
}
