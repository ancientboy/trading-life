const GUESS_BET_WINDOW_MS = 50_000;

export type GuessClock = {
  secondsLeft: number;
  bettingSecondsLeft: number;
  bettingOpen: boolean;
  settling: boolean;
  statusLabel: string;
};

export function guessClockFromRound(
  guess: {
    ends_at: number;
    starts_at: number;
    status: string;
    betting_open?: boolean;
    settling?: boolean;
  } | null | undefined,
  nowMs = Date.now(),
): GuessClock {
  if (!guess) {
    return {
      secondsLeft: 0,
      bettingSecondsLeft: 0,
      bettingOpen: false,
      settling: false,
      statusLabel: '加载中',
    };
  }
  const betEnds = guess.starts_at + GUESS_BET_WINDOW_MS;
  const secondsLeft = Math.max(0, Math.ceil((guess.ends_at - nowMs) / 1000));
  const bettingSecondsLeft = Math.max(0, Math.ceil((betEnds - nowMs) / 1000));
  const bettingOpen = guess.status === 'open' && nowMs < betEnds;
  const settling = !!guess.settling || (guess.status !== 'settled' && secondsLeft <= 0);
  let statusLabel = '进行中';
  if (guess.status === 'settled') statusLabel = '已结算';
  else if (settling) statusLabel = '结算中';
  else if (bettingOpen) statusLabel = '押注中';
  else statusLabel = '封盘中';
  return { secondsLeft, bettingSecondsLeft, bettingOpen, settling, statusLabel };
}
