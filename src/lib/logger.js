// Pushover Chrome Extension - Logger Module
// Configurable logging with verbose mode support

const PREFIX = '[PushChrome]';

let verboseEnabled = false;
let initialized = false;

async function initLogger() {
  if (initialized) return;
  
  try {
    const result = await chrome.storage.sync.get('settings');
    verboseEnabled = result.settings?.verboseLogging ?? false;
    initialized = true;
  } catch {
    initialized = true;
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings?.newValue) {
    verboseEnabled = changes.settings.newValue.verboseLogging ?? false;
  }
});

initLogger();

function formatArgs(args) {
  return args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg) : arg
  );
}

export const logger = {
  debug(...args) {
    if (verboseEnabled) {
      console.debug(PREFIX, ...args);
    }
  },

  info(...args) {
    if (verboseEnabled) {
      console.log(PREFIX, ...args);
    }
  },

  warn(...args) {
    console.warn(PREFIX, ...args);
  },

  error(...args) {
    console.error(PREFIX, ...args);
  }
};
