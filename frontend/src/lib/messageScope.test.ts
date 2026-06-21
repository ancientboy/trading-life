import { describe, expect, it } from 'vitest';
import {
  filterMessagesForZone,
  inferMessageScope,
  messageVisibleInZone,
  pauseBackgroundAgentAi,
} from './messageScope';

describe('messageScope', () => {
  it('strict zone visibility', () => {
    expect(messageVisibleInZone('hall', 'arena')).toBe(false);
    expect(messageVisibleInZone('arena', 'arena')).toBe(true);
    expect(messageVisibleInZone('spa', 'spa')).toBe(true);
    expect(messageVisibleInZone('global', 'casino')).toBe(true);
  });

  it('infers and filters hall rest in arena', () => {
    const text = 'Newcoin Agent：休息沙发已满（共 4 座，均已占用），活动取消';
    expect(inferMessageScope(text)).toBe('hall');
    const msgs = [{ text, time: '12:00' }];
    expect(filterMessagesForZone(msgs, 'arena')).toHaveLength(0);
    expect(filterMessagesForZone(msgs, 'hall')).toHaveLength(1);
  });

  it('filters cross-zone in spa', () => {
    const msgs = [
      { text: '猜涨跌封盘中', time: '1' },
      { text: '技师 Gaga：欢迎理疗', time: '2' },
    ];
    const spa = filterMessagesForZone(msgs, 'spa');
    expect(spa).toHaveLength(1);
    expect(spa[0].text).toContain('理疗');
  });

  it('pauses background AI outside hall', () => {
    expect(pauseBackgroundAgentAi('hall')).toBe(false);
    expect(pauseBackgroundAgentAi('spa')).toBe(true);
    expect(pauseBackgroundAgentAi('arena')).toBe(true);
  });
});
