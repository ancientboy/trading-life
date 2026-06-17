#!/usr/bin/env python3
"""
选币波浪验证工具 — 验证被选中的币是否真的符合底部突破形态

用法:
  python3 scripts/verify_wave_selection.py              # 验证当前所有在看的币
  python3 scripts/verify_wave_selection.py BTCUSDT      # 验证单个币
  python3 scripts/verify_wave_selection.py --html       # 生成HTML可视化报告

输出:
  - 每个币的底部形态详情（Swing Low位置、颈线价、置信度、深度）
  - 当前波浪阶段（一浪/二浪/三浪）
  - 是否真的符合"底部突破"的条件
"""

import sys
import os
import json
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from wave_pattern import (
    find_swings, detect_bottom_pattern, detect_wave_position,
    BottomPattern, TopPattern
)


async def fetch_klines(symbol: str, interval: str = "1h", limit: int = 600):
    """获取K线"""
    import aiohttp
    url = f"https://fapi.binance.com/fapi/v1/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
                if not isinstance(data, list):
                    return []
                return [{
                    "open": float(k[1]), "high": float(k[2]),
                    "low": float(k[3]), "close": float(k[4]),
                    "volume": float(k[5]),
                } for k in data]
    except Exception as e:
        print(f"  ❌ 获取{symbol} {interval}失败: {e}")
        return []


def fmt_price(p: float) -> str:
    if p >= 1000: return f"${p:,.1f}"
    if p >= 1: return f"${p:.2f}"
    if p >= 0.01: return f"${p:.4f}"
    return f"${p:.6f}"


def verify_symbol(symbol: str, klines_4h: list, klines_1h: list, klines_15m: list):
    """验证单个币的底部形态"""
    result = {
        "symbol": symbol,
        "current_price": klines_4h[-1]["close"] if klines_4h else 0,
        "4h": None,
        "1h": None,
        "wave_4h": None,
        "wave_1h": None,
        "verdict": "",
    }

    # === 4h 底部形态 ===
    if len(klines_4h) >= 30:
        bottom_4h = detect_bottom_pattern(klines_4h)
        if bottom_4h:
            pt_cn = {"double_bottom": "双底", "head_shoulders_bottom": "头肩底", "multiple_bottom": "多重底"}
            lows_str = " | ".join(f"[{l.index}] {fmt_price(l.price)}" for l in bottom_4h.lows)
            result["4h"] = {
                "type": pt_cn.get(bottom_4h.pattern_type, bottom_4h.pattern_type),
                "type_raw": bottom_4h.pattern_type,
                "neckline": bottom_4h.neckline,
                "depth_pct": bottom_4h.depth_pct,
                "confidence": bottom_4h.confidence,
                "lows_count": len(bottom_4h.lows),
                "lows": [{"index": l.index, "price": l.price} for l in bottom_4h.lows],
                "lows_str": lows_str,
            }
            # 波浪定位
            wave_4h = detect_wave_position(klines_4h, bottom_4h)
            if wave_4h:
                result["wave_4h"] = {
                    "wave": wave_4h.get("wave", 0),
                    "signal": wave_4h.get("signal", ""),
                    "pullback_pct": wave_4h.get("pullback_pct", 0),
                }

    # === 1h 底部形态 ===
    if len(klines_1h) >= 30:
        bottom_1h = detect_bottom_pattern(klines_1h)
        if bottom_1h:
            pt_cn = {"double_bottom": "双底", "head_shoulders_bottom": "头肩底", "multiple_bottom": "多重底"}
            lows_str = " | ".join(f"[{l.index}] {fmt_price(l.price)}" for l in bottom_1h.lows)
            result["1h"] = {
                "type": pt_cn.get(bottom_1h.pattern_type, bottom_1h.pattern_type),
                "type_raw": bottom_1h.pattern_type,
                "neckline": bottom_1h.neckline,
                "depth_pct": bottom_1h.depth_pct,
                "confidence": bottom_1h.confidence,
                "lows_count": len(bottom_1h.lows),
                "lows": [{"index": l.index, "price": l.price} for l in bottom_1h.lows],
                "lows_str": lows_str,
            }
            wave_1h = detect_wave_position(klines_1h, bottom_1h)
            if wave_1h:
                result["wave_1h"] = {
                    "wave": wave_1h.get("wave", 0),
                    "signal": wave_1h.get("signal", ""),
                    "pullback_pct": wave_1h.get("pullback_pct", 0),
                }

    # === 判定是否真的符合底部突破 ===
    issues = []
    positives = []

    if not result["4h"] and not result["1h"]:
        result["verdict"] = "❌ 无底部形态"
        return result

    # 检查4h形态质量
    if result["4h"]:
        b = result["4h"]
        if b["type_raw"] == "multiple_bottom":
            # 多重底需要验证：低点是不是真的相近？颈线是不是真的在上方？
            prices = [l["price"] for l in b["lows"]]
            if prices:
                max_p, min_p = max(prices), min(prices)
                spread_pct = (max_p - min_p) / min_p * 100
                if spread_pct > 5:
                    issues.append(f"⚠️ 多重底低点分散{spread_pct:.1f}% (>5%)，可能不是真正的底部形态")
                else:
                    positives.append(f"✅ 低点集中度{spread_pct:.1f}% (<5%)")
                
                # 颈线必须高于所有低点至少3%
                if b["neckline"] > 0 and min_p > 0:
                    above_pct = (b["neckline"] - min_p) / min_p * 100
                    if above_pct < 3:
                        issues.append(f"⚠️ 颈线只比低点高{above_pct:.1f}% (<3%)，形态太浅")
                    else:
                        positives.append(f"✅ 颈线高于低点{above_pct:.1f}%")

        if b["confidence"] < 0.6:
            issues.append(f"⚠️ 置信度{b['confidence']:.0%}偏低(<60%)")
        else:
            positives.append(f"✅ 置信度{b['confidence']:.0%}")

        if b["depth_pct"] < 5:
            issues.append(f"⚠️ 深度{b['depth_pct']:.1f}%太浅(<5%)，可能是横盘不是底部")
        else:
            positives.append(f"✅ 深度{b['depth_pct']:.1f}%")

        # 当前价格 vs 颈线
        if result["current_price"] > 0 and b["neckline"] > 0:
            price_vs_neck = (result["current_price"] - b["neckline"]) / b["neckline"] * 100
            if price_vs_neck < -2:
                issues.append(f"⚠️ 价格在颈线下方{abs(price_vs_neck):.1f}%，还没突破")
            elif price_vs_neck < 2:
                positives.append(f"✅ 价格在颈线附近({price_vs_neck:+.1f}%)，即将突破")
            else:
                positives.append(f"✅ 价格已突破颈线{price_vs_neck:.1f}%")

    # 波浪阶段
    if result.get("wave_4h"):
        w = result["wave_4h"]
        wave_num = w.get("wave", 0)
        signal = w.get("signal", "")
        if wave_num == 1:
            positives.append(f"✅ 4h一浪突破中")
        elif signal == "wave2_buy_zone":
            positives.append(f"✅ 4h二浪回调到位(Fib{w.get('pullback_pct', 0):.0f}%)")
        elif signal == "wave3_starting":
            positives.append(f"✅ 4h三浪启动中")
        elif wave_num == 0:
            issues.append(f"⚠️ 4h还在底部形态中，未突破颈线")

    result["issues"] = issues
    result["positives"] = positives

    if issues and not positives:
        result["verdict"] = "❌ 不符合底部突破"
    elif len(issues) > len(positives):
        result["verdict"] = "⚠️ 形态质量存疑"
    elif positives:
        result["verdict"] = "✅ 符合底部突破"

    return result


async def main():
    # 默认验证的币种列表
    symbols = sys.argv[1:] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else [
        "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
        "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
        "XAUUSDT", "XAGUSDT", "TRXUSDT",
    ]

    print(f"{'='*60}")
    print(f"🔍 选币波浪验证 — 检查{len(symbols)}个币种")
    print(f"{'='*60}\n")

    for sym in symbols:
        print(f"\n{'─'*50}")
        print(f"📊 {sym}")
        print(f"{'─'*50}")

        # 获取K线
        klines_4h = await fetch_klines(sym, "4h", 120)
        klines_1h = await fetch_klines(sym, "1h", 120)
        klines_15m = await fetch_klines(sym, "15m", 50)

        if not klines_4h:
            print(f"  ❌ 无法获取K线数据")
            continue

        current_price = klines_4h[-1]["close"]
        print(f"  当前价格: {fmt_price(current_price)}")

        result = verify_symbol(sym, klines_4h, klines_1h, klines_15m)

        # 输出4h形态
        if result["4h"]:
            b = result["4h"]
            print(f"\n  📐 4h底部形态: {b['type']}")
            print(f"     颈线: {fmt_price(b['neckline'])}")
            print(f"     深度: {b['depth_pct']:.1f}%")
            print(f"     置信度: {b['confidence']:.0%}")
            print(f"     低点({b['lows_count']}个): {b['lows_str']}")
        else:
            print(f"\n  📐 4h: 无底部形态")

        # 输出1h形态
        if result["1h"]:
            b = result["1h"]
            print(f"\n  📐 1h底部形态: {b['type']}")
            print(f"     颈线: {fmt_price(b['neckline'])}")
            print(f"     深度: {b['depth_pct']:.1f}%")
            print(f"     置信度: {b['confidence']:.0%}")
            print(f"     低点({b['lows_count']}个): {b['lows_str']}")
        else:
            print(f"\n  📐 1h: 无底部形态")

        # 波浪阶段
        if result.get("wave_4h"):
            w = result["wave_4h"]
            print(f"\n  🌊 4h波浪: 第{w['wave']}浪 | 信号={w['signal']} | 回调{w.get('pullback_pct', 0):.0f}%")
        if result.get("wave_1h"):
            w = result["wave_1h"]
            print(f"  🌊 1h波浪: 第{w['wave']}浪 | 信号={w['signal']} | 回调{w.get('pullback_pct', 0):.0f}%")

        # 验证结果
        print(f"\n  判定: {result['verdict']}")
        for p in result.get("positives", []):
            print(f"    {p}")
        for i in result.get("issues", []):
            print(f"    {i}")


if __name__ == "__main__":
    asyncio.run(main())
