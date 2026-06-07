/**
 * Human behavior simulation utilities.
 * Used by content scripts to make automated actions look human-like.
 */

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomScrollDelta(minPx, maxPx) {
  return randInt(minPx, maxPx);
}

function randomPauseMs(minMs, maxMs) {
  return randInt(minMs, maxMs);
}

function typingDelays(text, { minMs, maxMs }) {
  const PUNCTUATION_BOOST = 2.5;
  const delays = [];
  for (const ch of text) {
    let delay = randInt(minMs, maxMs);
    if (/[.,!?;:]/.test(ch)) {
      delay = Math.floor(delay * PUNCTUATION_BOOST);
    }
    delays.push(delay);
  }
  return delays;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function randomWobble() {
  return randInt(-3, 3);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    randomScrollDelta,
    randomPauseMs,
    typingDelays,
    easeInOutCubic,
    randomWobble,
  };
}
