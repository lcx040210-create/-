/**
 * Message template engine.
 * Supports variable substitution and random variant selection.
 */

const VAR_REGEX = /\{(\w+)\}/g;

function resolve(template, vars) {
  return template.replace(VAR_REGEX, (match, varName) => {
    return vars[varName] !== undefined ? vars[varName] : match;
  });
}

function pickVariant(variants) {
  if (!variants || variants.length === 0) return '';
  if (variants.length === 1) return variants[0];
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx];
}

function buildMessage(variants, vars) {
  const template = pickVariant(variants);
  return resolve(template, vars);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolve, pickVariant, buildMessage };
}
