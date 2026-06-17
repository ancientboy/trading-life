"""参数网格搜索"""
import json,math,sys
from pathlib import Path
from collections import defaultdict
sys.path.insert(0, str(Path(__file__).parent))
from harness import (DataLoader, MarketClassifier, MarketRegime,
    AltcoinSignalDetector, NewcoinSignalDetector, calc_ema, calc_atr)

CACHE = Path(__file__).parent / 'data' / 'harness_cache'

def load_cached(symbol, interval='4h'):
    for f in sorted(CACHE.glob(f"{symbol}_{interval}_*.json")):
        try: return json.load(open(f))
        except: pass
    return []

def _vol(closes):
    if len(closes) < 2: return 0
    rets = [(closes[i]-closes[i-1])/closes[i-1] for i in range(1,len(closes)) if closes[i-1]>0]
    if not rets: return 0
    avg = sum(rets)/len(rets)
    var = sum((r-avg)**2 for r in rets)/len(rets)
    return math.sqrt(var)*100

def _sim_exit(entry, direction, sl, klines_after, max_bars=60):
    closes = []
    for i, k in enumerate(klines_after[:max_bars]):
        c,h,l = k['close'],k['high'],k['low']
        closes.append(c)
        if direction=='LONG' and l<=sl: return {'exit_price':sl,'bars_held':i+1,'exit_reason':'stop_loss'}
        if direction=='SHORT' and h>=sl: return {'exit_price':sl,'bars_held':i+1,'exit_reason':'stop_loss'}
        if i>=5 and len(closes)>=20:
            ema20 = calc_ema(closes,20)
            vol = k['volume']
            avg_vol = sum(x['volume'] for x in klines_after[max(0,i-20):i])/min(20,i+1)
            if direction=='LONG' and c<ema20 and vol>avg_vol*1.2:
                return {'exit_price':c,'bars_held':i+1,'exit_reason':'structure_break'}
            if direction=='SHORT' and c>ema20 and vol>avg_vol*1.2:
                return {'exit_price':c,'bars_held':i+1,'exit_reason':'structure_break'}
        if i==max_bars-1: return {'exit_price':c,'bars_held':i+1,'exit_reason':'timeout'}
    return {'exit_price':entry,'bars_held':0,'exit_reason':'no_data'}

def backtest_params(symbols, min_score=50, block_chop=False, block_bear=False,
                    min_interval=5, stop_loss_pct=0.05, leverage=10,
                    block_signals=None, only_regimes=None, vol_limit=0):
    block_signals = block_signals or set()
    only_regimes = only_regimes or set()
    classifier = MarketClassifier()
    alt_det = AltcoinSignalDetector()
    new_det = NewcoinSignalDetector()
    trades = []
    for symbol in symbols:
        klines = load_cached(symbol)
        if len(klines) < 50: continue
        last_entry = -100
        for i in range(30, len(klines)-10):
            if i - last_entry < min_interval: continue
            window = klines[max(0,i-50):i+1]
            regime = classifier.classify(window)
            price = klines[i]['close']
            if only_regimes and regime.value not in only_regimes: continue
            if block_chop and regime == MarketRegime.CHOP: continue
            if block_bear and regime == MarketRegime.BEAR: continue
            signals = []
            signals += alt_det.detect_prelaunch(window, symbol)
            signals += alt_det.detect_breakout(window, symbol)
            signals += new_det.detect(window, symbol)
            for sig in signals:
                if sig['score'] < min_score: continue
                if sig['type'] in block_signals: continue
                direction = sig['direction']
                sl = price*(1-stop_loss_pct) if direction=='LONG' else price*(1+stop_loss_pct)
                if vol_limit > 0:
                    closes_w = [k['close'] for k in window]
                    if len(closes_w)>=20 and _vol(closes_w)>vol_limit: continue
                remaining = klines[i+1:]
                result = _sim_exit(price, direction, sl, remaining)
                pnl_pct = (result['exit_price']-price)/price*100 if direction=='LONG' else (price-result['exit_price'])/price*100
                pos_val = 10000*0.03*leverage
                trades.append({'pnl': pos_val*pnl_pct/100, 'type': sig['type'], 'regime': regime.value})
                last_entry = i
    if not trades: return None
    total = len(trades)
    wins = len([t for t in trades if t['pnl']>0])
    return {'trades':total, 'win_rate':round(wins/total*100,1), 'total_pnl':round(sum(t['pnl'] for t in trades),2)}

def main():
    symbols = set()
    for f in CACHE.glob("*USDT_4h_*.json"):
        sym = f.name.split('_')[0]
        if sym not in ('BTCUSDT','ETHUSDT'): symbols.add(sym)
    symbols = sorted(symbols)
    print(f"测试币种: {len(symbols)}个")
    configs = [
        ('baseline',     {'min_score':50,'leverage':10,'stop_loss_pct':0.05,'min_interval':5}),
        ('score60',      {'min_score':60,'leverage':10,'stop_loss_pct':0.05,'min_interval':5}),
        ('score70',      {'min_score':70,'leverage':10,'stop_loss_pct':0.05,'min_interval':5}),
        ('score80',      {'min_score':80,'leverage':10,'stop_loss_pct':0.05,'min_interval':5}),
        ('no_chop',      {'block_chop':True,'min_score':50,'leverage':10,'stop_loss_pct':0.05}),
        ('bull_bear',    {'only_regimes':{'bull','bear'},'min_score':50,'leverage':10,'stop_loss_pct':0.05}),
        ('sl3',          {'min_score':50,'leverage':10,'stop_loss_pct':0.03,'min_interval':5}),
        ('sl8',          {'min_score':50,'leverage':10,'stop_loss_pct':0.08,'min_interval':5}),
        ('sl10',         {'min_score':50,'leverage':10,'stop_loss_pct':0.10,'min_interval':5}),
        ('no_break',     {'block_signals':{'breakout','short_squeeze'},'min_score':50,'leverage':10,'stop_loss_pct':0.05}),
        ('int10',        {'min_score':50,'leverage':10,'stop_loss_pct':0.05,'min_interval':10}),
        ('int15',        {'min_score':50,'leverage':10,'stop_loss_pct':0.05,'min_interval':15}),
        ('lev5',         {'min_score':50,'leverage':5,'stop_loss_pct':0.05}),
        ('lev15',        {'min_score':50,'leverage':15,'stop_loss_pct':0.05}),
        ('lev20',        {'min_score':50,'leverage':20,'stop_loss_pct':0.05}),
        ('vol5',         {'min_score':50,'leverage':10,'stop_loss_pct':0.05,'vol_limit':5}),
        ('combo1',       {'block_chop':True,'block_signals':{'breakout','short_squeeze'},'min_score':60,'leverage':10,'stop_loss_pct':0.05,'min_interval':10}),
        ('combo2',       {'only_regimes':{'bull','bear'},'block_signals':{'breakout','short_squeeze'},'min_score':60,'leverage':10,'stop_loss_pct':0.05,'min_interval':10}),
        ('combo3',       {'only_regimes':{'bull','bear'},'block_signals':{'breakout','short_squeeze'},'min_score':70,'leverage':10,'stop_loss_pct':0.08,'min_interval':10}),
        ('combo4',       {'only_regimes':{'bull','bear'},'block_signals':{'breakout','short_squeeze','newcoin_bottom'},'min_score':60,'leverage':10,'stop_loss_pct':0.05,'min_interval':10}),
        ('combo5',       {'block_chop':True,'block_signals':{'breakout','short_squeeze','newcoin_bottom'},'min_score':60,'leverage':15,'stop_loss_pct':0.05,'min_interval':10}),
        ('combo6',       {'block_chop':True,'block_signals':{'breakout','short_squeeze'},'min_score':60,'leverage':10,'stop_loss_pct':0.08,'min_interval':10}),
        ('combo7',       {'only_regimes':{'bull'},'block_signals':{'breakout','short_squeeze'},'min_score':60,'leverage':15,'stop_loss_pct':0.05,'min_interval':10}),
    ]
    print(f"\n{'Name':15s} | {'Trades':>6s} | {'WR':>5s} | {'PnL':>12s}")
    print('-' * 55)
    results = []
    for name, cfg in configs:
        r = backtest_params(symbols, **cfg)
        if r:
            e = "🟢" if r['total_pnl']>0 else "🔴"
            print(f"{e} {name:15s} | {r['trades']:6d} | {r['win_rate']:4.1f}% | ${r['total_pnl']:>+10,.0f}")
            results.append({'name':name,**r})
        else:
            print(f"⚪ {name:15s} |    0笔 | 无信号")
    out = Path(__file__).parent / 'data' / 'param_search_180d.json'
    json.dump(results, open(out,'w'), indent=2)

if __name__=='__main__':
    main()
