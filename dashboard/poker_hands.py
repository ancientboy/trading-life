"""德州扑克 — 发牌与牌型评估（7 选 5）"""
from __future__ import annotations

import random
from collections import Counter
from itertools import combinations

RANKS = "23456789TJQKA"
SUITS = "cdhs"

HAND_NAMES = {
    9: "皇家同花顺",
    8: "同花顺",
    7: "四条",
    6: "葫芦",
    5: "同花",
    4: "顺子",
    3: "三条",
    2: "两对",
    1: "一对",
    0: "高牌",
}

SUIT_SYMBOLS = {"c": "♣", "d": "♦", "h": "♥", "s": "♠"}
RANK_DISPLAY = {"T": "10", "J": "J", "Q": "Q", "K": "K", "A": "A"}


def rank_index(card: str) -> int:
    return RANKS.index(card[0])


def rank_label(idx: int) -> str:
    return RANKS[idx]


def card_display(card: str) -> str:
    r = RANK_DISPLAY.get(card[0], card[0])
    return f"{r}{SUIT_SYMBOLS[card[1]]}"


def make_deck() -> list[str]:
    return [r + s for r in RANKS for s in SUITS]


def _straight_high(ranks: list[int]) -> int | None:
    uniq = sorted(set(ranks), reverse=True)
    if len(uniq) != 5:
        return None
    if uniq[0] - uniq[4] == 4:
        return uniq[0]
    if uniq == [12, 3, 2, 1, 0]:
        return 3
    return None


def evaluate_five(cards: list[str]) -> tuple[tuple[int, ...], list[str]]:
    ranks = [rank_index(c) for c in cards]
    suits = [c[1] for c in cards]
    counts = Counter(ranks)
    by_count = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
    is_flush = len(set(suits)) == 1
    sh = _straight_high(ranks)
    is_straight = sh is not None
    sorted_desc = sorted(ranks, reverse=True)

    if is_straight and is_flush:
        cat = 9 if sh == 12 and min(ranks) == 8 else 8
        return ((cat, sh), cards)

    if by_count[0][1] == 4:
        quad, kicker = by_count[0][0], by_count[1][0]
        return ((7, quad, kicker), cards)

    if by_count[0][1] == 3 and by_count[1][1] == 2:
        return ((6, by_count[0][0], by_count[1][0]), cards)

    if is_flush:
        return ((5,) + tuple(sorted_desc), cards)

    if is_straight:
        return ((4, sh), cards)

    if by_count[0][1] == 3:
        trip = by_count[0][0]
        kickers = sorted((r for r in ranks if r != trip), reverse=True)
        return ((3, trip, kickers[0], kickers[1]), cards)

    if by_count[0][1] == 2 and by_count[1][1] == 2:
        p1, p2 = sorted((by_count[0][0], by_count[1][0]), reverse=True)
        kicker = next(r for r in sorted_desc if counts[r] == 1)
        return ((2, p1, p2, kicker), cards)

    if by_count[0][1] == 2:
        pair = by_count[0][0]
        kickers = sorted((r for r in ranks if r != pair), reverse=True)
        return ((1, pair, kickers[0], kickers[1], kickers[2]), cards)

    return ((0,) + tuple(sorted_desc), cards)


def evaluate_best(cards7: list[str]) -> tuple[tuple[int, ...], list[str]]:
    best_score: tuple[int, ...] | None = None
    best_five: list[str] | None = None
    for combo in combinations(cards7, 5):
        score, five = evaluate_five(list(combo))
        if best_score is None or score > best_score:
            best_score = score
            best_five = five
    assert best_score is not None and best_five is not None
    return best_score, best_five


def rank_char(idx: int) -> str:
    return RANKS[idx]


def hand_combo(score: tuple[int, ...], best_five: list[str]) -> str:
    """最佳五张的紧凑记法，如两对 JJ77A、一对 77JA8。"""
    cat = score[0]
    ranks = [rank_index(c) for c in best_five]
    rc = rank_char

    if cat == 9:
        return "AKQJT"
    if cat == 8:
        high = score[1]
        if high == 3:
            return "5432A"
        return "".join(rc(high - i) for i in range(5))
    if cat == 7:
        quad, kicker = score[1], score[2]
        return rc(quad) * 4 + rc(kicker)
    if cat == 6:
        trip, pair = score[1], score[2]
        return rc(trip) * 3 + rc(pair) * 2
    if cat == 5:
        return "".join(rc(r) for r in sorted(ranks, reverse=True))
    if cat == 4:
        high = score[1]
        if high == 3:
            return "5432A"
        return "".join(rc(high - i) for i in range(5))
    if cat == 3:
        trip = score[1]
        kickers = sorted((r for r in ranks if r != trip), reverse=True)
        return rc(trip) * 3 + "".join(rc(r) for r in kickers)
    if cat == 2:
        p1, p2, kicker = score[1], score[2], score[3]
        return rc(p1) * 2 + rc(p2) * 2 + rc(kicker)
    if cat == 1:
        pair = score[1]
        kickers = sorted((r for r in ranks if r != pair), reverse=True)
        return rc(pair) * 2 + "".join(rc(r) for r in kickers)
    return "".join(rc(r) for r in sorted(ranks, reverse=True))


def hand_name(score: tuple[int, ...]) -> str:
    cat = score[0]
    base = HAND_NAMES.get(cat, "高牌")
    if cat == 0:
        return f"{base} {rank_label(score[1])}"
    if cat == 1:
        return f"{base} {rank_label(score[1])}"
    if cat == 2:
        return f"{base} {rank_label(score[1])}-{rank_label(score[2])}"
    if cat == 3:
        return f"{base} {rank_label(score[1])}"
    if cat == 4:
        return f"{base} {'5' if score[1] == 3 else rank_label(score[1])}高"
    if cat == 6:
        return f"{base} {rank_label(score[1])}带{rank_label(score[2])}"
    if cat == 7:
        return f"{base} {rank_label(score[1])}"
    return base


def score_to_display(score: tuple[int, ...]) -> int:
    weights = {9: 95, 8: 88, 7: 82, 6: 76, 5: 70, 4: 63, 3: 56, 2: 46, 1: 34, 0: 12}
    return min(99, weights.get(score[0], 10) + (score[1] if len(score) > 1 else 0))


def deal_holdem(num_players: int) -> tuple[list[str], list[list[str]]]:
    if num_players < 2 or num_players > 10:
        raise ValueError("invalid player count")
    deck = make_deck()
    random.shuffle(deck)
    idx = 0
    holes: list[list[str]] = []
    for _ in range(num_players):
        holes.append([deck[idx], deck[idx + 1]])
        idx += 2
    community = deck[idx: idx + 5]
    return community, holes


def play_round(num_players: int) -> dict:
    community, holes = deal_holdem(num_players)
    entries = []
    for i, hole in enumerate(holes):
        score, best_five = evaluate_best(hole + community)
        entries.append({
            "seat": i,
            "hole_cards": hole,
            "best_cards": best_five,
            "hand_name": hand_name(score),
            "hand_combo": hand_combo(score, best_five),
            "hand_score": score,
            "score": score_to_display(score),
        })
    return {"community_cards": community, "players": entries}
