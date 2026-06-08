/**
 * Content script for executing DM and comment actions on X.
 *
 * IMPORTANT: This script assumes the service worker has ALREADY opened the
 * correct page (messages page for DMs, post page for comments).
 * It does NOT navigate — navigation kills the content script and drops
 * the message channel.
 *
 * DM flow: Open composer → type handle → select user → type message → send
 * Comment flow: Scroll to reply → type comment → submit
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

    // X redirects /messages to /i/chat — accept either
    var isMessagesPage =
      window.location.href.indexOf('/messages') !== -1 ||
      window.location.href.indexOf('/i/chat') !== -1;

    if (!isMessagesPage) {
      console.log('[messenger] Not on messages page, current URL:', window.location.href);
      return { error: 'not_on_messages_page' };
    }

    console.log('[messenger] On messages page, opening new DM composer...');
    onProgress && onProgress('opening_composer');
    var newMsgBtn = await waitForElement('[data-testid="newDMButton"]');
    if (!newMsgBtn) {
      console.log('[messenger] DM button not found. Page has data-testids:',
        Array.from(document.querySelectorAll('[data-testid]')).slice(0, 5).map(function(e) { return e.getAttribute('data-testid'); }));
      return { error: 'dm_button_not_found' };
    }
    newMsgBtn.click();
    await sleep(1000 + Math.random() * 1000);

    onProgress && onProgress('typing_recipient');
    var recipientInput = await waitForElement(
      'input[placeholder*="Search people"], [data-testid="searchPeople"] input'
    );
    if (!recipientInput) return { error: 'recipient_input_not_found' };
    console.log('[messenger] Typing recipient: ' + handle);
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

    // Check message input exists (proves DM is possible)
    onProgress && onProgress('typing_message');
    var msgInput = await waitForElement(
      '[data-testid="dmComposerTextInput"]'
    );
    if (!msgInput) {
      // Check for specific follow-required indicators
      var bodyText = document.body.textContent;
      if (
        bodyText.indexOf('follow') !== -1 &&
        (bodyText.indexOf('message') !== -1 ||
         bodyText.indexOf('send') !== -1)
      ) {
        return { error: 'follow_required', handle: handle };
      }
      // Check for accounts that don't accept DMs
      if (
        bodyText.indexOf('This account cannot receive messages') !== -1 ||
        bodyText.indexOf('doesn\'t follow you') !== -1
      ) {
        return { error: 'dms_closed', handle: handle };
      }
      return { error: 'message_input_not_found' };
    }

    await typeHumanLike(msgInput, messageText);
    await sleep(500 + Math.random() * 500);

    onProgress && onProgress('sending');
    var sendBtn = document.querySelector(
      '[data-testid="dmComposerSendButton"]'
    );
    if (!sendBtn) return { error: 'send_button_not_found' };
    sendBtn.click();
    console.log('[messenger] Clicked send for ' + handle);

    await sleep(1500 + Math.random() * 1000);

    console.log('[messenger] DM sent to ' + handle);
    return { status: 'sent', handle: handle };
  }

  // ── Comment execution ──

  async function postComment(postUrl, commentText, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;

    // Must already be on the target post page
    if (window.location.href.indexOf('/status/') === -1) {
      return { error: 'not_on_post_page' };
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
          try {
            chrome.runtime.sendMessage({
              action: 'messenger:progress',
              step: step,
              handle: message.handle,
            });
          } catch (e) { /* ignore if disconnected */ }
        },
      }).then(function (result) {
        try { sendResponse(result); } catch (e) { /* ignore */ }
      });
      return true;
    }

    if (message.action === 'messenger:postComment') {
      postComment(message.postUrl, message.commentText, {
        onProgress: function (step) {
          try {
            chrome.runtime.sendMessage({
              action: 'messenger:progress',
              step: step,
            });
          } catch (e) { /* ignore */ }
        },
      }).then(function (result) {
        try { sendResponse(result); } catch (e) { /* ignore */ }
      });
      return true;
    }
  });
})();
