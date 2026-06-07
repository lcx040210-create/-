/**
 * Scheduler for controlling the pace of automated actions.
 * All config values are in seconds; internal calculations use milliseconds.
 */

function randomInterval(minSeconds, maxSeconds) {
  if (minSeconds === maxSeconds) return minSeconds * 1000;
  const msMin = minSeconds * 1000;
  const msMax = maxSeconds * 1000;
  return Math.floor(msMin + Math.random() * (msMax - msMin));
}

function isWithinActiveHours(startHour, endHour) {
  if (startHour === undefined || endHour === undefined) return true;
  const now = new Date(Date.now());
  const hour = now.getUTCHours();
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour + 1;
  }
  return hour >= startHour || hour < endHour + 1;
}

function checkDailyCap({ sentToday, dailyLimit }) {
  const remaining = Math.max(0, dailyLimit - sentToday);
  return { canProceed: sentToday < dailyLimit, remaining };
}

function calculateCooldownMs({ baseInterval, rateLimited }) {
  const factor = rateLimited ? 2 : 1;
  return randomInterval(baseInterval.min * factor, baseInterval.max * factor);
}

function getStatusMessage({ interval, sentToday, dailyLimit, activeHours }) {
  const remaining = Math.max(0, dailyLimit - sentToday);
  const hourInfo = activeHours
    ? ` Active: ${activeHours.start}:00-${activeHours.end}:00.`
    : '';
  return `Current pace: ${interval}s per action. Today: ${sentToday}/${dailyLimit}. Remaining: ${remaining}.${hourInfo}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    randomInterval,
    isWithinActiveHours,
    checkDailyCap,
    calculateCooldownMs,
    getStatusMessage,
    sleep,
  };
}
