#!/usr/bin/env python3
"""
小风交易系统 - 启动脚本
当前版本：v0.1.0 - 数据采集 + 模拟交易
"""

import os
import sys
import yaml
import json
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
CONFIG_DIR = BASE_DIR / "config"
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"

def load_config(name):
    """加载YAML配置文件"""
    config_path = CONFIG_DIR / name
    if config_path.exists():
        with open(config_path) as f:
            return yaml.safe_load(f)
    return {}

def save_signal(signal_data):
    """保存交易信号到日志"""
    date_str = datetime.now().strftime("%Y-%m-%d")
    signal_file = DATA_DIR / f"signals-{date_str}.jsonl"
    with open(signal_file, "a") as f:
        f.write(json.dumps(signal_data, ensure_ascii=False) + "\n")

def save_trade(trade_data):
    """保存交易记录"""
    date_str = datetime.now().strftime("%Y-%m-%d")
    trade_file = DATA_DIR / f"trades-{date_str}.jsonl"
    with open(trade_file, "a") as f:
        f.write(json.dumps(trade_data, ensure_ascii=False) + "\n")

def main():
    print("🌀 小风交易系统 v0.1.0")
    print("=" * 40)
    
    config = load_config("trading-config.yaml")
    mode = config.get("system", {}).get("mode", "paper_trading")
    print(f"📊 运行模式: {mode}")
    print(f"📁 数据目录: {DATA_DIR}")
    print(f"📋 配置目录: {CONFIG_DIR}")
    
    # 确保数据目录存在
    DATA_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)
    
    print("\n✅ 系统初始化完成")
    print("⚠️  当前为模拟交易模式")

if __name__ == "__main__":
    main()
