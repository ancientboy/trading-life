import type { ComponentType, SVGProps } from 'react';
import { ICON_COLORS, ICON_SIZES, STROKE, type IconColor, type IconSize } from './tokens';

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface AppIconProps {
  icon: SvgIcon;
  size?: IconSize;
  color?: IconColor;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

export function AppIcon({
  icon: Icon,
  size = 'sidebar',
  color = 'muted',
  className,
  strokeWidth,
  style,
}: AppIconProps) {
  const px = ICON_SIZES[size];
  const sw = strokeWidth ?? (size === 'mini' ? STROKE.mini : STROKE.default);
  return (
    <Icon
      className={className}
      width={px}
      height={px}
      style={{ color: ICON_COLORS[color], flexShrink: 0, ...style }}
      strokeWidth={sw}
      aria-hidden
    />
  );
}

/** 侧边栏 / 导航：outline 默认，hover/active 切 solid */
interface NavIconProps {
  outline: SvgIcon;
  solid: SvgIcon;
  active?: boolean;
  hovered?: boolean;
  size?: IconSize;
  color?: IconColor;
}

export function NavIcon({ outline, solid, active, hovered, size = 'sidebar', color }: NavIconProps) {
  const Icon = active || hovered ? solid : outline;
  const c = active ? 'gold' : color ?? 'muted';
  return <AppIcon icon={Icon} size={size} color={c} />;
}
