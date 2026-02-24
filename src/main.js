const { app, nativeTheme } = require('electron');
const log = require('electron-log/main');
const path = require('path');
const store = require('./main/store');
const { setupIpcHandlers } = require('./main/ipc-handlers');
const { createWindow, createSplashWindow, getMainWindow } = require('./main/window-manager');
const { setupMenu } = require('./main/menu-manager');
const { monitorNetwork } = require('./main/network-monitor');

// Initialize Logging
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('KITSWebGen starting (modular)');

// Single Instance Lock
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const win = getMainWindow();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
}

// Global Security Hardening
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// App Lifecycle
app.on('ready', () => {
    // Initialize Theme from store
    const theme = store.get('theme', 'system');
    nativeTheme.themeSource = theme;
    log.info(`UI initialized with theme: ${theme}`);

    createSplashWindow();

    // Setup IPC Handlers
    setupIpcHandlers(getMainWindow);

    // Create Main Window after splash
    setTimeout(() => {
        const win = createWindow();
        setupMenu(getMainWindow);

        win.once('ready-to-show', () => {
            // Start network monitor
            monitorNetwork(win);
            log.info('App fully initialized');
        });
    }, 2500);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (getMainWindow() === null) createWindow();
});

app.on('before-quit', () => {
    if (store.get('privacySettings.clearOnExit')) {
        const { session } = require('electron');
        const ses = session.fromPartition('persist:kits-browser');
        ses.clearCache();
        ses.clearStorageData();
    }
});

process.on('uncaughtException', (err) => log.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => log.error('Unhandled Rejection:', reason));
