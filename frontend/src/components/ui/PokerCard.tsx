import { parsePokerCard } from '../../lib/pokerCards';

export function PokerCard({
  card,
  faceDown = false,
  small = false,
}: {
  card?: string;
  faceDown?: boolean;
  small?: boolean;
}) {
  const w = small ? 30 : 38;
  const h = small ? 42 : 52;
  const parsed = card ? parsePokerCard(card) : null;

  if (faceDown || !parsed) {
    return (
      <div style={{
        width: w, height: h, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg,#8b6914,#6b4f10)', border: '1px solid #5a4010',
        fontSize: small ? 16 : 20, color: '#f5efe6', boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
      }}>
        🂠
      </div>
    );
  }

  return (
    <div style={{
      width: w, height: h, borderRadius: 5, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#fffef8',
      border: `1px solid ${parsed.red ? '#e8b4b4' : '#c4b8a8'}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)', lineHeight: 1,
    }}>
      <span style={{ fontSize: small ? 11 : 13, fontWeight: 700, color: parsed.red ? '#c0392b' : '#2a2220' }}>
        {parsed.rank}
      </span>
      <span style={{ fontSize: small ? 14 : 18, color: parsed.red ? '#c0392b' : '#2a2220' }}>
        {parsed.suit}
      </span>
    </div>
  );
}

export function PokerCardRow({ cards, faceDown = false, small = false }: { cards: string[]; faceDown?: boolean; small?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: small ? 4 : 6, justifyContent: 'center', flexWrap: 'wrap' }}>
      {cards.map((c, i) => (
        <PokerCard key={`${c}-${i}`} card={c} faceDown={faceDown} small={small} />
      ))}
    </div>
  );
}
