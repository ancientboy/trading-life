import { TrendUp, TrendDown, ChartLineUp, ChartPieSlice } from '@phosphor-icons/react';
import { ICON_COLORS, ICON_SIZES } from './tokens';

interface DuotoneProps { size?: number; className?: string }

export function ProfitIcon({ size = ICON_SIZES.mini, className }: DuotoneProps) {
  return <TrendUp size={size} weight="duotone" color={ICON_COLORS.profit} className={className} />;
}

export function LossIcon({ size = ICON_SIZES.mini, className }: DuotoneProps) {
  return <TrendDown size={size} weight="duotone" color={ICON_COLORS.loss} className={className} />;
}

export function ChartProfitIcon({ size = ICON_SIZES.modal, className }: DuotoneProps) {
  return <ChartLineUp size={size} weight="duotone" color={ICON_COLORS.profit} className={className} />;
}

export function PieAssetIcon({ size = ICON_SIZES.modal, className }: DuotoneProps) {
  return <ChartPieSlice size={size} weight="duotone" color={ICON_COLORS.gold} className={className} />;
}
