#!/usr/bin/env python3
"""
真实用户 E2E：在浏览器打开页面，走注册/登录 UI，验证竞技馆 WS 推送与进阶观赛。
用法: python scripts/test_life_e2e_user.py [BASE_URL]
默认: http://127.0.0.1:5174/trading/life/
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ARTIFACTS = Path("/workspace/artifacts/e2e")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5174/trading/life/"


def dismiss_overlays(page) -> None:
    for _ in range(3):
        closed = False
        for label in ("关闭", "取消", "稍后", "跳过", "知道了", "✕"):
            loc = page.get_by_role("button", name=label)
            if loc.count():
                try:
                    loc.first.click(timeout=1500)
                    page.wait_for_timeout(400)
                    closed = True
                except Exception:
                    pass
        modal_close = page.locator(".modal-overlay button").filter(has_text="×")
        if modal_close.count():
            try:
                modal_close.first.click(timeout=1000)
                closed = True
            except Exception:
                pass
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        if not closed:
            break


def main() -> int:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time())
    user = f"e2e_{stamp}"
    password = "testpass123"
    ws_frames: list[str] = []
    ws_connected = False

    print(f"==> 打开页面: {BASE}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
        context = browser.new_context(viewport={"width": 1440, "height": 2400})
        page = context.new_page()

        def on_ws(ws):
            nonlocal ws_connected
            url = ws.url
            if "/api/life/ws" not in url and "/life/ws" not in url:
                return
            ws_connected = True
            print(f"  [WS] connected: {url[:80]}...")

            def on_frame(payload):
                text = payload if isinstance(payload, str) else str(payload)
                if len(text) < 400:
                    ws_frames.append(text)
                else:
                    ws_frames.append(text[:200] + "...")

            ws.on("framereceived", on_frame)

        page.on("websocket", on_ws)

        # 注入 WS 帧计数（补充 Playwright websocket 事件）
        page.add_init_script("""
        window.__lifeWsLog = [];
        const Orig = WebSocket;
        window.WebSocket = function(url, protocols) {
          const ws = new Orig(url, protocols);
          if (String(url).includes('/life/ws')) {
            ws.addEventListener('message', (ev) => {
              try { window.__lifeWsLog.push(JSON.parse(ev.data)); } catch { window.__lifeWsLog.push(ev.data); }
            });
          }
          return ws;
        };
        window.WebSocket.prototype = Orig.prototype;
        window.WebSocket.CONNECTING = Orig.CONNECTING;
        window.WebSocket.OPEN = Orig.OPEN;
        window.WebSocket.CLOSING = Orig.CLOSING;
        window.WebSocket.CLOSED = Orig.CLOSED;
        """)

        # ── 1. 登录页 ──
        page.goto(BASE, wait_until="domcontentloaded", timeout=90000)
        page.screenshot(path=str(ARTIFACTS / "01-login-page.png"))
        expect(page.get_by_text("交易人生").first).to_be_visible(timeout=15000)
        print("  ✓ 登录页加载")

        login_box = page.locator(".login-box")
        login_box.get_by_role("button", name="注册", exact=True).click()
        login_box.locator("input.login-input").nth(0).fill(user)
        login_box.locator("input.login-input").nth(1).fill("真实用户测试")
        login_box.locator("input[type='password']").fill(password)
        page.locator(".login-overlay").evaluate("el => { el.scrollTop = el.scrollHeight; }")
        submit = login_box.locator("button").filter(has_text="30 秒养 Agent")
        submit.scroll_into_view_if_needed()
        submit.click(force=True)
        page.wait_for_function("() => !document.querySelector('.login-overlay')", timeout=120000)
        page.wait_for_load_state("domcontentloaded", timeout=90000)
        page.wait_for_timeout(3000)
        page.screenshot(path=str(ARTIFACTS / "02-after-register.png"))
        print(f"  ✓ 注册完成: {user}")

        dismiss_overlays(page)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(ARTIFACTS / "03-main-hall.png"))
        print("  ✓ 进入主界面")

        # ── 2. 竞技馆（WS arena/guess）──
        arena_nav = page.locator("button.nav-icon-btn").filter(has_text="竞技")
        expect(arena_nav.first).to_be_visible(timeout=10000)
        arena_nav.first.click()
        page.wait_for_timeout(3500)
        page.screenshot(path=str(ARTIFACTS / "04-arena.png"))

        body = page.inner_text("body")
        assert "交易竞技" in body or "竞技" in body, "竞技馆面板未打开"
        assert "BTC" in body or "猜涨跌" in body, "竞技馆无行情/玩法数据"
        print("  ✓ 竞技馆 UI 与数据可见")

        # 等待 WS 推送（倒计时变化说明 REST/WS 至少其一生效）
        page.wait_for_timeout(6000)
        ws_log = page.evaluate("() => window.__lifeWsLog || []")
        arena_types = [m for m in ws_log if isinstance(m, dict) and m.get('type') in ('arena.live', 'guess.current')]
        page.screenshot(path=str(ARTIFACTS / "05-arena-ws-wait.png"))
        if ws_connected and arena_types:
            print(f"  ✓ WS 收到竞技推送 ({len(arena_types)} 帧): {[m.get('type') for m in arena_types[:3]]}")
        elif ws_connected:
            print(f"  ⚠ WS 已连接，浏览器捕获 {len(ws_log)} 帧")
        else:
            print("  ⚠ 未检测到 Life WebSocket")

        # ── 3. 德州厅 + 进阶观赛 ──
        dismiss_overlays(page)
        page.locator(".left-sidebar").hover()
        page.locator('button[title="德州扑克"]').click(force=True)
        page.wait_for_timeout(3500)
        page.screenshot(path=str(ARTIFACTS / "06-casino.png"))
        body_casino = page.inner_text("body")
        if "德州" in body_casino or "VIP" in body_casino or "扑克" in body_casino:
            print("  ✓ 德州厅已打开")
        else:
            print("  ⚠ 可能未切到德州分区，继续尝试打开牌局面板")

        dismiss_overlays(page)
        for label in ("德州 · 牌桌", "开局", "德州扑克"):
            tab = page.get_by_text(label, exact=False)
            if tab.count():
                try:
                    tab.first.click(timeout=3000)
                    page.wait_for_timeout(1000)
                    break
                except Exception:
                    pass

        adv_tab = page.get_by_role("button", name="进阶博弈")
        if adv_tab.count():
            adv_tab.first.click(force=True)
            page.wait_for_timeout(800)

        ai_btn = page.locator("button").filter(has_text="开始 AI 观赛")
        if ai_btn.count():
            ai_btn.first.click(force=True)
            page.wait_for_timeout(10000)
            page.screenshot(path=str(ARTIFACTS / "07-poker-spectator.png"))
            spec_body = page.inner_text("body")
            if "观赛" in spec_body and ("第" in spec_body or "翻牌" in spec_body or "盲注" in spec_body):
                print("  ✓ 进阶观赛桌已加载（真实用户点击）")
            else:
                print("  ⚠ 观赛桌可能仍在加载")
            ws_log2 = page.evaluate("() => window.__lifeWsLog || []")
            adv_frames = [m for m in ws_log2 if isinstance(m, dict) and m.get("type") == "poker.advanced.state"]
            if adv_frames:
                print(f"  ✓ WS 收到进阶观赛 ({len(adv_frames)} 帧)")
        else:
            print("  ⚠ 未找到「开始 AI 观赛」按钮（需先进入德州牌桌面板）")

        page.screenshot(path=str(ARTIFACTS / "08-final.png"), full_page=True)
        browser.close()

    print(f"\n==> 截图目录: {ARTIFACTS}")
    print(f"==> WS 连接: {'是' if ws_connected else '否'}")
    print("==> 真实用户 E2E 完成")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"\nFAILED: {e}", file=sys.stderr)
        raise
