"""德州牌型评估单元测试"""
from poker_hands import evaluate_best, compare_hands, hand_name, hand_combo, play_round


def test_two_pair_beats_one_pair():
    """两对 K-7 胜 一对 K（用户反馈场景）。"""
    board = ["Ks", "Kd", "Td", "7h", "5s"]
    score_user, best_user = evaluate_best(["Jc", "Qc"] + board)
    score_gaga, best_gaga = evaluate_best(["7c", "5h"] + board)
    assert hand_name(score_user) == "一对 K"
    assert hand_combo(score_user, best_user) == "KKQJT"
    assert hand_name(score_gaga) == "两对 K-7"
    assert compare_hands(score_gaga, score_user) > 0


def test_two_pair_kq_beats_two_pair_k7():
    """两对 K-Q 胜 两对 K-7。"""
    board = ["Ks", "Kd", "Qh", "7d", "Td"]
    score_user, _ = evaluate_best(["Jc", "Qc"] + board)
    score_gaga, _ = evaluate_best(["7c", "5h"] + board)
    assert hand_name(score_user) == "两对 K-Q"
    assert compare_hands(score_user, score_gaga) > 0


def test_play_round_ranking():
    r = play_round(3)
    hands = r["players"]
    best = max(h["hand_score"] for h in hands)
    winners = [h for h in hands if h["hand_score"] == best]
    for h in hands:
        assert compare_hands(h["hand_score"], best) <= 0
    assert len(winners) >= 1


if __name__ == "__main__":
    test_two_pair_beats_one_pair()
    test_two_pair_kq_beats_two_pair_k7()
    test_play_round_ranking()
    print("ok")
