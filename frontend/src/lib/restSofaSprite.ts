const REST_SOFA_SPRITE_URL = `${import.meta.env.BASE_URL}assets/sprite/rest-sofa.png`;

let img: HTMLImageElement | null = null;
let loading: Promise<HTMLImageElement> | null = null;

export function loadRestSofaSprite(): Promise<HTMLImageElement> {
  if (img?.complete && img.naturalWidth > 0) return Promise.resolve(img);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      img = el;
      resolve(el);
    };
    el.onerror = reject;
    el.src = REST_SOFA_SPRITE_URL;
  });
  return loading;
}

export function getRestSofaSprite(): HTMLImageElement | null {
  if (img?.complete && img.naturalWidth > 0) return img;
  void loadRestSofaSprite();
  return null;
}

loadRestSofaSprite();
