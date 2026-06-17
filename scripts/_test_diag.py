import json, sys
sys.path.insert(0, '.')
from sentiment_data import collect_sentiment

for sym in ['SPKUSDT', 'MOVRUSDT', 'KATUSDT', 'BTCUSDT']:
    sent = collect_sentiment(sym)
    print(f'\n=== {sym} ===')
    print(f'  composite: {sent["composite_score"]} ({sent["sentiment_label"]})')
    for k, v in sent["scores"].items():
        w = sent["weights"].get(k, 0)
        print(f'  {k:15s}: score={v:>6.1f}  weight={w:.0%}  contrib={v*w:>6.1f}')
    print(f'  reasons: {sent["reasons"]}')
