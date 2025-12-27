// Tab Mode - Shared module for detecting and applying tab mode styling

import { isPopupMode } from './utils.js';

export function initTabMode() {
  if (!isPopupMode()) {
    document.body.classList.add('tab-mode');
  }
}
