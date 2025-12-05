// Pushover Chrome Extension - Popup Entry Point
// Routes to the appropriate page based on auth state

import * as storage from '../lib/storage.js';

async function init() {
  const loggedIn = await storage.isLoggedIn();
  
  if (loggedIn) {
    window.location.replace('../pages/messages.html');
  } else {
    window.location.replace('../pages/login.html');
  }
}

init();
