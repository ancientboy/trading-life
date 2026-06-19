#!/usr/bin/env python3
"""为指定用户增加积分（按 display_name 或 username 查找）。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "dashboard"))

import life_db  # noqa: E402
from life_game import load_user, save_user, _earn  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant points to a life account")
    parser.add_argument("name", help="display_name or username")
    parser.add_argument("amount", type=int, help="points to add")
    parser.add_argument("--data-dir", default=str(ROOT / "dashboard" / "data"))
    args = parser.parse_args()

    life_db.init_db(Path(args.data_dir))
    with life_db._conn() as c:
        row = c.execute(
            "SELECT id, username, display_name FROM life_accounts "
            "WHERE display_name=? OR username=? COLLATE NOCASE",
            (args.name, args.name),
        ).fetchone()
    if not row:
        print(f"用户未找到: {args.name}", file=sys.stderr)
        sys.exit(1)

    uid = row["id"]
    user = load_user(uid)
    before = user.get("points", 0)
    _earn(user, max(0, args.amount), reason="admin_grant", account_id=uid)
    save_user(uid, user)
    print(f"OK account={uid} user={row['username']} display={row['display_name']}")
    print(f"points: {before} -> {user['points']} (+{args.amount})")


if __name__ == "__main__":
    main()
