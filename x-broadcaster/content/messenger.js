/**
 * Content script for executing DM and comment actions on X.
 *
 * DM flow:
 *  1. Navigate to /messages
 *  2. Click "New message"
 *  3. Type recipient handle in search box
 *  4. Select the user from results
 *  5. Type message character-by-character (human-like)
 *  6. Click send
 *
 * Comment flow:
 *  1. Navigate to target post URL
 *  2. Scroll to reply area
 *  3. Type comment character-by-character
 *  4. Click submit
 */

(function () {
  'use strict';

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function waitForElement(selector, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function (resolve) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);

      var observer = new MutationObserver(function () {
        var el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  /**
   * Type text character by character with randomized delays.
   */
  async function typeHumanLike(element, text) {
    element.focus();

    var isInput =
      element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';

    for (var i = 0; i < text.length; i++) {
      var delay = randInt(50, 150);

      if (isInput) {
        element.value = text.slice(0, i + 1);
      } else {
        element.textContent = text.slice(0, i + 1);
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));

      await sleep(delay);
    }
  }

  // ── DM execution ──

  async function sendDM(handle, messageText, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;
    var followIfNeeded = opts.followIfNeeded;

    onProgress && onProgress('navigating');

    if (window.location.href.indexOf('/messages') === -1) {
      window.location.href = 'https://x.com/messages';
      await sleep(3000);
    }

    onProgress && onProgress('opening_composer');
    var newMsgBtn = await waitForElement('[data-testid="newDMButton"]');
    if (!newMsgBtn) return { error: 'dm_button_not_found' };
    newMsgBtn.click();
    await sleep(1000 + Math.random() * 1000);

    onProgress && onProgress('typing_recipient');
    var recipientInput = await waitForElement(
      'input[placeholder*="Search people"], [data-testid="searchPeople"] input'
    );
    if (!recipientInput) return { error: 'recipient_input_not_found' };
    await typeHumanLike(recipientInput, handle);
    await sleep(1500 + Math.random() * 1000);

    var firstResult = document.querySelector(
      '[data-testid="TypeaheadUser"]:first-child, ' +
        '[data-testid="cellInnerDiv"]:first-child'
    );
    if (firstResult) {
      firstResult.click();
      await sleep(500 + Math.random() * 500);
    }

    var nextBtn = document.querySelector('[data-testid="nextButton"]');
    if (nextBtn) {
      nextBtn.click();
      await sleep(500 + Math.random() * 500);
    }

    // Check if follow is required
    var bodyText = document.body.textContent;
    var followWarning =
      bodyText.indexOf('follow you') !== -1 ||
      bodyText.indexOf('follow') !== -1;

    if (followWarning && followIfNeeded) {
      onProgress && onProgress('following_then_dm');
      window.location.href = 'https://x.com/' + handle;
      await sleep(2000);
      var followBtn = document.querySelector(
        '[data-testid="followButton"], [aria-label*="Follow"]'
      );
      if (followBtn) {
        followBtn.click();
        await sleep(2000);
      }
      window.location.href = 'https://x.com/messages';
      await sleep(3000);
      return { error: 'follow_required_retry', handle: handle };
    }

    if (followWarning) {
      return { error: 'follow_required', handle: handle };
    }

    onProgress && onProgress('typing_message');
    var msgInput = await waitForElement(
      '[data-testid="dmComposerTextInput"]'
    );
    if (!msgInput) return { error: 'message_input_not_found' };
    await typeHumanLike(msgInput, messageText);
    await sleep(500 + Math.random() * 500);

    onProgress && onProgress('sending');
    var sendBtn = document.querySelector(
      '[data-testid="dmComposerSendButton"]'
    );
    if (!sendBtn) return { error: 'send_button_not_found' };
    sendBtn.click();

    await sleep(1500 + Math.random() * 1000);

    return { status: 'sent', handle: handle };
  }

  // ── Comment execution ──

  async function postComment(postUrl, commentText, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;

    onProgress && onProgress('navigating');

    if (window.location.href !== postUrl) {
      window.location.href = postUrl;
      await sleep(3000);
    }

    onProgress && onProgress('typing');
    var replyBox = await waitForElement(
      '[data-testid="tweetTextarea_0"] div[contenteditable], ' +
        '[data-testid="tweetTextarea_0"]'
    );
    if (!replyBox) return { error: 'reply_box_not_found' };

    replyBox.click();
    await sleep(500);

    await typeHumanLike(replyBox, commentText);
    await sleep(500 + Math.random() * 500);

    onProgress && onProgress('submitting');
    var submitBtn = document.querySelector('[data-testid="tweetButton"]');
    if (!submitBtn) return { error: 'submit_button_not_found' };
    submitBtn.click();

    await sleep(1500 + Math.random() * 1000);

    return { status: 'commented', postUrl: postUrl };
  }

  // ── Message listener ──

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'messenger:sendDM') {
      sendDM(message.handle, message.messageText, {
        followIfNeeded: message.followIfNeeded || false,
        onProgress: function (step) {
          chrome.runtime.sendMessage({
            action: 'messenger:progress',
            step: step,
            handle: message.handle,
          });
        },
      }).then(function (result) {
        sendResponse(result);
      });
      return true;
    }

    if (message.action === 'messenger:postComment') {
      postComment(message.postUrl, message.commentText, {
        onProgress: function (step) {
          chrome.runtime.sendMessage({
            action: 'messenger:progress',
            step: step,
          });
        },
      }).then(function (result) {
        sendResponse(result);
      });
      return true;
    }
  });
})();
