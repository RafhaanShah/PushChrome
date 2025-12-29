import * as storage from './storage.js';

const Page = {
    ROOT: 'root',
    LOGIN: 'login',
    MESSAGES: 'messages',
    SEND: 'send',
    SETTINGS: 'settings',
};

const PAGE_PATHS = {
    [Page.ROOT]: 'root.html',
    [Page.LOGIN]: 'login.html',
    [Page.MESSAGES]: 'messages.html',
    [Page.SEND]: 'send.html',
    [Page.SETTINGS]: 'settings.html',
};

function navigateTo(page, options = {}) {
    const { replace = false } = options;
    const path = PAGE_PATHS[page];

    if (replace) {
        window.location.replace(path);
    } else {
        window.location.href = path;
    }
}

function isPopupMode() {
    return chrome.extension.getViews({ type: 'popup' }).length > 0;
}

function openPageInWindow(page) {
    const url = chrome.runtime.getURL(`src/pages/${PAGE_PATHS[page]}`);
    openUrlInWindow(url);
    window.close();
}

function openUrlInWindow(url) {
    chrome.windows.create({ url, type: 'popup' });
}

async function initWindowMode(page, force = false) {
    const isWindow = !isPopupMode();
    if (isWindow) {
        document.body.classList.add('window-mode');
        return; // already window mode
    }

    const pop = force || await storage.getSettings().alwaysPopOut;
    if (pop) {
        openPageInWindow(page);
    }
}

export {
    Page,
    navigateTo,
    isPopupMode,
    openPageInWindow,
    openUrlInWindow,
    initWindowMode,
};
