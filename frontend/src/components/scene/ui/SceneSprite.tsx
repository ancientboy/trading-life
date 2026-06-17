import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { SpriteId } from '../../icons/spritePaths';
import { getSpriteTexture, loadSpriteTexture, spriteUrl } from '../../../lib/spriteTextures';

interface SceneSpriteProps {
  id: SpriteId;
  position?: [number, number, number];
  scale?: number;
  visible?: boolean;
}

export function SceneSprite({ id, position = [0, 2, 0], scale = 0.55, visible = true }: SceneSpriteProps) {
  const url = spriteUrl(id);
  const cached = getSpriteTexture(url);
  const [texture, setTexture] = useState<THREE.Texture | null>(cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    loadSpriteTexture(url).then(tex => { if (alive) setTexture(tex); }).catch(() => {});
    return () => { alive = false; };
  }, [url, cached]);

  const mat = useMemo(() => {
    if (!texture) return null;
    return new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: true });
  }, [texture]);

  if (!visible || !mat) return null;
  return <sprite position={position} scale={[scale, scale, 1]} material={mat} renderOrder={10} />;
}
