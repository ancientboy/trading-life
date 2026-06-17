"""
小风交易系统 - 链上鲸鱼追踪器

免费多链方案：
1. BTC 大额转账 - Blockstream API + BlockCypher
2. ETH 大额转账 - BlockCypher
3. 多链 DEX 大额 Swap - DexScreener API
4. SOL 大额转账 - Solana 公共 RPC
5. 价格参考 - CoinGecko（计算 USD 价值）

数据推送到 Redis Stream: stream:onchain:whale
"""
import json
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from collections import defaultdict

import aiohttp

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("WhaleTracker")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR, REDIS_URL, CORE_SYMBOLS

# Redis
try:
    import redis
    redis_client = redis.from_url(REDIS_URL)
    redis_client.ping()
    USE_REDIS = True
    logger.info("✅ Redis 连接成功")
except Exception:
    USE_REDIS = False

# ============================================
# 阈值配置
# ============================================
# 大额转账阈值（USD）
WHALE_THRESHOLDS = {
    "BTC": 500_000,       # >50万 USD
    "ETH": 200_000,       # >20万 USD
    "SOL": 100_000,       # >10万 USD
    "BNB": 100_000,
    "DEFAULT": 100_000,
}

# DEX 大额 Swap 阈值
DEX_SWAP_THRESHOLD_USD = 100_000  # >10万 USD

# 监控的 DEX 链
DEX_CHAINS = ["ethereum", "bsc", "solana", "avalanche", "arbitrum", "base"]

# 已知鲸鱼/机构地址标签（逐步扩充）
KNOWN_WHALES = {
    # BTC
    "bc1ql0vvy9gkn6tzp6er9k2z5c5r2qjq50x56zl74u": "Unknown Whale A",
    # ETH - 知名机构/交易所
    "0x28c6c06298d514db089934071355e5743bf21d60": "Binance Hot Wallet",
    "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be": "Binance Cold Wallet",
    "0x56eddb7aa87536c09cc273e49c1dc8f6a66e09a5": "Kraken",
    "0x5a5a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a": "Placeholder",
}

# ============================================
# 价格缓存
# ============================================
price_cache: Dict[str, float] = {
    "BTC": 76000, "ETH": 2300, "SOL": 85, "BNB": 630,
    "XRP": 2.1, "DOGE": 0.17, "ADA": 0.65, "AVAX": 25,
}
price_last_update = 0


async def update_prices(session: aiohttp.ClientSession):
    """从 CoinGecko 更新价格"""
    global price_cache, price_last_update
    try:
        url = "https://api.coingecko.com/api/v3/simple/price"
        params = {
            "ids": "bitcoin,ethereum,solana,binancecoin,ripple,dogecoin,cardano,avalanche-2",
            "vs_currencies": "usd"
        }
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 200:
                data = await resp.json()
                mapping = {
                    "bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL",
                    "binancecoin": "BNB", "ripple": "XRP", "dogecoin": "DOGE",
                    "cardano": "ADA", "avalanche-2": "AVAX",
                }
                for geo_id, symbol in mapping.items():
                    if geo_id in data:
                        price_cache[symbol] = data[geo_id]["usd"]
                price_last_update = time.time()
                logger.debug(f"价格已更新: BTC=${price_cache['BTC']:,.0f}")
    except Exception as e:
        logger.warning(f"价格更新失败: {e}")


def get_threshold_usd(symbol: str) -> float:
    return WHALE_THRESHOLDS.get(symbol, WHALE_THRESHOLDS["DEFAULT"])


# ============================================
# 推送数据
# ============================================
def push_whale(record: dict):
    """推送鲸鱼事件到 Redis Stream"""
    payload = {k: str(v) for k, v in record.items()}
    if USE_REDIS:
        try:
            redis_client.xadd("stream:onchain:whale", payload, maxlen=5000)
        except Exception as e:
            _save_to_file(record)
    else:
        _save_to_file(record)


def _save_to_file(record: dict):
    date_str = datetime.now().strftime("%Y-%m-%d")
    filepath = DATA_DIR / f"whale-{date_str}.jsonl"
    with open(filepath, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ============================================
# 1. BTC 大额转账监控 (Blockstream)
# ============================================
async def track_btc_whales(session: aiohttp.ClientSession, interval: int = 30):
    """
    每 interval 秒扫描最新 BTC 区块中的大额转账
    """
    logger.info(f"🐋 BTC 鲸鱼追踪启动 (阈值: ${get_threshold_usd('BTC'):,.0f})")
    last_height = 0

    while True:
        try:
            # 获取最新区块高度
            async with session.get(
                "https://blockstream.info/api/blocks/tip/height",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                current_height = int(await resp.text())

            if current_height <= last_height:
                await asyncio.sleep(interval)
                continue

            # 扫描新区块（最多3个）
            for h in range(max(last_height + 1, current_height - 2), current_height + 1):
                # 获取区块hash
                async with session.get(
                    f"https://blockstream.info/api/block-height/{h}",
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    block_hash = await resp.text()

                # 获取区块交易（第一页，最多25笔）
                async with session.get(
                    f"https://blockstream.info/api/block/{block_hash}/txs/0",
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    txs = await resp.json()

                btc_price = price_cache.get("BTC", 76000)

                for tx in txs:
                    # 计算输出总额
                    outputs = tx.get("vout", [])
                    total_btc = sum(float(v.get("value", 0)) for v in outputs) / 1e8
                    total_usd = total_btc * btc_price

                    threshold = get_threshold_usd("BTC")
                    if total_usd >= threshold:
                        txid = tx.get("txid", "")
                        # 获取输入地址（发送方）
                        inputs = tx.get("vin", [])
                        from_addr = ""
                        for vin in inputs[:1]:
                            prevout = vin.get("prevout", {})
                            if prevout:
                                from_addr = prevout.get("scriptpubkey_address", "")

                        # 获取输出地址（接收方）
                        to_addrs = []
                        for vout in outputs[:3]:  # 最多3个
                            addr = vout.get("scriptpubkey_address", "")
                            if addr:
                                to_addrs.append(addr)

                        record = {
                            "type": "whale_transfer",
                            "chain": "BTC",
                            "block": h,
                            "txid": txid[:32],
                            "from": from_addr[:32] if from_addr else "unknown",
                            "to": ",".join(to_addrs[:2]),
                            "amount": f"{total_btc:.4f}",
                            "amount_usd": f"{total_usd:,.0f}",
                            "label": KNOWN_WHALES.get(from_addr, "unknown"),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        push_whale(record)
                        logger.info(
                            f"🐋 BTC 大额转账: {total_btc:.4f} BTC (${total_usd:,.0f}) "
                            f"block={h} tx={txid[:16]}..."
                        )

            last_height = current_height

        except Exception as e:
            logger.error(f"❌ BTC 追踪错误: {e}")

        await asyncio.sleep(interval)


# ============================================
# 2. ETH 大额转账监控 (BlockCypher)
# ============================================
async def track_eth_whales(session: aiohttp.ClientSession, interval: int = 20):
    """
    通过 BlockCypher 监控 ETH 大额转账
    """
    logger.info(f"🐋 ETH 鲸鱼追踪启动 (阈值: ${get_threshold_usd('ETH'):,.0f})")
    seen_txs = set()

    while True:
        try:
            async with session.get(
                "https://api.blockcypher.com/v1/eth/main/txs?limit=20",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status != 200:
                    await asyncio.sleep(interval)
                    continue

                txs = await resp.json()
                eth_price = price_cache.get("ETH", 2300)

                for tx in txs:
                    tx_hash = tx.get("hash", "")
                    if tx_hash in seen_txs:
                        continue

                    total_eth = float(tx.get("total", 0)) / 1e18
                    total_usd = total_eth * eth_price

                    if total_usd >= get_threshold_usd("ETH"):
                        seen_txs.add(tx_hash)
                        # 限制内存
                        if len(seen_txs) > 500:
                            seen_txs = set(list(seen_txs)[-200:])

                        from_addr = tx.get("inputs", [{}])[0].get("addresses", ["unknown"])[0] if tx.get("inputs") else "unknown"
                        to_addr = tx.get("outputs", [{}])[0].get("addresses", ["unknown"])[0] if tx.get("outputs") else "unknown"

                        record = {
                            "type": "whale_transfer",
                            "chain": "ETH",
                            "txid": tx_hash[:32],
                            "from": from_addr[:32],
                            "to": to_addr[:32],
                            "amount": f"{total_eth:.4f}",
                            "amount_usd": f"{total_usd:,.0f}",
                            "gas_used": str(tx.get("gas_used", "")),
                            "label": KNOWN_WHALES.get(from_addr, "unknown"),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        push_whale(record)
                        logger.info(
                            f"🐋 ETH 大额转账: {total_eth:.4f} ETH (${total_usd:,.0f})"
                        )

        except Exception as e:
            logger.error(f"❌ ETH 追踪错误: {e}")

        await asyncio.sleep(interval)


# ============================================
# 3. 多链 DEX 大额 Swap (DexScreener)
# ============================================
async def track_dex_whales(session: aiohttp.ClientSession, interval: int = 30):
    """
    通过 DexScreener 追踪多链 DEX 大额交易
    覆盖: ETH / BSC / SOL / AVAX / Arbitrum / Base
    """
    logger.info(f"🐋 DEX 大额 Swap 追踪启动 (阈值: ${DEX_SWAP_THRESHOLD_USD:,.0f})")

    # 搜索热门交易对
    search_queries = [
        "WETH/USDC", "WETH/USDT",   # ETH DEX
        "WBNB/USDT", "WBNB/BUSD",   # BSC DEX
        "SOL/USDC", "SOL/USDT",      # SOL DEX
        "WAVAX/USDC",                 # AVAX DEX
        "WBTC/USDC", "WBTC/USDT",    # BTC wrapped
    ]

    seen_pairs = {}  # pairAddress -> last_volume (检测突增)

    while True:
        try:
            for query in search_queries:
                async with session.get(
                    f"https://api.dexscreener.com/latest/dex/search?q={query}",
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status != 200:
                        continue

                    data = await resp.json()
                    pairs = data.get("pairs", [])

                    for pair in pairs[:5]:
                        chain = pair.get("chainId", "")
                        if chain not in DEX_CHAINS:
                            continue

                        pair_addr = pair.get("pairAddress", "")
                        base = pair.get("baseToken", {}).get("symbol", "")
                        quote = pair.get("quoteToken", {}).get("symbol", "")
                        dex = pair.get("dexId", "")
                        vol_24h = float(pair.get("volume", {}).get("h24", 0))
                        price_usd = float(pair.get("priceUsd", 0)) if pair.get("priceUsd") else 0

                        # 检测大额交易（通过 txns 数据估算平均交易大小）
                        txns = pair.get("txns", {}).get("h24", {})
                        buys = int(txns.get("buys", 0)) if isinstance(txns, dict) else 0
                        sells = int(txns.get("sells", 0)) if isinstance(txns, dict) else 0
                        total_txns = buys + sells

                        if vol_24h <= 0 or total_txns <= 0:
                            continue

                        avg_tx_size = vol_24h / total_txns

                        # 检测交易量突增（当前 vs 历史）
                        prev_vol = seen_pairs.get(pair_addr, 0)
                        volume_change = 0
                        if prev_vol > 0:
                            volume_change = (vol_24h - prev_vol) / prev_vol
                        seen_pairs[pair_addr] = vol_24h

                        # 触发条件：24h量 > 100万 OR 量突增 > 200%
                        if vol_24h >= 1_000_000 or volume_change >= 2.0:
                            record = {
                                "type": "dex_large_volume",
                                "chain": chain,
                                "dex": dex,
                                "pair": f"{base}/{quote}",
                                "pair_addr": pair_addr[:24],
                                "price_usd": f"{price_usd:.6f}",
                                "volume_24h": f"{vol_24h:,.0f}",
                                "volume_change_pct": f"{volume_change*100:.1f}",
                                "txns_24h": str(total_txns),
                                "buys_24h": str(buys),
                                "sells_24h": str(sells),
                                "avg_tx_size_usd": f"{avg_tx_size:,.0f}",
                                "alert": "VOLUME_SPIKE" if volume_change >= 2.0 else "HIGH_VOLUME",
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                            push_whale(record)

                            alert_emoji = "🔥" if volume_change >= 2.0 else "📊"
                            logger.info(
                                f"{alert_emoji} DEX {chain}/{dex} {base}/{quote}: "
                                f"Vol ${vol_24h/1e6:.1f}M | "
                                f"Txns {total_txns} | "
                                f"Avg ${avg_tx_size:,.0f}"
                                + (f" | 突增 {volume_change*100:.0f}%" if volume_change >= 2.0 else "")
                            )

                # DexScreener 限速：每请求间隔 1s
                await asyncio.sleep(1)

        except Exception as e:
            logger.error(f"❌ DEX 追踪错误: {e}")

        await asyncio.sleep(interval)


# ============================================
# 4. SOL 大额转账 (公共 RPC)
# ============================================
async def track_sol_whales(session: aiohttp.ClientSession, interval: int = 20):
    """
    通过 Solana 公共 RPC 监控大额 SOL 转账
    """
    logger.info(f"🐋 SOL 鲸鱼追踪启动 (阈值: ${get_threshold_usd('SOL'):,.0f})")
    sol_rpc = "https://api.mainnet-beta.solana.com"

    while True:
        try:
            sol_price = price_cache.get("SOL", 85)
            threshold_sol = get_threshold_usd("SOL") / sol_price

            # 获取最近的区块签名
            payload = {
                "jsonrpc": "2.0", "id": 1,
                "method": "getLatestBlockhash",
                "params": [{"commitment": "finalized"}]
            }
            async with session.post(
                sol_rpc, json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                data = await resp.json()
                slot = data.get("result", {}).get("context", {}).get("slot", 0)

            # 获取区块中的交易
            payload = {
                "jsonrpc": "2.0", "id": 1,
                "method": "getBlock",
                "params": [
                    slot,
                    {
                        "encoding": "json",
                        "maxSupportedTransactionVersion": 0,
                        "transactionDetails": "signatures",
                    }
                ]
            }
            async with session.post(
                sol_rpc, json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                data = await resp.json()
                block = data.get("result", {})
                signatures = block.get("signatures", [])

            logger.debug(f"SOL slot {slot}: {len(signatures)} txs")

            # 采样检查大额交易（最多检查10笔）
            for sig in signatures[:10]:
                payload = {
                    "jsonrpc": "2.0", "id": 1,
                    "method": "getTransaction",
                    "params": [
                        sig,
                        {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}
                    ]
                }
                try:
                    async with session.post(
                        sol_rpc, json=payload,
                        timeout=aiohttp.ClientTimeout(total=5)
                    ) as resp:
                        tx_data = await resp.json()
                        tx = tx_data.get("result")
                        if not tx:
                            continue

                        # 检查 SOL 转账（native transfer）
                        meta = tx.get("meta", {})
                        if meta.get("err"):
                            continue  # 跳过失败交易

                        pre_balances = meta.get("preBalances", [])
                        post_balances = meta.get("postBalances", [])

                        for i in range(len(pre_balances)):
                            diff_lamport = post_balances[i] - pre_balances[i]
                            diff_sol = diff_lamport / 1e9

                            if abs(diff_sol) >= threshold_sol:
                                account_keys = tx.get("transaction", {}).get("message", {}).get("accountKeys", [])
                                from_addr = account_keys[0].get("pubkey", "?") if account_keys else "?"
                                to_addr = account_keys[i].get("pubkey", "?") if i < len(account_keys) else "?"

                                usd_val = abs(diff_sol) * sol_price
                                record = {
                                    "type": "whale_transfer",
                                    "chain": "SOL",
                                    "slot": str(slot),
                                    "signature": sig[:32],
                                    "from": from_addr[:32],
                                    "to": to_addr[:32],
                                    "amount": f"{abs(diff_sol):.2f}",
                                    "amount_usd": f"{usd_val:,.0f}",
                                    "direction": "IN" if diff_sol > 0 else "OUT",
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                }
                                push_whale(record)
                                logger.info(
                                    f"🐋 SOL 大额: {abs(diff_sol):.2f} SOL (${usd_val:,.0f})"
                                )
                except Exception:
                    continue  # 跳过单笔查询错误

        except Exception as e:
            logger.error(f"❌ SOL 追踪错误: {e}")

        await asyncio.sleep(interval)


# ============================================
# 5. 交易所流向监控（基于链上数据的净流入/流出估算）
# ============================================
exchange_flows: Dict[str, Dict[str, float]] = defaultdict(lambda: {"inflow": 0, "outflow": 0})


async def estimate_exchange_flows(session: aiohttp.ClientSession, interval: int = 300):
    """
    定期汇总交易所流入/流出数据
    通过监控 BlockCypher 最近交易到已知交易所地址来估算
    """
    logger.info("📊 交易所流向监控启动")

    while True:
        try:
            # 从 Redis 读取最近的鲸鱼事件
            if USE_REDIS:
                entries = redis_client.xrange("stream:onchain:whale", count=100)
                flow_summary = {}

                for _, data in entries:
                    raw = {k.decode(): v.decode() for k, v in data.items()}
                    chain = raw.get("chain", "unknown")

                    # 检查是否涉及已知交易所地址
                    for addr_field in ["from", "to"]:
                        addr = raw.get(addr_field, "")
                        label = KNOWN_WHALES.get(addr, "")
                        if label and "exchange" in label.lower() or "binance" in label.lower() or "kraken" in label.lower():
                            if chain not in flow_summary:
                                flow_summary[chain] = {"inflow": 0, "outflow": 0}
                            usd = float(raw.get("amount_usd", "0").replace(",", ""))
                            if addr_field == "to":
                                flow_summary[chain]["inflow"] += usd
                            else:
                                flow_summary[chain]["outflow"] += usd

                if flow_summary:
                    for chain, flows in flow_summary.items():
                        net = flows["outflow"] - flows["inflow"]
                        direction = "🔴 流入交易所" if net < 0 else "🟢 流出交易所（看涨信号）"
                        record = {
                            "type": "exchange_flow",
                            "chain": chain,
                            "inflow_usd": f"{flows['inflow']:,.0f}",
                            "outflow_usd": f"{flows['outflow']:,.0f}",
                            "net_flow_usd": f"{net:,.0f}",
                            "signal": direction,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        push_whale(record)
                        logger.info(f"📊 {chain} 交易所流向: {direction} | 净 ${net:,.0f}")

        except Exception as e:
            logger.error(f"❌ 流向计算错误: {e}")

        await asyncio.sleep(interval)


# ============================================
# 主启动器
# ============================================
async def main():
    logger.info("🌀 小风交易系统 - 链上鲸鱼追踪器启动")
    logger.info(f"🐋 监控链: BTC / ETH / SOL + 多链DEX")

    async with aiohttp.ClientSession() as session:
        # 先更新价格
        await update_prices(session)

        # 并行运行所有追踪任务
        await asyncio.gather(
            update_prices_loop(session),            # 价格更新
            track_btc_whales(session, interval=30), # BTC 30s/轮
            track_eth_whales(session, interval=20), # ETH 20s/轮
            track_dex_whales(session, interval=30), # DEX 30s/轮
            track_sol_whales(session, interval=30), # SOL 30s/轮
            estimate_exchange_flows(session, interval=300), # 流向 5min/轮
        )


async def update_prices_loop(session: aiohttp.ClientSession):
    """定期更新价格"""
    while True:
        await update_prices(session)
        await asyncio.sleep(60)  # 每分钟更新


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("👋 鲸鱼追踪器已停止")
