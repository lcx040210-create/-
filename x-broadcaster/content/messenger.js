/**
 * Content script for executing DM actions on X.
 *
 * Strategy: Navigate directly to the compose URL for the recipient,
 * then type and send the message. This avoids searching for buttons
 * and recipient input fields that X changes frequently.
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

  function waitForElement(selectors, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    if (typeof selectors === 'string') selectors = [selectors];

    return new Promise(function (resolve) {
      // Try each selector
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) return resolve(el);
      }

      var observer = new MutationObserver(function () {
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            observer.disconnect();
            resolve(el);
            return;
          }
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
    element.click(); // ensure element is focused and active

    var isInput =
      element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';

    for (var i = 0; i < text.length; i++) {
      var delay = randInt(40, 120);

      if (isInput) {
        element.value = text.slice(0, i + 1);
      } else {
        element.textContent = text.slice(0, i + 1);
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      await sleep(delay);
    }
  }

  // ── DM execution ──

  async function sendDM(handle, messageText, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;

    console.log('[messenger] sendDM: ' + handle + ', current URL: ' + window.location.href);

    // Strategy 1: If we navigated to the compose URL, the message input should be visible
    // Strategy 2: Find and click the New Message button, then fill in recipient

    onProgress && onProgress('finding_input');

    // Try to find the message input field directly
    var msgInput = await waitForElement([
      '[data-testid="dmComposerTextInput"]',
      'div[data-testid="dmComposerTextInput"] [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[data-testid="tweetTextarea_0"] [contenteditable="true"]',
    ], 5000);

    // If message input not found, try multiple approaches to open composer
    if (!msgInput) {
      console.log('[messenger] Message input not found, trying keyboard shortcut "n"...');

      // Try X keyboard shortcut: 'n' opens new message dialog
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true,
      }));

      await sleep(1000);

      // Recheck for input
      msgInput = await waitForElement([
        '[data-testid="dmComposerTextInput"]',
        'div[data-testid="dmComposerTextInput"] [contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
      ], 3000);
    }

    if (!msgInput) {
      console.log('[messenger] Still no input, trying to click buttons...');

      // Click "New message" button — try multiple selectors
      var newMsgBtn =
        document.querySelector('[data-testid="newDMButton"]') ||
        document.querySelector('a[aria-label="New message"]') ||
        document.querySelector('a[href="/messages/compose"]') ||
        document.querySelector('[aria-label="New message"]') ||
        document.querySelector('[data-testid="composeButton"]');

      // Also try finding by text content
      if (!newMsgBtn) {
        var allBtns = document.querySelectorAll('a, button, div[role="button"]');
        for (var b = 0; b < allBtns.length; b++) {
          var text = allBtns[b].textContent.trim();
          var aria = allBtns[b].getAttribute('aria-label') || '';
          if (text === 'New message' || aria.indexOf('message') !== -1 || aria.indexOf('compose') !== -1) {
            newMsgBtn = allBtns[b];
            break;
          }
        }
      }

      if (newMsgBtn) {
        console.log('[messenger] Clicking new message button:', newMsgBtn.tagName, newMsgBtn.getAttribute('data-testid') || newMsgBtn.getAttribute('aria-label') || newMsgBtn.textContent.trim());
        newMsgBtn.click();
        await sleep(2000);

        // Now type the recipient
        onProgress && onProgress('typing_recipient');
        var recipientInput = await waitForElement([
          'input[placeholder*="Search people"]',
          '[data-testid="searchPeople"] input',
          'input[data-testid="searchPeople"]',
          'input[type="text"][autocomplete="off"]',
        ], 5000);

        if (recipientInput) {
          console.log('[messenger] Typing recipient: ' + handle);
          await typeHumanLike(recipientInput, handle);
          await sleep(2000);

          // Select first result
          var firstResult =
            document.querySelector('[data-testid="TypeaheadUser"]') ||
            document.querySelector('[data-testid="cellInnerDiv"]');
          if (firstResult) {
            firstResult.click();
            await sleep(1000);
          }

          // Click "Next" if present
          var nextBtn = document.querySelector('[data-testid="nextButton"]');
          if (nextBtn) {
            nextBtn.click();
            await sleep(1000);
          }
        }
      } else {
        console.log('[messenger] No new message button found. Dumping page buttons:');
        var buttons = document.querySelectorAll('a, button, [role="button"]');
        for (var i = 0; i < Math.min(buttons.length, 15); i++) {
          var t = buttons[i].textContent.trim().substring(0, 50);
          var a = buttons[i].getAttribute('aria-label') || '';
          if (t || a) console.log('  [' + i + '] aria="' + a + '" text="' + t + '"');
        }
      }

      // Wait for message input after opening composer
      msgInput = await waitForElement([
        '[data-testid="dmComposerTextInput"]',
        'div[data-testid="dmComposerTextInput"] [contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[data-testid="tweetTextarea_0"] [contenteditable="true"]',
      ], 5000);
    }

    if (!msgInput) {
      console.log('[messenger] Could not find message input after all attempts');
      return { error: 'message_input_not_found' };
    }

    // Type the message
    onProgress && onProgress('typing_message');
    console.log('[messenger] Typing message to ' + handle);
    await typeHumanLike(msgInput, messageText);
    await sleep(800);

    // Click send
    onProgress && onProgress('sending');
    var sendBtn =
      document.querySelector('[data-testid="dmComposerSendButton"]') ||
      document.querySelector('[data-testid="tweetButton"]') ||
      document.querySelector('button[data-testid="dmComposerSendButton"]') ||
      document.querySelector('div[role="button"][data-testid="dmComposerSendButton"]');

    // Also try finding by attribute
    if (!sendBtn) {
      var allBtns = document.querySelectorAll('button, div[role="button"]');
      for (var j = 0; j < allBtns.length; j++) {
        var aria = allBtns[j].getAttribute('aria-label') || '';
        var text = allBtns[j].textContent.trim();
        if (aria.indexOf('Send') !== -1 || text === 'Send') {
          sendBtn = allBtns[j];
          break;
        }
      }
    }

    if (!sendBtn) {
      console.log('[messenger] Send button not found');
      return { error: 'send_button_not_found' };
    }

    sendBtn.click();
    console.log('[messenger] Clicked send for ' + handle);
    await sleep(2000);

    console.log('[messenger] DM sent to ' + handle);
    return { status: 'sent', handle: handle };
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
          } catch (e) { /* ignore */ }
        },
      }).then(function (result) {
        try { sendResponse(result); } catch (e) { /* ignore */ }
      });
      return true;
    }

    if (message.action === 'messenger:postComment') {
      sendResponse({ error: 'not_implemented' });
      return true;
    }
  });
})();
