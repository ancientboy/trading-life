"""
AI核心模块 - GLM API异步调用封装
使用智谱 glm-4-flash 模型，支持结构化JSON输出
"""
import aiohttp
import json
import os
import logging
import time
from typing import Optional, Dict, Any

logger = logging.getLogger("AICore")

GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
GLM_MODEL = "glm-4-flash"
GLM_API_KEY = os.environ.get("ZHIPU_API_KEY", "")

# 调用统计
_stats = {"calls": 0, "tokens_in": 0, "tokens_out": 0, "errors": 0, "total_time": 0.0}


async def call_glm(
    messages: list,
    temperature: float = 0.3,
    max_tokens: int = 2000,
    response_format: Optional[Dict] = None,
    timeout: int = 30,
    max_retries: int = 3
) -> Optional[str]:
    """
    异步调用GLM API（带重试和指数退避）
    - 429限流: 自动退避重试 (2s, 4s, 8s...)
    - 503不可用: 自动退避重试 (3s, 6s, 12s...)
    - 网络错误: 自动重试
    - 其他错误: 返回None，不崩溃
    """
    global _stats

    if not GLM_API_KEY:
        logger.error("❌ ZHIPU_API_KEY 未设置")
        return None

    headers = {
        "Authorization": f"Bearer {GLM_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": GLM_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    if response_format:
        payload["response_format"] = response_format

    for attempt in range(max_retries):
        start = time.time()

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    GLM_API_URL,
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=timeout)
                ) as resp:
                    elapsed = time.time() - start

                    if resp.status == 200:
                        data = await resp.json()
                        content = data["choices"][0]["message"]["content"]
                        usage = data.get("usage", {})

                        _stats["calls"] += 1
                        _stats["tokens_in"] += usage.get("prompt_tokens", 0)
                        _stats["tokens_out"] += usage.get("completion_tokens", 0)
                        _stats["total_time"] += elapsed

                        logger.debug(f"🤖 GLM调用成功 {elapsed:.1f}s "
                                    f"tokens={usage.get('prompt_tokens',0)}+{usage.get('completion_tokens',0)}")
                        return content

                    elif resp.status == 429:
                        wait = min(2 ** attempt * 2, 30)
                        _stats["errors"] += 1
                        logger.warning(f"⏳ GLM 429限流 (第{attempt+1}/{max_retries}次), 等待{wait}s...")
                        await asyncio.sleep(wait)
                        continue

                    elif resp.status == 503:
                        wait = min(2 ** attempt * 3, 45)
                        _stats["errors"] += 1
                        logger.warning(f"⏳ GLM 503不可用 (第{attempt+1}/{max_retries}次), 等待{wait}s...")
                        await asyncio.sleep(wait)
                        continue

                    elif resp.status >= 500:
                        wait = min(2 ** attempt * 2, 20)
                        _stats["errors"] += 1
                        logger.warning(f"⏳ GLM {resp.status}错误 (第{attempt+1}/{max_retries}次), 等待{wait}s...")
                        await asyncio.sleep(wait)
                        continue

                    else:
                        text = await resp.text()
                        _stats["errors"] += 1
                        logger.error(f"❌ GLM API错误 {resp.status}: {text[:200]}")
                        return None

        except asyncio.TimeoutError:
            _stats["errors"] += 1
            if attempt < max_retries - 1:
                wait = 2 ** attempt
                logger.warning(f"⏳ GLM超时 (第{attempt+1}/{max_retries}次), 等待{wait}s...")
                await asyncio.sleep(wait)
                continue
            logger.error(f"❌ GLM API超时 ({timeout}s), 已重试{max_retries}次")
            return None

        except (aiohttp.ClientError, ConnectionError, OSError) as e:
            _stats["errors"] += 1
            if attempt < max_retries - 1:
                wait = 2 ** attempt * 2
                logger.warning(f"⏳ GLM网络错误 {type(e).__name__} (第{attempt+1}/{max_retries}次), 等待{wait}s...")
                await asyncio.sleep(wait)
                continue
            logger.error(f"❌ GLM网络异常: {e}, 已重试{max_retries}次")
            return None

        except Exception as e:
            _stats["errors"] += 1
            logger.error(f"❌ GLM API异常: {type(e).__name__}: {e}")
            return None

    logger.error(f"❌ GLM API调用失败, 已重试{max_retries}次")
    return None
async def call_glm_json(
    messages: list,
    temperature: float = 0.2,
    max_tokens: int = 2000,
    timeout: int = 30
) -> Optional[Dict]:
    """
    调用GLM并解析JSON输出
    自动在prompt中要求JSON格式，并尝试解析返回结果
    """
    content = await call_glm(
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout
    )
    
    if not content:
        return None
    
    # 尝试提取JSON
    return extract_json(content)


def extract_json(text: str) -> Optional[Dict]:
    """从文本中提取JSON（处理markdown代码块包裹的情况）"""
    # 尝试直接解析
    try:
        return json.loads(text)
    except:
        pass
    
    # 尝试提取 ```json ... ```
    import re
    m = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except:
            pass
    
    # 尝试找 { ... }
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(m.group(0))
        except:
            pass
    
    logger.warning(f"⚠️ 无法解析JSON: {text[:100]}")
    return None


def get_stats() -> Dict[str, Any]:
    """获取调用统计"""
    return {
        **_stats,
        "avg_time": _stats["total_time"] / max(1, _stats["calls"]),
        "model": GLM_MODEL
    }


import asyncio
