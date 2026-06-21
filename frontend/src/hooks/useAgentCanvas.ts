import { useEffect, useRef } from 'react';

export interface AgentCanvasOptions {
  width: number;
  height: number;
  /** 最大 DPR，默认 2 */
  maxDpr?: number;
  /** 是否在 RAF 中持续重绘 */
  animate?: boolean;
  paint: (ctx: CanvasRenderingContext2D, dpr: number, t: number) => void;
  /** 额外依赖 — 变化时触发重绘 */
  deps?: unknown[];
}

/** 共享 Canvas 2D 初始化：DPR 缩放 + 可选 RAF 循环 */
export function useAgentCanvas({
  width,
  height,
  maxDpr = 2,
  animate = false,
  paint,
  deps = [],
}: AgentCanvasOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (!animate) {
      paintRef.current(ctx, dpr, 0);
      return;
    }

    let raf = 0;
    let alive = true;
    const t0 = performance.now();
    const loop = (now: number) => {
      if (!alive) return;
      paintRef.current(ctx, dpr, (now - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [width, height, maxDpr, animate, ...deps]);

  return canvasRef;
}
