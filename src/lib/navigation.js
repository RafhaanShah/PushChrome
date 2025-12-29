const Page = {
    LOGIN: 'login',
    MESSAGES: 'messages',
    SEND: 'send',
    SETTINGS: 'settings',
};

const PAGE_PATHS = {
    [Page.LOGIN]: 'login.html',
    [Page.MESSAGES]: 'messages.html',
    [Page.SEND]: 'send.html',
    [Page.SETTINGS]: 'settings.html',
};

const POPUP_PAGE_PATHS = {
    [Page.LOGIN]: '../pages/login.html',
    [Page.MESSAGES]: '../pages/messages.html',
    [Page.SEND]: '../pages/send.html',
    [Page.SETTINGS]: '../pages/settings.html',
};

function navigateTo(page, options = {}) {
    const { replace = false, fromPopup = false, newWindow = false } = options;
    const path = fromPopup ? POPUP_PAGE_PATHS[page] : PAGE_PATHS[page];

    if (newWindow) {
        chrome.windows.create({ url: chrome.runtime.getURL(`src/pages/${PAGE_PATHS[page]}`), type: 'popup' });
        return;
    }

    if (replace) {
        window.location.replace(path);
    } else {
        window.location.href = path;
    }
}

function isPopupMode() {
    return window.innerWidth < 1000 && window.innerHeight < 1000;
}

function getPopupUrl() {
    return chrome.runtime.getURL('src/popup/popup.html');
}

function openInWindow(page) {
    const url = page ? chrome.runtime.getURL(`src/pages/${PAGE_PATHS[page]}`) : getPopupUrl();
    chrome.windows.create({ url, type: 'popup' });
    window.close();
}

function openPopupInWindow() {
    chrome.windows.create({ url: getPopupUrl(), type: 'popup' });
}

function openUrlInWindow(url) {
    chrome.windows.create({ url, type: 'popup' });
}

function initWindowMode() {
    if (!isPopupMode()) {
        document.body.classList.add('window-mode');
    }
}

export {
    Page,
    navigateTo,
    isPopupMode,
    getPopupUrl,
    openInWindow,
    openPopupInWindow,
    openUrlInWindow,
    initWindowMode,
};
