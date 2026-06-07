/**
 * Wraps chrome.storage.local with promise-based get/set/remove.
 * Values are automatically JSON-serialized on set and parsed on get.
 * Plain strings pass through without JSON parse failure.
 */

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const storage = {
  get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (result[key] === undefined) {
          resolve(null);
        } else {
          resolve(parseValue(result[key]));
        }
      });
    });
  },

  getMultiple(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        const parsed = {};
        for (const k of keys) {
          if (result[k] !== undefined) {
            parsed[k] = parseValue(result[k]);
          }
        }
        resolve(parsed);
      });
    });
  },

  set(key, value) {
    return new Promise((resolve) => {
      const obj = {};
      obj[key] = JSON.stringify(value);
      chrome.storage.local.set(obj, resolve);
    });
  },

  remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], resolve);
    });
  },

  async appendToList(key, items) {
    const existing = (await this.get(key)) || [];
    const updated = existing.concat(items);
    return this.set(key, updated);
  },

  async removeFromList(key, predicate) {
    const list = (await this.get(key)) || [];
    const filtered = list.filter((item) => !predicate(item));
    return this.set(key, filtered);
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = storage;
}
