import {
  HomeIcon,
  UserIcon,
  DocumentChartBarIcon,
  ChartPieIcon,
  CakeIcon,
  SparklesIcon,
  Squares2X2Icon,
  CubeIcon,
  UsersIcon,
  ClipboardDocumentListIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  UserIcon as UserSolid,
  DocumentChartBarIcon as DocChartSolid,
  ChartPieIcon as ChartPieSolid,
  CakeIcon as CakeSolid,
  SparklesIcon as SparklesSolid,
  Squares2X2Icon as SquaresSolid,
  CubeIcon as CubeSolid,
  UsersIcon as UsersSolid,
  ClipboardDocumentListIcon as ClipboardSolid,
  ComputerDesktopIcon as DesktopSolid,
} from '@heroicons/react/24/solid';
import type { SidebarAction } from '../../store/useGameStore';
import type { ComponentType, SVGProps } from 'react';

type Pair = { outline: ComponentType<SVGProps<SVGSVGElement>>; solid: ComponentType<SVGProps<SVGSVGElement>> };

export const SIDEBAR_ICONS: Record<SidebarAction | 'minimal', Pair> = {
  hall: { outline: HomeIcon, solid: HomeSolid },
  agents: { outline: UserIcon, solid: UserSolid },
  strategy: { outline: DocumentChartBarIcon, solid: DocChartSolid },
  positions: { outline: ChartPieIcon, solid: ChartPieSolid },
  restaurant: { outline: CakeIcon, solid: CakeSolid },
  spa: { outline: SparklesIcon, solid: SparklesSolid },
  casino: { outline: Squares2X2Icon, solid: SquaresSolid },
  warehouse: { outline: CubeIcon, solid: CubeSolid },
  social: { outline: UsersIcon, solid: UsersSolid },
  logs: { outline: ClipboardDocumentListIcon, solid: ClipboardSolid },
  minimal: { outline: ComputerDesktopIcon, solid: DesktopSolid },
};
