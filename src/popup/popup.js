// Pushover Chrome Extension - Popup Script
import { isLoggedIn } from '../lib/storage.js';

async function init() {
  const loggedIn = await isLoggedIn();
  
  if (!loggedIn) {
    window.location.href = '../pages/login.html';
    return;
  }
  
  // User is logged in - show placeholder for now (full implementation in Step 7)
  document.getElementById('content').innerHTML = `
    <p>You are logged in!</p>
    <p style="color: #666; font-size: 13px;">Message list coming in Step 7.</p>
    <button id="logout-btn" class="btn btn-secondary" style="margin-top: 12px;">Logout (for testing)</button>
  `;
  
  document.getElementById('logout-btn').addEventListener('click', async () => {
    const { clearAll } = await import('../lib/storage.js');
    await clearAll();
    window.location.href = '../pages/login.html';
  });
}

document.addEventListener('DOMContentLoaded', init);
