const { BrowserWindow, app } = require('electron');
const path = require('path');
const log = require('electron-log/main');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');
const { userAgent } = require('./constants');
const { configureSession, installGlobalSecurityHooks, setMainWindow } = require('./session-manager');

let mainWindow = null;
let splashWindow = null;

function getMainWindow() {
    return mainWindow;
}

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        fullscreen: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));
    splashWindow.once('ready-to-show', () => splashWindow.show());
    splashWindow.on('closed', () => { splashWindow = null; });
}

function createWindow() {
    const savedBounds = store.get('windowBounds');
    const sessionId = uuidv4();
    store.set('sessionId', sessionId);

    mainWindow = new BrowserWindow({
        width: savedBounds.width,
        height: savedBounds.height,
        x: savedBounds.x,
        y: savedBounds.y,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
        trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
        backgroundColor: '#1E1F22',
        show: false,
        title: 'KITSWebGen',
        icon: path.join(__dirname, '../renderer/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload.js'),
            webviewTag: true,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            backgroundThrottling: false,
            spellcheck: true,
            partition: 'persist:kits-browser',
            enableWebSQL: false,
            v8CacheOptions: 'bypassHeatCheck'
        }
    });

    setMainWindow(mainWindow);
    installGlobalSecurityHooks();
    configureSession('persist:kits-browser');
    configureSession('incognito');

    mainWindow.webContents.setUserAgent(userAgent);
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    if (store.get('isMaximized')) mainWindow.maximize();

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        log.info('Main window ready');
    });

    const saveWindowState = () => {
        if (!mainWindow) return;
        store.set('isMaximized', mainWindow.isMaximized());
        if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
            store.set('windowBounds', mainWindow.getBounds());
        }
    };
    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);

    mainWindow.on('closed', () => {
        mainWindow = null;
        setMainWindow(null);
    });

    return mainWindow;
}

module.exports = {
    createWindow,
    createSplashWindow,
    getMainWindow
};
