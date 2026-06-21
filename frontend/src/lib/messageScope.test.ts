import { describe, expect, it } from 'vitest';
import { inferMessageScope, messageVisibleInZone } from './messageScope';

describe('messageScope', () => {
  it('hides hall rest message in arena', () => {
    const text = 'Newcoin Agent：休息沙发已满（共 4 座，均已占用），活动取消';
    expect(inferMessageScope(text)).toBe('hall');
    expect(messageVisibleInZone('hall', 'arena')).toBe(false);
  });

  it('shows arena PK message in arena', () => {
    expect(messageVisibleInZone(inferMessageScope('猜涨跌封盘中'), 'arena')).toBe(true);
  });
});
