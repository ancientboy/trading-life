"""交易人生 — 安全与核心逻辑单元测试"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

import life_db


class LifeSecurityTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        life_db.init_db(Path(self._tmpdir.name))
        self.uid = "acc_test_user"
        life_db.ensure_user(self.uid)
        life_db.create_account("player1", "hash", "玩家1")
        self.player = life_db.get_account_by_username("player1")["id"]
        life_db.ensure_user(self.player)

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_adjust_points_atomic(self):
        ok, bal = life_db.adjust_points(self.uid, 100)
        self.assertTrue(ok)
        self.assertEqual(bal, life_db.STARTING_POINTS + 100)
        ok, bal = life_db.adjust_points(self.uid, -life_db.STARTING_POINTS - 200)
        self.assertFalse(ok)

    def test_migrate_once_only(self):
        agents = {
            "custom_1": {
                "id": "custom_1",
                "agentType": "entertainment",
                "name": "测试",
            }
        }
        r1 = life_db.migrate_user(self.player, 12000, 0, agents, [])
        self.assertTrue(r1["ok"])
        r2 = life_db.migrate_user(self.player, 99999, 0, agents, ["outfit_panda"])
        self.assertFalse(r2["ok"])
        user = life_db.load_user(self.player)
        self.assertIn("custom_1", user["custom_agents"])
        self.assertNotIn("outfit_panda", user["shop_unlocks"])

    def test_claim_seat_desk_ttl_and_ownership(self):
        life_db.save_user_data(self.player, {
            **life_db.load_user(self.player),
            "custom_agents": {"custom_1": {"id": "custom_1", "agentType": "entertainment", "name": "A"}},
        })
        bad = life_db.claim_seat("desk_1", self.player, "custom_99", "desk", 0)
        self.assertFalse(bad["ok"])
        ok = life_db.claim_seat("desk_1", self.player, "custom_1", "desk", 0)
        self.assertTrue(ok["ok"])
        self.assertGreater(ok["until_ts"], 0)
        leisure_bad = life_db.claim_seat("bed_1", self.player, "custom_1", "massage", 0)
        self.assertFalse(leisure_bad["ok"])

    def test_release_seat_requires_user(self):
        life_db.save_user_data(self.player, {
            **life_db.load_user(self.player),
            "custom_agents": {"custom_1": {"id": "custom_1", "agentType": "entertainment", "name": "A"}},
        })
        life_db.claim_seat("bed_1", self.player, "custom_1", "rest", life_db.now_ms() + 60_000)
        other = "acc_other"
        life_db.ensure_user(other)
        denied = life_db.release_seat("bed_1", other, "custom_1")
        self.assertFalse(denied["ok"])
        allowed = life_db.release_seat("bed_1", self.player, "custom_1")
        self.assertTrue(allowed["ok"])


class LifeAuthTests(unittest.TestCase):
    def test_header_user_id_disabled_by_default(self):
        os.environ.pop("LIFE_ALLOW_HEADER_USER_ID", None)
        from importlib import reload
        import life_auth
        reload(life_auth)
        from fastapi import HTTPException
        from life_auth import resolve_account_id
        with self.assertRaises(HTTPException):
            resolve_account_id(authorization=None, x_life_user_id="acc_fake")


if __name__ == "__main__":
    unittest.main()
