#!/usr/bin/env python3
"""浏览器端冒烟：注册登录并验证页面可打开。"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5174/trading/life/"
API = "http://127.0.0.1:9095/api/life"


def api_post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    user = f"ui_{int(time.time())}"
    reg = api_post("/auth/register", {
        "username": user,
        "password": "testpass123",
        "display_name": "UI测试",
    })
    assert reg.get("ok"), reg
    token = reg["token"]
    print(f"registered {user}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(BASE, wait_until="networkidle", timeout=60000)

        # 注入登录态（与 lifeAuth.ts 一致）
        page.evaluate(
            """([token, account]) => {
              localStorage.setItem('trading-life-auth-token', token);
              localStorage.setItem('trading-life-account', JSON.stringify(account));
            }""",
            [token, {
                "id": reg["account"]["id"],
                "username": reg["account"]["username"],
                "display_name": reg["account"]["display_name"],
            }],
        )
        page.reload(wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)

        # 关闭可能遮挡的 onboarding / 弹窗
        for label in ("稍后", "跳过", "知道了", "关闭", "取消"):
            btn = page.get_by_role("button", name=label)
            if btn.count():
                try:
                    btn.first.click(timeout=2000)
                    page.wait_for_timeout(500)
                except Exception:
                    pass
        overlay = page.locator(".modal-overlay")
        if overlay.count():
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

        body = page.inner_text("body")
        assert "登录" not in body[:200] or "交易人生" in body, "可能仍在登录页"
        page.screenshot(path="/workspace/artifacts/life-ingame.png", full_page=False)
        print("screenshot: /workspace/artifacts/life-ingame.png")

        # 打开竞技馆侧栏（若 onboarding 弹窗存在先等）
        page.wait_for_timeout(2000)
        arena_btn = page.locator("button", has_text="竞技")
        if arena_btn.count():
            try:
                arena_btn.first.click(timeout=5000)
                page.wait_for_timeout(2000)
                page.screenshot(path="/workspace/artifacts/life-arena.png", full_page=False)
                print("screenshot: /workspace/artifacts/life-arena.png")
            except Exception as e:
                print(f"arena click skipped: {e}")

        browser.close()
    print("browser smoke ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
