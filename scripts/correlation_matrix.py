"""
关联矩阵模块 - 动态计算币种间相关系数

功能：
1. 滚动30天4h收益率相关系数矩阵
2. Beta值（相对BTC弹性）
3. 入场过滤（避坑+找联动）
4. 持仓分散度检查
5. 领先-滞后关系检测

数据来源：Binance Futures API（免费）
更新频率：每小时
"""

import json
import logging
import asyncio
import aiohttp
import time
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import sys
sys.path.insert(0, str(Path(__file__).parent))
from config import DATA_DIR

logger = logging.getLogger("CorrelationMatrix")

MATRIX_FILE = DATA_DIR / "correlation_matrix.json"


def pearson_corr(x: list, y: list) -> float:
    """Pearson相关系数"""
    n = len(x)
    if n < 10:
        return 0.0
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    
    cov = sum((x[i] - mean_x) * (y[i] - mean_y) for i in range(n)) / n
    std_x = (sum((xi - mean_x) ** 2 for xi in x) / n) ** 0.5
    std_y = (sum((yi - mean_y) ** 2 for yi in y) / n) ** 0.5
    
    if std_x == 0 or std_y == 0:
        return 0.0
    return cov / (std_x * std_y)


def calc_beta(coin_returns: list, btc_returns: list) -> float:
    """计算Beta值（相对BTC弹性）"""
    n = min(len(coin_returns), len(btc_returns))
    if n < 10:
        return 1.0
    
    cov = sum((coin_returns[i] - sum(coin_returns[:n])/n) * 
              (btc_returns[i] - sum(btc_returns[:n])/n) for i in range(n)) / n
    var_btc = sum((btc_returns[i] - sum(btc_returns[:n])/n) ** 2 for i in range(n)) / n
    
    if var_btc == 0:
        return 1.0
    return cov / var_btc


class CorrelationMatrix:
    def __init__(self):
        self.matrix: Dict[str, Dict[str, float]] = {}
        self.betas: Dict[str, float] = {}
        self.returns: Dict[str, list] = {}
        self.last_update: float = 0
        self.update_interval = 3600  # 1小时更新一次
        self.symbols: List[str] = []
    
    def _load(self):
        if MATRIX_FILE.exists():
            try:
                d = json.loads(MATRIX_FILE.read_text())
                self.matrix = d.get("matrix", {})
                self.betas = d.get("betas", {})
                self.last_update = d.get("last_update", 0)
                self.symbols = d.get("symbols", [])
                logger.info(f"加载关联矩阵: {len(self.symbols)}个币种")
            except:
                pass
    
    def _save(self):
        d = {
            "matrix": self.matrix,
            "betas": self.betas,
            "symbols": self.symbols,
            "last_update": self.last_update,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        MATRIX_FILE.write_text(json.dumps(d, ensure_ascii=False, indent=2))
    
    async def update(self, session: aiohttp.ClientSession):
        """更新关联矩阵"""
        if time.time() - self.last_update < self.update_interval:
            return
        
        logger.info("🔄 开始更新关联矩阵...")
        
        # 1. 获取活跃合约列表
        try:
            async with session.get(
                "https://fapi.binance.com/fapi/v1/ticker/24hr",
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                tickers = await resp.json()
            
            # 取成交额Top 50
            candidates = [
                t["symbol"] for t in sorted(
                    tickers,
                    key=lambda t: float(t.get("quoteVolume", 0)),
                    reverse=True
                )
                if t["symbol"].endswith("USDT")
            ][:50]
        except Exception as e:
            logger.warning(f"获取合约列表失败: {e}")
            return
        
        # 2. 获取每个币的4h K线（30天=180根4h）
        returns_data = {}
        for sym in candidates:
            try:
                url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=4h&limit=180"
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    raw = await resp.json()
                
                closes = [float(k[4]) for k in raw]
                if len(closes) < 30:
                    continue
                
                # 计算对数收益率
                rets = []
                for i in range(1, len(closes)):
                    if closes[i-1] > 0:
                        rets.append((closes[i] / closes[i-1] - 1) * 100)
                
                if len(rets) >= 30:
                    returns_data[sym] = rets[-120:]  # 取最近120根
            except:
                pass
            await asyncio.sleep(0.1)
        
        if len(returns_data) < 5:
            logger.warning("数据不足，跳过更新")
            return
        
        self.symbols = list(returns_data.keys())
        self.returns = returns_data
        
        # 3. 计算相关系数矩阵
        btc_rets = returns_data.get("BTCUSDT", [])
        self.matrix = {}
        self.betas = {}
        
        for sym_a in self.symbols:
            self.matrix[sym_a] = {}
            rets_a = returns_data[sym_a]
            
            for sym_b in self.symbols:
                min_len = min(len(rets_a), len(returns_data[sym_b]))
                if min_len < 20:
                    self.matrix[sym_a][sym_b] = 0.0
                    continue
                self.matrix[sym_a][sym_b] = round(
                    pearson_corr(rets_a[:min_len], returns_data[sym_b][:min_len]), 3
                )
            
            # Beta值
            if btc_rets and sym_a != "BTCUSDT":
                min_len = min(len(rets_a), len(btc_rets))
                if min_len >= 20:
                    self.betas[sym_a] = round(calc_beta(rets_a[:min_len], btc_rets[:min_len]), 2)
                else:
                    self.betas[sym_a] = 1.0
            elif sym_a == "BTCUSDT":
                self.betas[sym_a] = 1.0
        
        self.last_update = time.time()
        self._save()
        
        # 4. 输出摘要
        self._print_summary()
    
    def _print_summary(self):
        """打印矩阵摘要"""
        # 跟BTC相关度最低的10个（最独立）
        btc_corr = []
        for sym in self.symbols:
            if sym == "BTCUSDT":
                continue
            c = self.get_correlation(sym, "BTCUSDT")
            btc_corr.append((sym, c))
        btc_corr.sort(key=lambda x: abs(x[1]))
        
        logger.info("📊 关联矩阵更新完成:")
        logger.info(f"  覆盖: {len(self.symbols)}个币种")
        logger.info(f"  最独立于BTC(低相关): {', '.join(f'{s}({c:+.2f})' for s,c in btc_corr[:5])}")
        logger.info(f"  最跟随BTC(高相关): {', '.join(f'{s}({c:+.2f})' for s,c in sorted(btc_corr, key=lambda x: -abs(x[1]))[:5])}")
    
    def get_correlation(self, sym_a: str, sym_b: str) -> float:
        """获取两个币的相关系数"""
        return self.matrix.get(sym_a, {}).get(sym_b, 0.0)
    
    def get_beta(self, sym: str) -> float:
        """获取相对BTC的Beta值"""
        return self.betas.get(sym, 1.0)
    
    def get_independence_score(self, sym: str) -> float:
        """独立行情得分（0-100）
        越高说明越不跟BTC走，走独立行情
        """
        corr = abs(self.get_correlation(sym, "BTCUSDT"))
        return round((1 - corr) * 100, 1)
    
    def get_portfolio_diversification(self, symbols: List[str]) -> float:
        """持仓组合分散度（0-100）
        越高说明持仓越分散，风险越低
        """
        if len(symbols) <= 1:
            return 100.0
        
        total_corr = 0
        count = 0
        for i, s_a in enumerate(symbols):
            for s_b in symbols[i+1:]:
                total_corr += abs(self.get_correlation(s_a, s_b))
                count += 1
        
        if count == 0:
            return 100.0
        
        avg_corr = total_corr / count
        return round((1 - avg_corr) * 100, 1)
    
    def find_correlated_pairs(self, threshold: float = 0.7) -> List[Tuple[str, str, float]]:
        """找高相关交易对"""
        pairs = []
        for i, s_a in enumerate(self.symbols):
            for s_b in self.symbols[i+1:]:
                c = self.get_correlation(s_a, s_b)
                if abs(c) >= threshold:
                    pairs.append((s_a, s_b, c))
        return sorted(pairs, key=lambda x: -abs(x[2]))
    
    def find_lead_lag(self, sym: str, lag_hours: int = 4) -> List[Tuple[str, float]]:
        """找领先-滞后关系
        返回领先于sym的币种列表
        """
        if sym not in self.returns:
            return []
        
        sym_rets = self.returns[sym]
        leaders = []
        
        for other_sym, other_rets in self.returns.items():
            if other_sym == sym:
                continue
            
            # 把other的收益率往前移lag_hours个周期，看相关性
            lag_periods = lag_hours // 4  # 4h K线
            min_len = min(len(sym_rets), len(other_rets)) - lag_periods
            if min_len < 20:
                continue
            
            lagged_corr = pearson_corr(
                sym_rets[lag_periods:lag_periods+min_len],
                other_rets[:min_len]
            )
            
            # 同时算同步相关
            sync_corr = pearson_corr(
                sym_rets[:min_len],
                other_rets[:min_len]
            )
            
            # 如果滞后相关比同步相关高很多，说明other领先于sym
            if lagged_corr > sync_corr + 0.1 and lagged_corr > 0.3:
                leaders.append((other_sym, round(lagged_corr, 3)))
        
        return sorted(leaders, key=lambda x: -x[1])
    
    def should_enter(self, sym: str, btc_trend: str = "neutral") -> dict:
        """入场关联性评估
        
        返回：
        - ok: 是否可以入场
        - reason: 原因
        - btc_corr: 跟BTC相关度
        - beta: Beta值
        - independence: 独立度
        - portfolio_div: 当前组合分散度
        """
        result = {
            "ok": True,
            "reason": "",
            "btc_corr": self.get_correlation(sym, "BTCUSDT"),
            "beta": self.get_beta(sym),
            "independence": self.get_independence_score(sym),
        }
        
        # BTC下跌时，高相关币不入场
        if btc_trend == "bearish":
            corr = abs(result["btc_corr"])
            if corr > 0.5:
                result["ok"] = False
                result["reason"] = f"跟BTC强相关({corr:+.2f})，BTC下跌时风险高"
            elif corr > 0.4:
                result["reason"] = f"跟BTC中等相关({corr:+.2f})，谨慎"
        
        # 高Beta币在震荡市风险大
        beta = abs(result["beta"])
        if beta > 3.0 and btc_trend != "bullish":
            result["reason"] += f" | Beta={beta:.1f}过高，波动风险大"
        
        return result
    
    def get_report(self) -> str:
        """生成报告"""
        if not self.matrix:
            return "关联矩阵暂无数据"
        
        lines = ["📊 **关联矩阵报告**"]
        lines.append(f"覆盖: {len(self.symbols)}个币种")
        
        # 跟BTC相关度
        btc_corr = []
        for sym in self.symbols:
            if sym != "BTCUSDT":
                btc_corr.append((sym, self.get_correlation(sym, "BTCUSDT")))
        
        btc_corr.sort(key=lambda x: abs(x[1]))
        lines.append(f"\n**最独立于BTC（优先考虑）：**")
        for sym, c in btc_corr[:5]:
            ind = self.get_independence_score(sym)
            beta = self.get_beta(sym)
            lines.append(f"  {sym}: 相关={c:+.2f} 独立度={ind:.0f}% Beta={beta:.1f}")
        
        lines.append(f"\n**最跟随BTC（谨慎）：**")
        for sym, c in sorted(btc_corr, key=lambda x: -abs(x[1]))[:5]:
            ind = self.get_independence_score(sym)
            beta = self.get_beta(sym)
            lines.append(f"  {sym}: 相关={c:+.2f} 独立度={ind:.0f}% Beta={beta:.1f}")
        
        # 高相关交易对
        pairs = self.find_correlated_pairs(0.75)
        if pairs:
            lines.append(f"\n**高相关交易对（可做配对交易）：**")
            for a, b, c in pairs[:5]:
                lines.append(f"  {a} ↔ {b}: {c:+.2f}")
        
        return "\n".join(lines)


# 单例
_instance = None

def get_matrix() -> CorrelationMatrix:
    global _instance
    if _instance is None:
        _instance = CorrelationMatrix()
        _instance._load()
    return _instance
