// Pushover Chrome Extension - Popup Script
import { isLoggedIn } from '../lib/storage.js';
import { $ } from '../lib/utils.js';

async function init() {
  const loggedIn = await isLoggedIn();
  
  if (!loggedIn) {
    window.location.href = '../pages/login.html';
    return;
  }
  
  // Bind settings button
  $('#settings-btn').addEventListener('click', () => {
    window.location.href = '../pages/settings.html';
  });
  
  // User is logged in - show placeholder for now (full implementation in Step 7)
  $('#content').innerHTML = `
    <p>You are logged in!</p>
    <p style="color: #666; font-size: 13px;">Message list coming in Step 7.</p>
  `;
}

document.addEventListener('DOMContentLoaded', init);
