// tests/game.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  shuffle, drawRound, scoreAnswer, computeWinIndex, rankLabel, QUESTIONS, Game,
} from "../scripts/game.js";

test("scoreAnswer full time no streak", () => {
  assert.deepEqual(scoreAnswer(true, 10, 0), [100, 100, 0]);
});

test("scoreAnswer wrong zeroes", () => {
  assert.deepEqual(scoreAnswer(false, 5, 3), [0, 0, 0]);
});

test("combo starts on second consecutive", () => {
  assert.equal(scoreAnswer(true, 10, 1)[2], 20);
  assert.equal(scoreAnswer(true, 10, 2)[2], 40);
});

test("computeWinIndex full and cap", () => {
  assert.equal(computeWinIndex(5100), 100);
  assert.equal(computeWinIndex(99999), 100);
});

test("rankLabel boundaries", () => {
  assert.equal(rankLabel(90), "Saul-certified: Supreme Chicanery");
  assert.equal(rankLabel(49), "Turn yourself in");
});

test("drawRound draws n unique unused questions", () => {
  const used = new Set();
  const round = drawRound(QUESTIONS, used, 5);
  assert.equal(round.length, 5);
  assert.equal(new Set(round.map((q) => q.scenario)).size, 5);
});

test("QUESTIONS has at least 20 items and valid shape", () => {
  assert.ok(QUESTIONS.length >= 20);
  for (const q of QUESTIONS) {
    assert.ok(q.scenario);
    assert.ok(["choice", "judge"].includes(q.type));
    assert.ok("retort" in q);
  }
});

test("timeout on judge questions always counts as wrong", () => {
  const area = {
    innerHTML: "",
    querySelector: () => ({ addEventListener: () => {} }),
    querySelectorAll: () => [],
  };
  for (const answer of [true, false]) {
    const game = new Game(area);
    game.current = { type: "judge", answer, retort: "n/a" };
    game.secondsLeft = 0;
    game.streak = 3;
    game.total = 0;
    game.answer(-1);
    clearTimeout(game.autoNext); // 清理自动跳题的定时器，避免测试进程挂起
    assert.equal(game.total, 0, `judge answer=${answer} timeout must not score`);
    assert.equal(game.streak, 0, `judge answer=${answer} timeout must break streak`);
  }
});
