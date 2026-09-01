# tests/test_scoring.py
from scoring import score_answer, compute_win_index, rank_label


def test_correct_full_time_no_streak():
    assert score_answer(True, 10.0, 0) == (100, 100, 0)


def test_wrong_answer_zeroes_everything():
    assert score_answer(False, 5.0, 3) == (0, 0, 0)


def test_speed_is_seconds_left_times_ten():
    assert score_answer(True, 4.0, 0)[1] == 40


def test_speed_capped_at_100():
    assert score_answer(True, 10.0, 0)[1] == 100


def test_combo_starts_on_second_consecutive():
    assert score_answer(True, 10.0, 0)[2] == 0   # 第 1 题连击
    assert score_answer(True, 10.0, 1)[2] == 20  # 连续第 2 题
    assert score_answer(True, 10.0, 2)[2] == 40  # 连续第 3 题


def test_win_index_full_score_is_100():
    assert compute_win_index(5100) == 100


def test_win_index_zero():
    assert compute_win_index(0) == 0


def test_win_index_caps_at_100():
    assert compute_win_index(99999) == 100


def test_rank_labels_boundaries():
    assert rank_label(90) == "Saul-certified: Supreme Chicanery"
    assert rank_label(70) == "Worthy of answering Saul's phones"
    assert rank_label(50) == "Consult a lawyer... about consulting"
    assert rank_label(49) == "Turn yourself in"
