"""下载XAUUSDT 1m K线数据"""
import asyncio, aiohttp, json, os
from datetime import datetime, timezone, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

async def fetch_klines(days=7):
    """批量下载1m K线"""
    url = "https://fapi.binance.com/fapi/v1/klines"
    all_data = []
    end_time = None
    target = days * 24 * 60

    while len(all_data) < target:
        params = {"symbol": "XAUUSDT", "interval": "1m", "limit": 1500}
        if end_time:
            params["endTime"] = end_time - 1

        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                data = await resp.json()
                if not isinstance(data, list) or len(data) == 0:
                    break
                all_data = data + all_data
                end_time = data[0][0]
                print(f"  已下载 {len(all_data)}/{target} 条", end="\r")

    candles = []
    for k in all_data:
        candles.append({
            "t": k[0], "o": float(k[1]), "h": float(k[2]),
            "l": float(k[3]), "c": float(k[4]), "v": float(k[5])
        })

    out = DATA_DIR / "xauusdt_1m.json"
    json.dump(candles, open(out, "w"))

    first = datetime.fromtimestamp(candles[0]["t"]/1000, tz=timezone(timedelta(hours=8)))
    last = datetime.fromtimestamp(candles[-1]["t"]/1000, tz=timezone(timedelta(hours=8)))
    print(f"\n✅ 保存 {len(candles)} 条 1m K线到 {out}")
    print(f"   时间范围: {first} ~ {last}")
    return candles

if __name__ == "__main__":
    asyncio.run(fetch_klines(7))
