const filter = require('../filter.js');

describe('filter', () => {
  describe('stage1QuickFilter (search page)', () => {
    test('passes user with avatar, bio, meets age threshold', () => {
      const user = { handle: '@test', hasAvatar: true, hasBio: true, joinYear: 2020 };
      expect(filter.stage1QuickFilter(user, { requireAvatar: true, requireBio: true, minAccountAgeYears: 1 })).toBe(true);
    });

    test('rejects user without avatar', () => {
      const user = { handle: '@test', hasAvatar: false, hasBio: true };
      expect(filter.stage1QuickFilter(user, { requireAvatar: true, requireBio: true })).toBe(false);
    });

    test('rejects user without bio', () => {
      const user = { handle: '@test', hasAvatar: true, hasBio: false };
      expect(filter.stage1QuickFilter(user, { requireAvatar: true, requireBio: true })).toBe(false);
    });

    test('passes user when requirements disabled', () => {
      const user = { handle: '@test', hasAvatar: false, hasBio: false };
      expect(filter.stage1QuickFilter(user, { requireAvatar: false, requireBio: false })).toBe(true);
    });

    test('rejects account younger than minAccountAgeYears', () => {
      const user = { handle: '@test', hasAvatar: true, hasBio: true, joinYear: 2026 };
      expect(filter.stage1QuickFilter(user, { requireAvatar: false, requireBio: false, minAccountAgeYears: 1 })).toBe(false);
    });

    test('passes when joinYear is unknown (null)', () => {
      const user = { handle: '@test', hasAvatar: true, hasBio: true, joinYear: null };
      expect(filter.stage1QuickFilter(user, { requireAvatar: false, requireBio: false, minAccountAgeYears: 1 })).toBe(true);
    });
  });

  describe('stage2DetailedFilter (profile page)', () => {
    const baseUser = { handle: '@test', followers: 500, following: 200, postTopics: ['AI', 'startup', 'tech'], joinYear: 2020, dmsOpen: true };

    test('passes user meeting all thresholds', () => {
      expect(filter.stage2DetailedFilter(baseUser, { minFollowers: 100, maxFollowRatio: 3.0, topicKeywords: ['AI', 'tech'], requireDmsOpen: true })).toBe(true);
    });

    test('rejects user below minFollowers', () => {
      expect(filter.stage2DetailedFilter(baseUser, { minFollowers: 1000 })).toBe(false);
    });

    test('rejects user with too high following/follower ratio', () => {
      expect(filter.stage2DetailedFilter({ ...baseUser, following: 2000, followers: 100 }, { maxFollowRatio: 3.0 })).toBe(false);
    });

    test('rejects user with no topic keyword match', () => {
      expect(filter.stage2DetailedFilter(baseUser, { topicKeywords: ['cooking', 'fashion'] })).toBe(false);
    });

    test('passes when topicKeywords is empty', () => {
      expect(filter.stage2DetailedFilter(baseUser, { topicKeywords: [] })).toBe(true);
    });

    test('rejects user with DMs closed when requireDmsOpen true', () => {
      expect(filter.stage2DetailedFilter({ ...baseUser, dmsOpen: false }, { requireDmsOpen: true })).toBe(false);
    });

    test('passes user with DMs closed when requireDmsOpen false', () => {
      expect(filter.stage2DetailedFilter({ ...baseUser, dmsOpen: false }, { requireDmsOpen: false })).toBe(true);
    });

    test('undefined rules default to permissive', () => {
      expect(filter.stage2DetailedFilter(baseUser, {})).toBe(true);
    });
  });
});
