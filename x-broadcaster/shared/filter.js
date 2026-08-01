/**
 * Two-stage user filter engine.
 *
 * Stage 1 (Quick): runs on search page — cheap checks.
 * Stage 2 (Detailed): runs after profile page visit.
 */

const CURRENT_YEAR = new Date().getFullYear();

function stage1QuickFilter(user, rules = {}) {
  if (rules.requireAvatar && !user.hasAvatar) return false;
  if (rules.requireBio && !user.hasBio) return false;
  if (rules.minAccountAgeYears && user.joinYear) {
    if (CURRENT_YEAR - user.joinYear < rules.minAccountAgeYears) return false;
  }
  return true;
}

function stage2DetailedFilter(user, rules = {}) {
  if (rules.minFollowers && user.followers < rules.minFollowers) return false;
  if (rules.maxFollowRatio && user.followers > 0) {
    if (user.following / user.followers > rules.maxFollowRatio) return false;
  }
  if (rules.topicKeywords && rules.topicKeywords.length > 0) {
    if (!user.postTopics || user.postTopics.length === 0) return false;
    const hasMatch = rules.topicKeywords.some((kw) =>
      user.postTopics.some((t) => t.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!hasMatch) return false;
  }
  if (rules.requireDmsOpen && user.dmsOpen === false) return false;
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stage1QuickFilter, stage2DetailedFilter };
}
