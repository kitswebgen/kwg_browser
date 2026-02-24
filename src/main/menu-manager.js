const { Menu, Tray, app, shell, fs, nativeImage } = require('electron');
const path = require('path');
const log = require('electron-log/main');
const store = require('./store');

let tray = null;

function createApplicationMenu(mainWindow, createWindow) {
    const template = [
        {
            label: 'File', submenu: [
                { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.send('menu-action', 'new-tab') },
                { label: 'New Incognito Tab', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('menu-action', 'new-incognito-tab') },
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
                { type: 'separator' },
                { label: 'Clear Browsing Data', accelerator: 'CmdOrCtrl+Shift+Delete', click: () => mainWindow?.webContents.send('menu-action', 'clear-browsing-data') },
                { type: 'separator' },
                { label: 'Print', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.send('menu-action', 'print') },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        {
            label: 'View', submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => mainWindow?.webContents.send('menu-action', 'zoom-in') },
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => mainWindow?.webContents.send('menu-action', 'zoom-out') },
                { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.send('menu-action', 'zoom-reset') },
                { type: 'separator' },
                { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: () => mainWindow?.webContents.send('menu-action', 'find') },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
        {
            label: 'Help', submenu: [
                { label: 'About KITSWebGen', click: () => mainWindow?.webContents.send('menu-action', 'about') },
                { label: 'System Info', click: () => mainWindow?.webContents.send('menu-action', 'system-info') }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(mainWindow) {
    try {
        const iconPath = path.join(__dirname, '../renderer/icon.png');
        const trayIcon = require('fs').existsSync(iconPath)
            ? iconPath
            : nativeImage.createEmpty();

        tray = new Tray(trayIcon);
        const trayMenu = Menu.buildFromTemplate([
            { label: 'KITSWebGen', enabled: false },
            { type: 'separator' },
            { label: 'Show Window', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
            { label: 'New Tab', click: () => { mainWindow?.show(); mainWindow?.webContents.send('menu-action', 'new-tab'); } },
            { type: 'separator' },
            { label: 'System Security', click: () => { mainWindow?.show(); mainWindow?.webContents.send('menu-action', 'system-security'); } },
            { label: 'Device Info', click: () => { mainWindow?.show(); mainWindow?.webContents.send('menu-action', 'device-info'); } },
            { type: 'separator' },
            { label: 'Quit KITSWebGen', click: () => { app.isQuitting = true; app.quit(); } }
        ]);
        tray.setToolTip('KITSWebGen — Secure & Fast');
        tray.setContextMenu(trayMenu);
        tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
        log.info('[Tray] System tray created');
    } catch (e) {
        log.warn('[Tray] Could not create tray:', e.message);
    }
}

module.exports = {
    createApplicationMenu,
    createTray
};
