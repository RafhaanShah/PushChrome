// Pushover Chrome Extension - Entry Point
// Routes to the appropriate page based on auth state

import * as storage from '../lib/storage.js';
import { Page, navigateTo } from '../lib/navigation.js';

async function init() {
  console.info('Root page initialized');
  const loggedIn = await storage.isLoggedIn();
  
  if (loggedIn) {
    console.info('Routing to messages (logged in)');
    navigateTo(Page.MESSAGES, { replace: true });
    return;
  }
  
  // Check for pending login (user closed popup during login flow)
  const pendingLogin = await storage.getPendingLogin();
  if (pendingLogin) {
    console.info('Routing to login (pending login)');
    navigateTo(Page.LOGIN, { replace: true });
    return;
  }
  
  const sendOnlyMode = await storage.isSendOnlyMode();
  if (sendOnlyMode) {
    console.info('Routing to send (send-only mode)');
    navigateTo(Page.SEND, { replace: true });
    return;
  }
  
  console.info('Routing to login (default)');
  navigateTo(Page.LOGIN, { replace: true });
}

init();
