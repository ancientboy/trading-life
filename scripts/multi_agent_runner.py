"""
多Agent调度器 - XAU黄金专用模式

当前只运行黄金策略，其他Agent暂停
- XAUBollAgent (黄金布林带挂单)  - $10,000
"""

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "agents"))

from config import DATA_DIR

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger("MultiAgentRunner")


class MultiAgentRunner:
    def __init__(self, total_capital: float = 40000):
        self.total_capital = total_capital

        xau_capital = 10000.0

        from agents.xau_boll_agent import XAUBollAgent

        self.xau = XAUBollAgent(xau_capital)

        self.cycle = 0
        logger.info(f"🚀 XAU黄金专用模式启动: ${xau_capital:,.0f}")

    async def run_forever(self):
        """主循环"""
        import aiohttp
        from agents.tracker import record, check_all, get_report

        async with aiohttp.ClientSession() as session:
            while True:
                self.cycle += 1
                first_cycle = self.cycle == 1
                cycle_start = __import__('time').time()

                try:
                    # ===== XAU布林带挂单（每轮都做，1分钟周期）=====
                    try:
                        await self.xau.run_cycle(session)
                    except Exception as e:
                        logger.warning(f"[xau] 扫描失败: {e}")

                    # ===== 状态报告（每240轮≈1小时）=====
                    if self.cycle % 240 == 0:
                        self._print_status()

                except asyncio.CancelledError:
                    logger.info("🛑 XAU黄金系统收到停止信号")
                    break
                except Exception as e:
                    logger.error(f"主循环异常: {e}", exc_info=True)

                elapsed = __import__('time').time() - cycle_start
                logger.info(f"[cycle] #{self.cycle} 完成, 耗时{elapsed:.1f}s")
                await asyncio.sleep(15)  # 15秒cycle，配合15秒K线

    def _print_status(self):
        logger.info(f"\n{'='*50}")
        xau_cap = self.xau.capital
        xau_pos = len(self.xau.active_positions)
        xau_pend = len(self.xau.pending_orders)
        xau_trades = self.xau.total_trades
        xau_wr = self.xau.total_wins / max(self.xau.total_trades, 1) * 100
        logger.info(f"[XAU] 资金${xau_cap:,.0f} | 持仓{xau_pos} | 挂单{xau_pend} | {xau_trades}笔 WR{xau_wr:.0f}%")
        logger.info(f"总资金: ${xau_cap:,.2f}")
        logger.info(f"{'='*50}")


async def main():
    runner = MultiAgentRunner(total_capital=40000)
    await runner.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
