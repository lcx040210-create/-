let mockNow = 1700000000000;
global.Date.now = () => mockNow;

const scheduler = require('../scheduler.js');

describe('scheduler', () => {
  describe('randomInterval', () => {
    test('returns value within configured range', () => {
      for (let i = 0; i < 50; i++) {
        const ms = scheduler.randomInterval(30, 60);
        expect(ms).toBeGreaterThanOrEqual(30000);
        expect(ms).toBeLessThanOrEqual(60000);
      }
    });

    test('returns fixed value when min equals max', () => {
      expect(scheduler.randomInterval(10, 10)).toBe(10000);
    });
  });

  describe('isWithinActiveHours', () => {
    test('returns true when current hour is within window', () => {
      mockNow = new Date('2024-01-15T10:00:00Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(true);
    });

    test('returns false when current hour is outside window', () => {
      mockNow = new Date('2024-01-15T03:00:00Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(false);
    });

    test('returns true at boundary (start hour)', () => {
      mockNow = new Date('2024-01-15T09:00:00Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(true);
    });

    test('returns true at boundary (end hour)', () => {
      mockNow = new Date('2024-01-15T23:59:59Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(true);
    });
  });

  describe('checkDailyCap', () => {
    test('canProceed=true when under daily limit', () => {
      expect(scheduler.checkDailyCap({ sentToday: 45, dailyLimit: 200 }).canProceed).toBe(true);
    });

    test('canProceed=false when at daily limit', () => {
      expect(scheduler.checkDailyCap({ sentToday: 200, dailyLimit: 200 }).canProceed).toBe(false);
    });

    test('returns remaining count', () => {
      expect(scheduler.checkDailyCap({ sentToday: 180, dailyLimit: 200 }).remaining).toBe(20);
    });
  });

  describe('calculateCooldownMs', () => {
    test('doubles interval when rateLimited', () => {
      const result = scheduler.calculateCooldownMs({
        baseInterval: { min: 30, max: 60 },
        rateLimited: true,
      });
      expect(result).toBeGreaterThanOrEqual(60000);
      expect(result).toBeLessThanOrEqual(120000);
    });

    test('uses base interval when not rateLimited', () => {
      const result = scheduler.calculateCooldownMs({
        baseInterval: { min: 30, max: 60 },
        rateLimited: false,
      });
      expect(result).toBeGreaterThanOrEqual(30000);
      expect(result).toBeLessThanOrEqual(60000);
    });
  });

  describe('getStatusMessage', () => {
    test('returns formatted status string', () => {
      const msg = scheduler.getStatusMessage({
        interval: 45,
        sentToday: 120,
        dailyLimit: 200,
        activeHours: { start: 9, end: 23 },
      });
      expect(msg).toContain('45s');
      expect(msg).toContain('120');
      expect(msg).toContain('200');
      expect(msg).toContain('80');
    });
  });
});
