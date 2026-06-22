import { describe, expect, it } from 'vitest';
import {
  shouldShowPkResult, markPkResultShown, dismissPkResult,
  shouldShowGuessResult, markGuessResultShown, dismissGuessResult,
} from './tradingResultDismiss';

describe('tradingResultDismiss', () => {
  it('blocks repeat PK modal after dismiss', () => {
    const rid = 'test-round-' + Math.random();
    expect(shouldShowPkResult(rid)).toBe(true);
    markPkResultShown(rid);
    expect(shouldShowPkResult(rid)).toBe(false);
    dismissPkResult(rid);
    expect(shouldShowPkResult(rid)).toBe(false);
  });

  it('blocks repeat guess modal after dismiss', () => {
    const rid = 'guess-round-' + Math.random();
    expect(shouldShowGuessResult(rid)).toBe(true);
    markGuessResultShown(rid);
    expect(shouldShowGuessResult(rid)).toBe(false);
    dismissGuessResult(rid);
    expect(shouldShowGuessResult(rid)).toBe(false);
  });
});
