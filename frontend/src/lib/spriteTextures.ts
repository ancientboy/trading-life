import * as THREE from 'three';
import { SPRITE, type SpriteId } from '../components/icons/spritePaths';

const cache = new Map<string, THREE.Texture>();
const loading = new Map<string, Promise<THREE.Texture>>();

export function getSpriteTexture(url: string): THREE.Texture | null {
  return cache.get(url) ?? null;
}

export function loadSpriteTexture(url: string): Promise<THREE.Texture> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(url);
  if (pending) return pending;

  const p = new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        cache.set(url, tex);
        loading.delete(url);
        resolve(tex);
      },
      undefined,
      (err) => {
        loading.delete(url);
        reject(err);
      },
    );
  });
  loading.set(url, p);
  return p;
}

export function preloadAllSprites(): Promise<void> {
  return Promise.all(Object.values(SPRITE).map(loadSpriteTexture)).then(() => undefined);
}

export function spriteUrl(id: SpriteId): string {
  return SPRITE[id];
}
