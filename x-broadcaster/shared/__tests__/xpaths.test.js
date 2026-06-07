const xpaths = require('../xpaths.js');

describe('xpaths', () => {
  describe('queryElement', () => {
    test('returns element matching primary selector', () => {
      document.body.innerHTML = `
        <div>
          <span data-testid="UserName">@testuser</span>
        </div>
      `;
      const el = xpaths.queryElement('search.userCard.handle', document.body);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe('@testuser');
    });

    test('falls back to secondary selector when primary fails', () => {
      document.body.innerHTML = `
        <div>
          <a href="/testuser" role="link">
            <span>Test User</span>
            <span class="css-1jxf684">@testuser</span>
          </a>
        </div>
      `;
      const el = xpaths.queryElement('search.userCard.handle', document.body);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe('@testuser');
    });

    test('returns null when both selectors fail', () => {
      document.body.innerHTML = '<div></div>';
      const el = xpaths.queryElement('search.userCard.handle', document.body);
      expect(el).toBeNull();
    });

    test('queryAll returns all matching elements', () => {
      document.body.innerHTML = `
        <div>
          <div data-testid="UserCell">User A</div>
          <div data-testid="UserCell">User B</div>
          <div data-testid="UserCell">User C</div>
        </div>
      `;
      const els = xpaths.queryAll('search.userCell', document.body);
      expect(els).toHaveLength(3);
    });

    test('getSelector returns primary selector string', () => {
      const sel = xpaths.getSelector('search.userCard.handle');
      expect(sel).toBe('[data-testid="UserName"]');
    });
  });

  describe('selectors registry', () => {
    test('every registered selector has a primary and fallback', () => {
      const names = xpaths.listSelectors();
      expect(names.length).toBeGreaterThan(10);
      for (const name of names) {
        const entry = xpaths.getEntry(name);
        expect(entry.primary).toBeTruthy();
        expect(entry.fallback).toBeTruthy();
      }
    });
  });
});
