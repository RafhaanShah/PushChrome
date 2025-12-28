// Pushover Chrome Extension - Popup Entry Point
// Routes to the appropriate page based on auth state

import * as storage from '../lib/storage.js';

async function init() {
  const loggedIn = await storage.isLoggedIn();
  
  if (loggedIn) {
    window.location.replace('../pages/messages.html');
    return;
  }
  
  // Check for pending login (user closed popup during login flow)
  const pendingLogin = await storage.getPendingLogin();
  if (pendingLogin) {
    window.location.replace('../pages/login.html');
    return;
  }
  
  const sendOnlyMode = await storage.isSendOnlyMode();
  if (sendOnlyMode) {
    window.location.replace('../pages/send.html');
    return;
  }
  
  window.location.replace('../pages/login.html');
}

init();
