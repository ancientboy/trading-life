"""
交易人生 — 多账户注册/登录/会话
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import life_db

router = APIRouter()

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
_PBKDF2_ROUNDS = 260_000
ADMIN_USERNAME = "admin"
ALLOW_HEADER_USER_ID = os.environ.get("LIFE_ALLOW_HEADER_USER_ID", "").strip() in ("1", "true", "yes")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return f"{salt.hex()}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
        return dk.hex() == dk_hex
    except Exception:
        return False


def _validate_username(username: str) -> Tuple[Optional[str], Optional[str]]:
    u = (username or "").strip()
    if not _USERNAME_RE.match(u):
        return None, "用户名须为 3-20 位字母、数字或下划线"
    return u.lower(), None


def ensure_admin_account() -> None:
    """确保 admin 账户存在（系统默认 Agent 归属 admin）"""
    if life_db.get_account_by_username(ADMIN_USERNAME):
        return
    pw = (os.environ.get("LIFE_ADMIN_PASSWORD") or "").strip()
    if not pw:
        pw = secrets.token_urlsafe(16)
        print(f"[life_auth] 未设置 LIFE_ADMIN_PASSWORD，已生成一次性 admin 密码: {pw}")
    elif len(pw) < 8:
        print("[life_auth] 警告: LIFE_ADMIN_PASSWORD 过短，建议至少 8 位")
    res = life_db.create_account(ADMIN_USERNAME, hash_password(pw), "管理员")
    if res.get("ok"):
        print("[life_auth] 已创建 admin 账户")


def resolve_account_id(
    authorization: Optional[str] = Header(None),
    x_life_user_id: Optional[str] = Header(None, alias="X-Life-User-Id"),
) -> str:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if token:
        account_id = life_db.resolve_session_token(token)
        if account_id:
            return account_id
        raise HTTPException(401, "登录已过期，请重新登录")
    if ALLOW_HEADER_USER_ID and x_life_user_id:
        uid = x_life_user_id.strip()
        if uid and len(uid) <= 64:
            life_db.ensure_user(uid)
            return uid
    raise HTTPException(401, "请先登录")


def is_admin_account(account_id: str) -> bool:
    acc = life_db.get_account_by_id(account_id)
    return bool(acc and str(acc.get("username", "")).lower() == ADMIN_USERNAME)


async def require_admin(account_id: str = Depends(resolve_account_id)) -> str:
    if not is_admin_account(account_id):
        raise HTTPException(403, "需要管理员权限")
    return account_id


class RegisterBody(BaseModel):
    username: str
    password: str
    display_name: str = ""
    invite_code: str = ""


class LoginBody(BaseModel):
    username: str
    password: str


def _account_public(acc: dict) -> dict:
    return {
        "id": acc["id"],
        "username": acc["username"],
        "display_name": acc.get("display_name") or acc["username"],
    }


@router.post("/auth/register")
async def auth_register(body: RegisterBody):
    username, err = _validate_username(body.username)
    if err:
        return {"ok": False, "error": err}
    password = body.password or ""
    if len(password) < 6:
        return {"ok": False, "error": "密码至少 6 位"}
    if len(password) > 64:
        return {"ok": False, "error": "密码不能超过 64 位"}
    pw_hash = hash_password(password)
    res = life_db.create_account(username, pw_hash, (body.display_name or "").strip()[:32])
    if not res.get("ok"):
        return {"ok": False, "error": "用户名已被占用"}
    account_id = res["account_id"]
    invite_msg = ""
    code = (body.invite_code or "").strip()
    if code:
        ref = life_db.apply_referral(account_id, code)
        if ref.get("ok"):
            invite_msg = f" · 邀请奖励 +{ref['invitee_bonus']} 积分"
        else:
            invite_msg = f" · {ref.get('error', '邀请码无效')}"
    token = life_db.create_session(account_id)
    life_db.reset_session_idle(account_id)
    life_db.ensure_portfolio(account_id)
    from life_game import load_user, _public_state

    user = load_user(account_id)
    acc = life_db.get_account_by_id(account_id)
    return {
        "ok": True,
        "token": token,
        "account": _account_public(acc or {"id": account_id, "username": username, "display_name": username}),
        "state": _public_state(user, account_id),
        "invite_message": invite_msg.strip(" · ") if invite_msg else "",
    }


@router.post("/auth/login")
async def auth_login(body: LoginBody):
    username, err = _validate_username(body.username)
    if err:
        return {"ok": False, "error": err}
    if not (body.password or "").strip():
        return {"ok": False, "error": "请输入密码"}
    acc = life_db.get_account_by_username(username)
    if not acc or not verify_password(body.password, acc["password_hash"]):
        return {"ok": False, "error": "用户名或密码错误"}
    token = life_db.create_session(acc["id"])
    life_db.reset_session_idle(acc["id"])
    life_db.ensure_portfolio(acc["id"])
    from life_game import load_user, _public_state

    user = load_user(acc["id"])
    return {
        "ok": True,
        "token": token,
        "account": _account_public(acc),
        "state": _public_state(user, acc["id"]),
    }


@router.post("/auth/logout")
async def auth_logout(
    authorization: Optional[str] = Header(None),
):
    if authorization and authorization.lower().startswith("bearer "):
        life_db.delete_session(authorization[7:].strip())
    return {"ok": True}


@router.get("/auth/me")
async def auth_me(account_id: str = Depends(resolve_account_id)):
    acc = life_db.get_account_by_id(account_id)
    if not acc:
        raise HTTPException(404, "账户不存在")
    from life_game import load_user, _public_state

    user = load_user(account_id)
    return {"ok": True, "account": _account_public(acc), "state": _public_state(user, account_id)}
