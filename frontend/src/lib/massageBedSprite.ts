const MASSAGE_BED_SPRITE_URL = `${import.meta.env.BASE_URL}assets/sprite/massage-bed.png`;

let img: HTMLImageElement | null = null;
let loading: Promise<HTMLImageElement> | null = null;

export function loadMassageBedSprite(): Promise<HTMLImageElement> {
  if (img?.complete && img.naturalWidth > 0) return Promise.resolve(img);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      img = el;
      resolve(el);
    };
    el.onerror = reject;
    el.src = MASSAGE_BED_SPRITE_URL;
  });
  return loading;
}

export function getMassageBedSprite(): HTMLImageElement | null {
  if (img?.complete && img.naturalWidth > 0) return img;
  void loadMassageBedSprite();
  return null;
}

loadMassageBedSprite();
