/** Canvas 2D 绘制工具函数 */
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function dropShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 0.1) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, w / 2, h / 3, 0, 0, Math.PI * 2);
  ctx.fill();
}
