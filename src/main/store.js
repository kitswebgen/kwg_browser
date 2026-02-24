const Store = require('electron-store');
const log = require('electron-log/main');

const store = new Store({
    name: 'kits-config',
    defaults: {
        windowBounds: { width: 1366, height: 900, x: undefined, y: undefined },
        isMaximized: false,
        searchEngine: 'google',
        adBlockEnabled: true,
        privacySettings: {
            blockThirdPartyCookies: true,
            doNotTrack: true,
            httpsUpgrade: true,
            fingerprintProtection: true
        },
        sitePermissions: {},
        zoomLevels: {}
    },
    encryptionKey: 'kits-browser-2024-secure',
    clearInvalidConfig: true
});

log.info(`Config initialized: ${store.path}`);

module.exports = store;
