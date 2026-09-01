# scoring.py
"""电话快答评分公式（纯函数）。与 frontend/scripts/game.js 保持一致，测试用例相同。"""

MAX_SCORE = 5100  # 15 题全对满分


def score_answer(correct: bool, seconds_left: float, streak_before: int) -> tuple[int, int, int]:
    """返回 (基础分, 速度分, 连击分)。streak_before = 答本题前已连续答对数。"""
    if not correct:
        return 0, 0, 0
    base = 100
    speed = min(int(seconds_left) * 10, 100)
    combo = 20 * streak_before  # streak_before 0/1/2... -> 0/20/40...
    return base, speed, combo


def compute_win_index(total: int) -> int:
    return min(100, round(total / MAX_SCORE * 100))


def rank_label(win_index: int) -> str:
    if win_index >= 90:
        return "Saul-certified: Supreme Chicanery"
    if win_index >= 70:
        return "Worthy of answering Saul's phones"
    if win_index >= 50:
        return "Consult a lawyer... about consulting"
    return "Turn yourself in"
