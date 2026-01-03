import { logger } from './logger.js';
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
    logger.info('Navigating to page:', page);
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
}

function openUrlInWindow(url) {
    logger.info('Opening URL in window:', url);
    chrome.windows.create({ url, type: 'popup' });
}

function openUrlInTab(url) {
    logger.info('Opening URL in tab:', url);
    chrome.tabs.create({ url });
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

async function createOffscreenDocument() {
    if(await hasOffscreenDocument()) {
        return;
    }
    
    logger.info('Creating offscreen document');
    await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('src/pages/offscreen.html'),
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
    
    logger.info('Closing offscreen document');
    await chrome.offscreen.closeDocument();
}

export {
    Page,
    navigateTo,
    isPopupMode,
    openPageInWindow,
    openUrlInWindow,
    openUrlInTab,
    initWindowMode,
    createOffscreenDocument,
    closeOffscreenDocument,
};
