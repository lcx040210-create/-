const behavior = require('../behavior.js');

describe('behavior', () => {
  describe('randomScrollDelta', () => {
    test('returns value within given range', () => {
      for (let i = 0; i < 30; i++) {
        const delta = behavior.randomScrollDelta(200, 500);
        expect(delta).toBeGreaterThanOrEqual(200);
        expect(delta).toBeLessThanOrEqual(500);
      }
    });
  });

  describe('randomPauseMs', () => {
    test('returns value within given range', () => {
      for (let i = 0; i < 30; i++) {
        const ms = behavior.randomPauseMs(1000, 3000);
        expect(ms).toBeGreaterThanOrEqual(1000);
        expect(ms).toBeLessThanOrEqual(3000);
      }
    });
  });

  describe('typingDelays', () => {
    test('returns array of delays, one per character', () => {
      const delays = behavior.typingDelays('Hello', { minMs: 50, maxMs: 150 });
      expect(delays).toHaveLength(5);
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(50);
        expect(d).toBeLessThanOrEqual(150);
      }
    });

    test('adds extra pause after punctuation', () => {
      const delays = behavior.typingDelays('Hi!', { minMs: 50, maxMs: 100 });
      expect(delays).toHaveLength(3);
      expect(delays[2]).toBeGreaterThanOrEqual(50);
    });

    test('returns empty array for empty text', () => {
      expect(behavior.typingDelays('', { minMs: 50, maxMs: 100 })).toEqual([]);
    });
  });

  describe('easeInOutCubic', () => {
    test('returns 0 at t=0', () => {
      expect(behavior.easeInOutCubic(0)).toBeCloseTo(0);
    });

    test('returns 1 at t=1', () => {
      expect(behavior.easeInOutCubic(1)).toBeCloseTo(1);
    });

    test('returns 0.5 at t=0.5', () => {
      expect(behavior.easeInOutCubic(0.5)).toBeCloseTo(0.5);
    });
  });
});
