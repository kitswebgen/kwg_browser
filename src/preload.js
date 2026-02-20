const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    // Window controls
    closeWindow: () => ipcRenderer.send('window-close'),
    maximizeWindow: () => ipcRenderer.send('window-max'),
    minimizeWindow: () => ipcRenderer.send('window-min'),
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),

    // AI & Automation
    aiChat: (prompt, context) => ipcRenderer.invoke('ai-chat', prompt, context),
    automateWeb: (script) => ipcRenderer.invoke('automate-web', script),
    capturePage: () => ipcRenderer.invoke('capture-page'),

    // Cache
    clearCache: (options = {}) => ipcRenderer.invoke('clear-cache-production', options),
    clearSiteData: (options = {}) => ipcRenderer.invoke('clear-site-data-production', options),

    // Events from main process
    onNewTab: (callback) => ipcRenderer.on('new-tab-from-main', (e, url) => callback(url)),
    onDownloadStatus: (callback) => ipcRenderer.on('download-status', (e, data) => callback(data)),
    onSecurityWarning: (callback) => ipcRenderer.on('security-warning', (e, data) => callback(data)),
    onMenuAction: (callback) => ipcRenderer.on('menu-action', (e, action) => callback(action)),
    onPerformSearch: (callback) => ipcRenderer.on('perform-search', (e, query) => callback(query)),
    onPowerEvent: (callback) => ipcRenderer.on('power-event', (e, data) => callback(data)),

    // Persistent Store
    storeGet: (key) => ipcRenderer.invoke('store-get', key),
    storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),

    // Account management
    accountSignup: (data) => ipcRenderer.invoke('account-signup', data),
    accountLogin: (data) => ipcRenderer.invoke('account-login', data),
    accountLogout: () => ipcRenderer.invoke('account-logout'),
    accountGetProfile: () => ipcRenderer.invoke('account-get-profile'),

    // Ad blocker
    getAdblockStats: () => ipcRenderer.invoke('get-adblock-stats'),
    toggleAdblock: (enabled) => ipcRenderer.invoke('toggle-adblock', enabled),

    // System
    getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
    printPage: () => ipcRenderer.invoke('print-page'),
    openPath: (p) => ipcRenderer.invoke('open-path', p),

    // Session
    saveSession: (tabs) => ipcRenderer.invoke('save-session', tabs),
    loadSession: () => ipcRenderer.invoke('load-session'),

    // ===== SYSTEM INTEGRATION =====
    // System Security Audit
    getSystemSecurity: () => ipcRenderer.invoke('get-system-security'),

    // Device Compatibility
    getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

    // Native OS Notifications
    sendNotification: (data) => ipcRenderer.invoke('send-notification', data),

    // Network Status
    getNetworkStatus: () => ipcRenderer.invoke('get-network-status'),

    // Power Status
    getPowerStatus: () => ipcRenderer.invoke('get-power-status'),

    // Search suggestions (omnibox)
    getSearchSuggestions: (query, engine) => ipcRenderer.invoke('search-suggestions', query, engine),

    onNetworkSpeed: (callback) => ipcRenderer.on('network-speed-update', (e, stats) => callback(stats))
});

// For compatibility with older NTP versions if any
contextBridge.exposeInMainWorld('kitsAPI', {
    performSearch: (query) => ipcRenderer.send('perform-search-from-webview', query)
});

