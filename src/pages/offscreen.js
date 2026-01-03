console.info('Initializing offscreen page');

// https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.offscreen-clipboard-write
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'copyToClipboard') {
    console.info('Offscreen page received copyToClipboard request');

    try {
      const textEl = document.querySelector('#text');
      textEl.value = request.text;
      textEl.select();
      document.execCommand('copy');

      console.info('Offscreen page executed copy command');
      sendResponse({ success: true })
    } catch (error) {
      console.error('Offscreen page failed to copy text to clipboard:', error);
      sendResponse({ success: false, error: error.message });
    }

    // does not work offscreen
    // navigator.clipboard.writeText(request.text)
    //   .then(() => sendResponse({ success: true }))
    //   .catch((error) => sendResponse({ success: false, error: error.message }));
  }
});
