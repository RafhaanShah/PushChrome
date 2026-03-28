import * as storage from './storage.js';

const Page = {
    ROOT: 'root',
    LOGIN: 'login',
    MESSAGES: 'messages',
    SEND: 'send',
    SETTINGS: 'settings',
    OFFSCREEN: 'offscreen',
};

const PAGE_PATHS = {
    [Page.ROOT]: 'root.html',
    [Page.LOGIN]: 'login.html',
    [Page.MESSAGES]: 'messages.html',
    [Page.SEND]: 'send.html',
    [Page.SETTINGS]: 'settings.html',
    [Page.OFFSCREEN]: 'offscreen.html',
};

function getPagePath(page) {
    return `src/pages/${PAGE_PATHS[page]}`;
}

function getPageUrl(page) {
    return chrome.runtime.getURL(getPagePath(page));
}

function navigateTo(page, options = {}) {
    console.debug('Navigating to page:', page);
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

async function openPageInWindow(page) {
    console.debug('Opening page in window:', page);
    const url = getPageUrl(page);
    await openUrlInWindow(url);
}

async function openUrlInWindow(url) {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['TAB']
    });
    const existing = contexts.find(c => c.documentUrl?.startsWith(chrome.runtime.getURL('')));
    if (existing) {
        console.debug('Focusing existing extension window:', existing.windowId);
        await chrome.windows.update(existing.windowId, { focused: true });
        return;
    }

    console.info('Opening URL in window:', url);
    chrome.windows.create({ url, type: 'popup', width: 380, height: 720 });
}

function openUrlInTab(url) {
    console.debug('Opening URL in tab:', url);
    console.info('Opening URL in tab:', url);
    chrome.tabs.create({ url });
}

function initWindowMode() {
    const isWindow = !isPopupMode();
    if (isWindow) {
        document.body.classList.add('window-mode');
    }
}

async function createOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        return;
    }

    console.debug('Creating offscreen document');
    await chrome.offscreen.createDocument({
        url: getPageUrl(Page.OFFSCREEN),
        reasons: ['CLIPBOARD'],
        justification: 'Copy notification message to clipboard'
    });
}

async function hasOffscreenDocument() {
    if ('getContexts' in chrome.runtime) {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            // documentUrls: [OFFSCREEN_DOCUMENT_PATH]
        });
        return Boolean(contexts.length);
    }

    const matchedClients = await clients.matchAll();
    return matchedClients.some(client => {
        return client.url.includes(chrome.runtime.id);
    });
}

async function closeOffscreenDocument() {
    if (!await hasOffscreenDocument()) {
        return;
    }

    console.info('Closing offscreen document');
    await chrome.offscreen.closeDocument();
}

async function isPageOpen(page) {
    try {
        const views = await chrome.runtime.getContexts({
            contextTypes: ['TAB', 'POPUP']
        });
        return views.some(v => v.documentUrl?.includes(PAGE_PATHS[page]));
    } catch {
        return false;
    }
}

export {
    Page,
    getPagePath,
    navigateTo,
    isPopupMode,
    openPageInWindow,
    openUrlInWindow,
    openUrlInTab,
    initWindowMode,
    createOffscreenDocument,
    closeOffscreenDocument,
    isPageOpen,
};
