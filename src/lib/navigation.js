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
    const { replace = false, fromPopup = false, newTab = false } = options;
    const path = fromPopup ? POPUP_PAGE_PATHS[page] : PAGE_PATHS[page];

    if (newTab) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`src/pages/${PAGE_PATHS[page]}`) });
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

function openInTab() {
    chrome.tabs.create({ url: getPopupUrl() });
    window.close();
}

function openPopupInTab() {
    chrome.tabs.create({ url: getPopupUrl() });
}

function openUrlInTab(url) {
    chrome.tabs.create({ url });
}

function initTabMode() {
    if (!isPopupMode()) {
        document.body.classList.add('tab-mode');
    }
}

export {
    Page,
    navigateTo,
    isPopupMode,
    getPopupUrl,
    openInTab,
    openPopupInTab,
    openUrlInTab,
    initTabMode,
};
