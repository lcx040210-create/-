// Mock chrome API before importing the module
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
  },
};

const storage = require('../storage.js');

describe('storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    test('returns parsed value for a single key', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ taskConfig: JSON.stringify({ keyword: 'test' }) });
      });

      const result = await storage.get('taskConfig');
      expect(result).toEqual({ keyword: 'test' });
    });

    test('returns null when key does not exist', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
      });

      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    test('returns raw value when JSON parse fails (plain string)', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ plainKey: 'just-a-string' });
      });

      const result = await storage.get('plainKey');
      expect(result).toBe('just-a-string');
    });
  });

  describe('set', () => {
    test('stores value as JSON string', async () => {
      chrome.storage.local.set.mockImplementation((obj, cb) => cb());

      await storage.set('taskConfig', { keyword: 'test', limit: 100 });
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { taskConfig: '{"keyword":"test","limit":100}' },
        expect.any(Function)
      );
    });
  });

  describe('remove', () => {
    test('removes a key from storage', async () => {
      chrome.storage.local.remove.mockImplementation((keys, cb) => cb());

      await storage.remove('taskConfig');
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(
        ['taskConfig'],
        expect.any(Function)
      );
    });
  });

  describe('getMultiple', () => {
    test('returns parsed object for multiple keys', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({
          a: '{"x": 1}',
          b: '{"y": 2}',
        });
      });

      const result = await storage.getMultiple(['a', 'b']);
      expect(result).toEqual({ a: { x: 1 }, b: { y: 2 } });
    });
  });

  describe('appendToList', () => {
    test('appends items to an existing list', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ myList: '["a","b"]' });
      });
      chrome.storage.local.set.mockImplementation((obj, cb) => cb());

      await storage.appendToList('myList', ['c', 'd']);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { myList: '["a","b","c","d"]' },
        expect.any(Function)
      );
    });

    test('creates new list if key does not exist', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
      });
      chrome.storage.local.set.mockImplementation((obj, cb) => cb());

      await storage.appendToList('newList', ['x']);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { newList: '["x"]' },
        expect.any(Function)
      );
    });
  });
});
