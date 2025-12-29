// Pushover Chrome Extension - Popup Entry Point
// Routes to the appropriate page based on auth state

import * as storage from '../lib/storage.js';
import { Page, navigateTo } from '../lib/navigation.js';

async function init() {
  const loggedIn = await storage.isLoggedIn();
  
  if (loggedIn) {
    navigateTo(Page.MESSAGES, { replace: true, fromPopup: true });
    return;
  }
  
  // Check for pending login (user closed popup during login flow)
  const pendingLogin = await storage.getPendingLogin();
  if (pendingLogin) {
    navigateTo(Page.LOGIN, { replace: true, fromPopup: true });
    return;
  }
  
  const sendOnlyMode = await storage.isSendOnlyMode();
  if (sendOnlyMode) {
    navigateTo(Page.SEND, { replace: true, fromPopup: true });
    return;
  }
  
  navigateTo(Page.LOGIN, { replace: true, fromPopup: true });
}

init();
