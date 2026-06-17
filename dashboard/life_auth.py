"""
交易人生 — 多账户注册/登录/会话
"""
from __future__ import annotations

import hashlib
import re
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

import life_db

router = APIRouter()

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
_PBKDF2_ROUNDS = 260_000


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


def _validate_username(username: str) -> str:
    u = (username or "").strip()
    if not _USERNAME_RE.match(u):
        raise HTTPException(400, "用户名须为 3-20 位字母、数字或下划线")
    return u.lower()


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
    if x_life_user_id:
        uid = x_life_user_id.strip()
        if uid and len(uid) <= 64:
            life_db.ensure_user(uid)
            return uid
    raise HTTPException(401, "请先登录")


class RegisterBody(BaseModel):
    username: str
    password: str = Field(min_length=6, max_length=64)
    display_name: str = ""


class LoginBody(BaseModel):
    username: str
    password: str = Field(min_length=1, max_length=64)


def _account_public(acc: dict) -> dict:
    return {
        "id": acc["id"],
        "username": acc["username"],
        "display_name": acc.get("display_name") or acc["username"],
    }


@router.post("/auth/register")
async def auth_register(body: RegisterBody):
    username = _validate_username(body.username)
    pw_hash = hash_password(body.password)
    res = life_db.create_account(username, pw_hash, (body.display_name or "").strip()[:32])
    if not res.get("ok"):
        return {"ok": False, "error": "用户名已被占用"}
    account_id = res["account_id"]
    token = life_db.create_session(account_id)
    life_db.reset_session_idle(account_id)
    from life_game import load_user, _public_state

    user = load_user(account_id)
    acc = life_db.get_account_by_id(account_id)
    return {
        "ok": True,
        "token": token,
        "account": _account_public(acc or {"id": account_id, "username": username, "display_name": username}),
        "state": _public_state(user),
    }


@router.post("/auth/login")
async def auth_login(body: LoginBody):
    username = _validate_username(body.username)
    acc = life_db.get_account_by_username(username)
    if not acc or not verify_password(body.password, acc["password_hash"]):
        return {"ok": False, "error": "用户名或密码错误"}
    token = life_db.create_session(acc["id"])
    life_db.reset_session_idle(acc["id"])
    from life_game import load_user, _public_state

    user = load_user(acc["id"])
    return {
        "ok": True,
        "token": token,
        "account": _account_public(acc),
        "state": _public_state(user),
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
    return {"ok": True, "account": _account_public(acc), "state": _public_state(user)}
