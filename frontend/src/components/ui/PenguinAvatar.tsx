import { drawAgent } from '../paper/paperDraw';
import { resolveAppearance, type AgentHeadwear, type HatStyleId } from '../../lib/agentAppearance';
import type { OutfitId } from '../../lib/agentOutfits';
import { useAgentCanvas } from '../../hooks/useAgentCanvas';

export interface PenguinAvatarProps {
  color: string;
  headwear?: AgentHeadwear;
  hatStyle?: HatStyleId;
  speciesId?: string;
  hairStyle?: string;
  outfitId?: OutfitId | string;
  scarfEnabled?: boolean;
  hatEnabled?: boolean;
  size?: number;
  selected?: boolean;
}

/** 迷你 Q 版头像 — Canvas 2D 矢量，与游戏场景一致 */
export function PenguinAvatar({
  color,
  headwear = 'scarf',
  hatStyle = 'beanie',
  speciesId,
  hairStyle,
  outfitId,
  scarfEnabled,
  hatEnabled,
  size = 48,
  selected,
}: PenguinAvatarProps) {
  const ap = resolveAppearance({ color, headwear, hatStyle, speciesId, outfitId, hairStyle, scarfEnabled, hatEnabled });

  const canvasRef = useAgentCanvas({
    width: size,
    height: size,
    deps: [ap.color, ap.speciesId, ap.outfitId, ap.hairStyle, ap.scarfEnabled, ap.hatEnabled, ap.headwear, ap.hatStyle, size],
    paint: (ctx, dpr) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#faf6ef';
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, size * 0.22);
      ctx.fill();
      const scale = size / 52;
      ctx.save();
      ctx.translate(size / 2, size * 0.58);
      ctx.scale(scale, scale);
      drawAgent(ctx, 0, 0, ap.color, {
        speciesId: ap.speciesId,
        outfitId: ap.outfitId,
        hairStyle: ap.hairStyle,
        scarfEnabled: ap.scarfEnabled,
        hatEnabled: ap.hatEnabled,
        headwear: ap.headwear,
        hatStyle: ap.hatStyle,
        facing: 's',
        walking: false,
        t: 0,
      });
      ctx.restore();
    },
  });

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        border: selected ? '2px solid #d4af37' : '2px solid transparent',
        borderRadius: size * 0.22,
        display: 'block',
      }}
    />
  );
}
