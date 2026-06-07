const templates = require('../templates.js');

describe('templates', () => {
  describe('resolve', () => {
    test('replaces variable placeholders with values', () => {
      const result = templates.resolve(
        'Hi {username}! Check out {topic}.',
        { username: 'johndoe', topic: 'AI tools' }
      );
      expect(result).toBe('Hi johndoe! Check out AI tools.');
    });

    test('returns template unchanged when no variables present', () => {
      const result = templates.resolve('Hello, just saying hi.', { username: 'johndoe' });
      expect(result).toBe('Hello, just saying hi.');
    });

    test('leaves placeholder intact when variable value missing', () => {
      const result = templates.resolve('Hi {username}, see {topic}!', { username: 'johndoe' });
      expect(result).toBe('Hi johndoe, see {topic}!');
    });

    test('replaces all occurrences of same variable', () => {
      const result = templates.resolve(
        '{username} here — follow @{username} for {topic}',
        { username: 'johndoe', topic: 'updates' }
      );
      expect(result).toBe('johndoe here — follow @johndoe for updates');
    });
  });

  describe('pickVariant', () => {
    test('returns one of the provided variants', () => {
      const variants = ['Hi {username}!', 'Hey {username}.', '{username} — check this.'];
      for (let i = 0; i < 50; i++) {
        const picked = templates.pickVariant(variants);
        expect(variants).toContain(picked);
      }
    });

    test('returns the single variant if only one provided', () => {
      expect(templates.pickVariant(['Only option'])).toBe('Only option');
    });

    test('returns empty string for empty array', () => {
      expect(templates.pickVariant([])).toBe('');
    });
  });

  describe('buildMessage', () => {
    test('picks random variant and resolves variables', () => {
      const variants = ['Hi {username}! {link}', 'Hey {username}, see {link}'];
      const vars = { username: 'johndoe', link: 'https://example.com' };
      const possible = [
        'Hi johndoe! https://example.com',
        'Hey johndoe, see https://example.com',
      ];
      expect(possible).toContain(templates.buildMessage(variants, vars));
    });
  });
});
