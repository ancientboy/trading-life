import {
  TrendingUp, Shield, CloudRain, Coins, Wind, Cloud,
  ArrowUpRight, ArrowDownRight, Utensils, Droplets, CircleDollarSign,
  Sparkles, Bed,
} from 'lucide-react';
import { AppIcon } from './AppIcon';
import type { IconColor } from './tokens';

export const LucideIcons = {
  riskAggressive: TrendingUp,
  riskConservative: Shield,
  panic: CloudRain,
  greed: Coins,
  buffRelax: Wind,
  debuffStress: Cloud,
  takeProfit: ArrowUpRight,
  stopLoss: ArrowDownRight,
  dine: Utensils,
  massage: Sparkles,
  massageOil: Droplets,
  massageWind: Wind,
  massageBed: Bed,
  poker: CircleDollarSign,
};

interface MiniIconProps { color?: IconColor; className?: string }

export function MiniLucide({ icon: Icon, color = 'muted', className }: MiniIconProps & { icon: typeof TrendingUp }) {
  return <AppIcon icon={Icon} size="mini" color={color} className={className} strokeWidth={1.5} />;
}
