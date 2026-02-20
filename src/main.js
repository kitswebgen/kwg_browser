// ===========================================================
// KITSWebGen — Production Main Process v4.0
// Security Hardened + Chromium Features + Maximum Functionality
// ===========================================================

const { app, BrowserWindow, session, ipcMain, Menu, Tray, shell, dialog, nativeTheme, clipboard, globalShortcut, screen, Notification, powerMonitor, net } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const https = require('https');

// --- Advanced Packages ---
const Store = require('electron-store');
const log = require('electron-log/main');
const { v4: uuidv4 } = require('uuid');
const sanitizeHtml = require('sanitize-html');
const cron = require('node-cron');
const contextMenu = require('electron-context-menu');

// Initialize Context Menu
contextMenu({
    showSearchWithGoogle: false,
    showCopyImage: true,
    showSaveImageAs: true,
    showInspectElement: true,
    append: (defaultActions, parameters, browserWindow) => [
        {
            label: 'Search with ' + (store.get('searchEngine') || 'Google').toUpperCase(),
            visible: parameters.selectionText.trim().length > 0,
            click: () => {
                const query = parameters.selectionText;
                browserWindow.webContents.send('perform-search', query);
            }
        }
    ]
});

// ===========================================================
//  1. LOGGING SYSTEM
// ===========================================================
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.info('======================================');
log.info(`KITSWebGen v${app.getVersion()} starting`);
log.info(`Platform: ${process.platform} | Arch: ${process.arch} | Node: ${process.versions.node}`);
log.info(`Electron: ${process.versions.electron} | Chrome: ${process.versions.chrome}`);
log.info('======================================');
Object.assign(console, log.functions);

// ===========================================================
//  2. PERSISTENT STORE
// ===========================================================
const store = new Store({
    name: 'kits-config',
    defaults: {
        windowBounds: { width: 1366, height: 900, x: undefined, y: undefined },
        isMaximized: false,
        searchEngine: 'google',
        adBlockEnabled: true,
        httpsUpgrade: true,
        adBlockStats: { totalBlocked: 0 },
        theme: 'dark',
        userProfile: null,
        accounts: [],
        bookmarks: [],
        downloadHistory: [],
        lastSession: { tabs: [], timestamp: null },
        firstRun: true,
        privacySettings: {
            doNotTrack: true,
            blockThirdPartyCookies: true,
            clearOnExit: false,
            fingerprintProtection: true
        },
        sitePermissions: {},
        zoomLevels: {}
    },
    encryptionKey: 'kits-browser-2024-secure',
    clearInvalidConfig: true
});
log.info(`Config: ${store.path}`);

// ===========================================================
//  3. SECURITY: Password Hashing (PBKDF2)
// ===========================================================
function hashPassword(password, salt = null) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { hash, salt };
}
function verifyPassword(password, storedHash, storedSalt) {
    const { hash } = hashPassword(password, storedSalt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

// ===========================================================
//  4. SANITIZATION
// ===========================================================
function sanitize(text) {
    if (!text || typeof text !== 'string') return '';
    return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {}, disallowedTagsMode: 'recursiveEscape' }).substring(0, 500);
}

// ===========================================================
//  5. EXTENDED AD / TRACKER BLOCK LIST
// ===========================================================
const adBlockList = [
    'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
    'moatads.com', 'taboola.com', 'outbrain.com', 'adroll.com',
    'pubmatic.com', 'rubiconproject.com', 'openx.net', 'appnexus.com',
    'criteo.com', 'amazon-adsystem.com', 'adnxs.com', 'casalemedia.com',
    'quantserve.com', 'scorecardresearch.com', 'hotjar.com',
    'mixpanel.com', 'segment.io', 'amplitude.com',
    'smartadserver.com', 'adsrvr.org', 'demdex.net', 'yieldmo.com',
    'sharethis.com', 'addthis.com', 'adobedtm.com',
    'tracking.', 'pixel.', 'beacon.', 'analytics.',
    'adservice.google.com', 'pagead2.googlesyndication.com',
    'tpc.googlesyndication.com', 'ad.doubleclick.net',
    'static.ads-twitter.com', 'ads.linkedin.com',
    'facebook.com/tr', 'connect.facebook.net/en_US/fbevents',
    'bat.bing.com', 'sc-static.net', 'sentry.io',
    'ads.tiktok.com', 'analytics.tiktok.com', 'pixel.reddit.com',
    'ads.pinterest.com', 'ct.pinterest.com', 'c.bing.com',
    'ads-api.twitter.com', 'static.ads-twitter.com',
    'ads.yahoo.com', 'analytics.yahoo.com', 'gemini.yahoo.com',
    'ad.mail.ru', 'top-fwz1.mail.ru', 'counter.yadro.ru'
];
const adBlockSet = new Set(adBlockList);

// Dangerous URL patterns
const dangerousProtocols = ['javascript:', 'vbscript:', 'data:text/html', 'file:'];
let sessionBlockCount = 0;

// ===========================================================
//  6. CONTEXT MENU
// ===========================================================
contextMenu({
    showSaveImageAs: true,
    showCopyImageAddress: true,
    showCopyImage: true,
    showInspectElement: true,
    showSelectAll: true,
    showCopyLink: true,
    prepend: (defaultActions, parameters) => [
        {
            label: `Search Google for "${sanitize(parameters.selectionText).substring(0, 30)}"`,
            visible: parameters.selectionText.trim().length > 0,
            click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(parameters.selectionText)}`)
        },
        {
            label: 'Copy URL',
            visible: parameters.linkURL.length > 0,
            click: () => clipboard.writeText(parameters.linkURL)
        }
    ]
});

// ===========================================================
//  7. CHROMIUM SECURITY SWITCHES
// ===========================================================
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('enable-features', 'PlatformEncryptedMediaKey,SharedArrayBuffer,WebAssembly');
// Security hardening
app.commandLine.appendSwitch('enable-strict-mixed-content-checking');
app.commandLine.appendSwitch('disable-reading-from-canvas');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
// GPU acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// WebRTC security
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check');
// V8 optimizations
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// ===========================================================
//  8. MAIN WINDOW
// ===========================================================
let mainWindow;
let splashWindow;
let tray = null;
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Ensure single-instance to avoid IndexedDB/Quota DB locks and duplicate sessions.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        try {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        } catch (_) { }
    });
}

// Google Safe Browsing-like URL check
const unsafeUrlPatterns = [
    /phishing/i, /malware/i, /scam/i, /fake-login/i,
    /steal-password/i, /credential-harvest/i,
    /bit\.ly\/.*login/i, /tinyurl\.com\/.*account/i
];
function checkUrlSafety(url) {
    for (const pattern of unsafeUrlPatterns) {
        if (pattern.test(url)) return { safe: false, reason: 'Suspected phishing or malware URL' };
    }
    return { safe: true };
}

// ===========================================================
//  Session Hardening (persist + incognito)
// ===========================================================
const configuredPartitions = new Set();
const runtimePermissionCache = new Map(); // key -> boolean (non-persisted decisions)
let permissionPromptQueue = Promise.resolve();

function safeUrlOrigin(url) {
    try { return new URL(String(url || '')).origin; } catch (_) { return ''; }
}

function safeUrlHost(url) {
    try { return new URL(String(url || '')).hostname || ''; } catch (_) { return ''; }
}

function normalizePermissionKey(permission) {
    return String(permission || '').toLowerCase();
}

function getStoredPermission(origin, permission) {
    if (!origin) return undefined;
    const all = store.get('sitePermissions', {});
    const perOrigin = all && typeof all === 'object' ? all[origin] : null;
    if (!perOrigin || typeof perOrigin !== 'object') return undefined;
    const key = normalizePermissionKey(permission);
    const v = perOrigin[key];
    return typeof v === 'boolean' ? v : undefined;
}

function setStoredPermission(origin, permission, allowed) {
    if (!origin) return;
    const all = store.get('sitePermissions', {});
    const next = all && typeof all === 'object' ? { ...all } : {};
    const perOrigin = next[origin] && typeof next[origin] === 'object' ? { ...next[origin] } : {};
    const key = normalizePermissionKey(permission);
    perOrigin[key] = !!allowed;
    next[origin] = perOrigin;
    store.set('sitePermissions', next);
}

function permissionDisplayName(permission) {
    const p = String(permission || '').toLowerCase();
    if (p === 'media') return 'Camera / Microphone';
    if (p === 'geolocation') return 'Location';
    if (p === 'notifications') return 'Notifications';
    if (p === 'clipboard-read') return 'Clipboard Read';
    if (p === 'display-capture') return 'Screen Capture';
    if (p === 'pointerlock') return 'Pointer Lock';
    if (p === 'fullscreen') return 'Fullscreen';
    return permission;
}

async function promptPermission({ partition, permission, requestingUrl }) {
    const origin = safeUrlOrigin(requestingUrl);
    const host = safeUrlHost(requestingUrl) || origin || 'this site';
    const permKey = normalizePermissionKey(permission);

    // Runtime cache first (avoids re-prompting in the same session).
    const runtimeKey = `${partition}|${origin}|${permKey}`;
    if (runtimePermissionCache.has(runtimeKey)) return runtimePermissionCache.get(runtimeKey);

    // Persisted decisions (not for incognito).
    const isIncognito = partition === 'incognito';
    if (!isIncognito) {
        const stored = getStoredPermission(origin, permKey);
        if (typeof stored === 'boolean') return stored;
    }

    // Ensure we don't stack multiple permission dialogs at once.
    permissionPromptQueue = permissionPromptQueue.then(async () => {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const permName = permissionDisplayName(permKey);
        const detail = `Allow ${permName} for ${host}?`;

        const opts = {
            type: 'question',
            buttons: ['Allow', 'Deny'],
            defaultId: 1,
            cancelId: 1,
            title: 'Permission request',
            message: detail,
            detail: isIncognito ? 'Incognito: this decision will not be saved.' : 'You can change this later in Settings.',
            checkboxLabel: isIncognito ? undefined : 'Remember for this site',
            checkboxChecked: true
        };

        const result = await dialog.showMessageBox(win || undefined, opts);
        const allowed = result.response === 0;

        runtimePermissionCache.set(runtimeKey, allowed);
        if (!isIncognito && result.checkboxChecked) setStoredPermission(origin, permKey, allowed);
        return allowed;
    });

    try { return await permissionPromptQueue; }
    catch (_) { return false; }
}

function configureSession(partition) {
    if (configuredPartitions.has(partition)) return session.fromPartition(partition);
    configuredPartitions.add(partition);

    const ses = session.fromPartition(partition);

    // Add security headers to our internal pages
    ses.webRequest.onHeadersReceived((details, callback) => {
        const headers = { ...details.responseHeaders };
        if (details.url.startsWith('file://')) {
            headers['X-Content-Type-Options'] = ['nosniff'];
            headers['X-Frame-Options'] = ['DENY'];
            headers['X-XSS-Protection'] = ['1; mode=block'];
        }
        callback({ responseHeaders: headers });
    });

    // Request header injection + HTTPS upgrade + ad blocking
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = userAgent;
        details.requestHeaders['Sec-CH-UA'] = '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"';
        details.requestHeaders['Sec-CH-UA-Mobile'] = '?0';
        details.requestHeaders['Sec-CH-UA-Platform'] = '"Windows"';
        if (store.get('privacySettings.doNotTrack')) details.requestHeaders['DNT'] = '1';
        if (store.get('privacySettings.fingerprintProtection')) {
            details.requestHeaders['Sec-GPC'] = '1'; // Global Privacy Control
        }
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // Ad blocker + dangerous URL blocker + HTTPS upgrade + Safe Browsing
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        const url = details.url;

        // Never block internal renderer pages.
        if (url.startsWith('file://')) return callback({ cancel: false });

        // Block dangerous protocols
        for (const proto of dangerousProtocols) {
            if (url.toLowerCase().startsWith(proto)) {
                log.warn(`[Security] Blocked dangerous URL: ${url.substring(0, 80)}`);
                return callback({ cancel: true });
            }
        }

        // Google Safe Browsing-style check
        const safety = checkUrlSafety(url);
        if (!safety.safe) {
            log.warn(`[SafeBrowsing] Blocked: ${url.substring(0, 80)} — ${safety.reason}`);
            mainWindow?.webContents.send('security-warning', {
                type: 'safe-browsing',
                url: url.substring(0, 100),
                reason: safety.reason
            });
            return callback({ cancel: true });
        }

        // HTTPS upgrade
        if (store.get('httpsUpgrade') && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
            const httpsUrl = url.replace('http://', 'https://');
            log.info(`[HTTPS Upgrade] ${url.substring(0, 60)} → HTTPS`);
            return callback({ redirectURL: httpsUrl });
        }

        // Ad blocking
        if (store.get('adBlockEnabled')) {
            try {
                const urlObj = new URL(url);
                const host = urlObj.hostname;
                // Quick check: is the host itself blocked?
                let shouldBlock = adBlockSet.has(host);

                // If not, check parent domains (e.g. ad.example.com -> example.com)
                if (!shouldBlock) {
                    const parts = host.split('.');
                    if (parts.length > 2) {
                        const parent = parts.slice(-2).join('.');
                        shouldBlock = adBlockSet.has(parent);
                    }
                }

                // Fallback for keyword-based blocking (slower, but necessary for some)
                if (!shouldBlock && (url.includes('doubleclick') || url.includes('tracker'))) {
                    shouldBlock = true;
                }

                if (shouldBlock) {
                    sessionBlockCount++;
                    // Optimize: Don't read-write store on every hit. Batch update or update in memory.
                    // For now, minimal update or just in-memory.
                    // store.set('adBlockStats.totalBlocked', store.get('adBlockStats.totalBlocked', 0) + 1);
                    return callback({ cancel: true });
                }
            } catch (e) { }
        }

        callback({ cancel: false });
    });

    // Permission handlers (prompt + remember)
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const perm = normalizePermissionKey(permission);
        const promptable = new Set([
            'geolocation',
            'notifications',
            'media',
            'clipboard-read',
            'clipboard-sanitized-write',
            'display-capture',
            'pointerlock',
            'fullscreen',
            'persistent-storage'
        ]);

        // Always allow persistent storage (needed for IndexedDB reliability).
        if (perm === 'persistent-storage') return callback(true);

        if (!promptable.has(perm)) {
            log.info(`[Permission] ✗ ${perm} for ${details?.requestingUrl || 'unknown'}`);
            return callback(false);
        }

        const reqUrl = details?.requestingUrl || details?.url || webContents?.getURL?.() || '';
        promptPermission({ partition, permission: perm, requestingUrl: reqUrl })
            .then((allowed) => {
                log.info(`[Permission] ${allowed ? '✓' : '✗'} ${perm} for ${reqUrl || 'unknown'}`);
                callback(!!allowed);
            })
            .catch(() => callback(false));
    });

    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        const perm = normalizePermissionKey(permission);
        if (perm === 'persistent-storage') return true;

        const origin = safeUrlOrigin(requestingOrigin || details?.requestingUrl || details?.url || webContents?.getURL?.() || '');
        const runtimeKey = `${partition}|${origin}|${perm}`;
        if (runtimePermissionCache.has(runtimeKey)) return runtimePermissionCache.get(runtimeKey);

        if (partition !== 'incognito') {
            const stored = getStoredPermission(origin, perm);
            if (typeof stored === 'boolean') return stored;
        }

        return false;
    });

    // Download manager (per-session)
    ses.on('will-download', (event, item) => {
        const downloadId = uuidv4();
        const filename = item.getFilename();
        const filePath = path.join(app.getPath('downloads'), filename);
        const isIncognito = partition === 'incognito';

        // Security: warn about dangerous file types
        const dangerousExtensions = ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.wsf', '.scr'];
        const ext = path.extname(filename).toLowerCase();
        const isDangerous = dangerousExtensions.includes(ext);

        item.setSavePath(filePath);
        log.info(`[Download] ${isIncognito ? '[Incognito] ' : ''}${isDangerous ? '⚠️ DANGEROUS ' : ''}${filename} → ${filePath}`);

        if (isDangerous) {
            mainWindow?.webContents.send('security-warning', {
                type: 'dangerous-download',
                filename,
                extension: ext
            });
        }

        const startMs = Date.now();

        item.on('updated', (event, state) => {
            const total = item.getTotalBytes();
            const received = item.getReceivedBytes();
            const progress = total > 0 ? (received / total) * 100 : 0;
            const elapsedMs = Math.max(1, Date.now() - startMs);
            const speedBps = Math.max(0, received / (elapsedMs / 1000));
            mainWindow?.webContents.send('download-status', {
                id: downloadId,
                status: state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'downloading'),
                filename, progress, received, total,
                speed: Math.round(speedBps),
                isDangerous,
                incognito: isIncognito
            });
        });

        item.once('done', (event, state) => {
            log.info(`[Download] ${state}: ${filename}`);
            mainWindow?.webContents.send('download-status', {
                id: downloadId, status: state, filename, path: filePath, isDangerous, incognito: isIncognito
            });
            if (isIncognito) return;

            const history = store.get('downloadHistory', []);
            history.push({ id: downloadId, filename: sanitize(filename), path: filePath, status: state, timestamp: Date.now(), size: item.getTotalBytes() });
            if (history.length > 500) history.splice(0, history.length - 400);
            store.set('downloadHistory', history);
        });
    });

    return ses;
}

let globalSecurityHooksInstalled = false;
function installGlobalSecurityHooks() {
    if (globalSecurityHooksInstalled) return;
    globalSecurityHooksInstalled = true;

    // Certificate error handling: reject by default (secure).
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
        log.warn(`[SSL] Certificate error for ${url}: ${error}`);
        event.preventDefault();
        mainWindow?.webContents.send('security-warning', {
            type: 'certificate',
            url,
            error,
            issuer: certificate?.issuerName
        });
        callback(false);
    });
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
    splashWindow.loadFile(path.join(__dirname, 'renderer/splash.html'));
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
        icon: path.join(__dirname, 'renderer/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
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

    // Install security hooks and configure both persistent + incognito sessions before any loads.
    installGlobalSecurityHooks();
    configureSession('persist:kits-browser');
    configureSession('incognito');

    mainWindow.webContents.setUserAgent(userAgent);
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    if (store.get('isMaximized')) mainWindow.maximize();

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        log.info('Window ready');
    });

    // Save window state on resize/move
    const saveWindowState = () => {
        if (!mainWindow) return;
        store.set('isMaximized', mainWindow.isMaximized());
        if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
            const bounds = mainWindow.getBounds();
            store.set('windowBounds', bounds);
        }
    };
    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);

    // Session security, permissions, and downloads are configured via configureSession().

    // ===========================================================
    //  11. CRASH / HANG RECOVERY
    // ===========================================================
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        log.error(`Renderer gone: ${details.reason} (code: ${details.exitCode})`);
        if (details.reason !== 'killed' && details.reason !== 'clean-exit') {
            dialog.showMessageBox({ type: 'error', title: 'KITSWebGen — Recovery', message: 'The browser encountered an error.', buttons: ['Restart', 'Quit'] })
                .then(r => { if (r.response === 0) { app.relaunch(); app.exit(0); } else app.quit(); });
        }
    });

    mainWindow.webContents.on('unresponsive', () => {
        log.warn('Renderer unresponsive');
        dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Page Unresponsive', message: 'KITSWebGen is not responding.', buttons: ['Wait', 'Reload'] })
            .then(r => { if (r.response === 1) mainWindow.reload(); });
    });

    // Prevent popups — redirect to tabs
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Security: block dangerous URLs in popups
        for (const proto of dangerousProtocols) {
            if (url.toLowerCase().startsWith(proto)) {
                log.warn(`[Security] Blocked popup with dangerous URL: ${url.substring(0, 50)}`);
                return { action: 'deny' };
            }
        }
        mainWindow.webContents.send('new-tab-from-main', url);
        return { action: 'deny' };
    });

    // Navigation security for the main window
    mainWindow.webContents.on('will-navigate', (event, url) => {
        // Only allow navigation to our renderer files
        if (!url.startsWith('file://') || !url.includes('renderer')) {
            event.preventDefault();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ===========================================================
//  12. APPLICATION MENU
// ===========================================================
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

// ===========================================================
//  13. LIFECYCLE
// ===========================================================
app.on('ready', () => {
    createSplashWindow();
    log.info('Splash shown');
    // After splash animation, create and show main window
    setTimeout(() => {
        createWindow();
        log.info('App ready');
        // Close splash after main window is ready
        mainWindow.once('ready-to-show', () => {
            setTimeout(() => {
                if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
                mainWindow.show();
            }, 300);
        });

        // ===========================================================
        //  SYSTEM TRAY INTEGRATION
        // ===========================================================
        try {
            const iconPath = path.join(__dirname, 'renderer/icon.png');
            if (fs.existsSync(iconPath)) {
                tray = new Tray(iconPath);
            } else {
                // Create a minimal tray without icon
                const { nativeImage } = require('electron');
                const img = nativeImage.createEmpty();
                tray = new Tray(img);
            }
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

        // ===========================================================
        //  POWER MONITOR — Battery / AC / Sleep events
        // ===========================================================
        powerMonitor.on('on-battery', () => {
            log.info('[Power] Switched to battery');
            mainWindow?.webContents.send('power-event', { type: 'battery', message: '🔋 Running on battery power' });
        });
        powerMonitor.on('on-ac', () => {
            log.info('[Power] Switched to AC');
            mainWindow?.webContents.send('power-event', { type: 'ac', message: '🔌 Connected to power' });
        });
        powerMonitor.on('suspend', () => {
            log.info('[Power] System suspending');
            // Auto-save session before sleep
            mainWindow?.webContents.send('power-event', { type: 'suspend', message: '💤 System sleeping — session saved' });
        });
        powerMonitor.on('resume', () => {
            log.info('[Power] System resumed');
            mainWindow?.webContents.send('power-event', { type: 'resume', message: '⚡ System resumed' });
        });
        powerMonitor.on('lock-screen', () => log.info('[Power] Screen locked'));
        powerMonitor.on('unlock-screen', () => log.info('[Power] Screen unlocked'));

        // ===========================================================
        //  NETWORK MONITOR
        // ===========================================================
        setTimeout(() => monitorNetwork(mainWindow), 2000); // Wait for session init

    }, 2200);
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Minimize to tray instead of closing
app.on('before-quit', () => { app.isQuitting = true; });

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
    log.info('App quitting');
    if (store.get('privacySettings.clearOnExit')) {
        const ses = session.fromPartition('persist:kits-browser');
        ses.clearCache();
        ses.clearStorageData();
        log.info('Privacy: cleared on exit');
    }
});

process.on('uncaughtException', (error) => log.error('Uncaught:', error));
process.on('unhandledRejection', (reason) => log.error('Unhandled:', reason));

// ===========================================================
//  14. SCHEDULED TASKS (node-cron)
// ===========================================================
cron.schedule('0 0 * * *', () => {
    log.info('[Cron] Daily maintenance');
    const dl = store.get('downloadHistory', []);
    if (dl.length > 500) store.set('downloadHistory', dl.slice(-400));
});

// ===========================================================
//  15. IPC HANDLERS
// ===========================================================
ipcMain.on('window-min', () => mainWindow?.minimize());
ipcMain.on('window-max', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// AI Chat
// OpenAI Integration
const OpenAI = require('openai');
// Replace with your actual key or use process.env.OPENAI_API_KEY
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-proj-PLACEHOLDER' });

ipcMain.handle('ai-chat', async (event, prompt, context) => {
    try {
        const p = sanitize(prompt);
        log.info(`[AI] Request: ${p.substring(0, 50)}...`);

        // Context-aware system prompt
        let sysPrompt = "You are KITS AI, a helpful browser assistant. Answer concisely.";
        if (context) {
            sysPrompt += `\n\nCurrent Page Context:\nTitle: ${context.title}\nUrl: ${context.url}\nContent Snippet: ${context.content ? context.content.substring(0, 1000) : ''}`;
        }

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: sysPrompt },
                { role: "user", content: p }
            ],
            model: "gpt-3.5-turbo",
        });

        return completion.choices[0].message.content;
    } catch (error) {
        log.error('[AI] OpenAI Error:', error);
        return "I'm having trouble connecting to the AI service right now. Please check your API Key.";
    }
});

function fetchJson(url, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
            const status = res.statusCode || 0;
            if (status < 200 || status >= 300) {
                res.resume();
                return reject(new Error(`HTTP ${status}`));
            }
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
                if (raw.length > 1024 * 1024) {
                    req.destroy(new Error('Response too large'));
                }
            });
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    });
}

// Omnibox suggestions cache (avoid repeated network calls while typing)
const SUGGESTION_CACHE_TTL_MS = 30_000;
const suggestionCache = new Map(); // key -> { ts, data } | { ts, promise }

ipcMain.handle('search-suggestions', async (event, query, engine = 'google') => {
    try {
        const q = sanitize(String(query || '').trim()).slice(0, 120);
        if (q.length < 2) return [];

        const eng = String(engine || 'google').toLowerCase();
        const key = `${eng}:${q}`;
        const now = Date.now();

        const cached = suggestionCache.get(key);
        if (cached?.data && (now - cached.ts) < SUGGESTION_CACHE_TTL_MS) return cached.data;
        if (cached?.promise) return await cached.promise;

        const compute = async () => {
            // DuckDuckGo uses a different response shape: [{ phrase: "..." }, ...]
            if (eng === 'duckduckgo') {
                const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`;
                const data = await fetchJson(url);
                if (!Array.isArray(data)) return [];
                return data
                    .map(item => item?.phrase)
                    .filter(s => typeof s === 'string' && s.trim().length > 0)
                    .slice(0, 8);
            }

            // Bing/Google-style: [query, [suggestions...], ...]
            const url = eng === 'bing'
                ? `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
                : `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`;

            const data = await fetchJson(url);
            if (!Array.isArray(data)) return [];
            const suggestions = Array.isArray(data[1]) ? data[1] : [];
            return suggestions
                .filter(s => typeof s === 'string' && s.trim().length > 0)
                .slice(0, 8);
        };

        // Simple cache cap to avoid unbounded growth.
        if (suggestionCache.size > 250) suggestionCache.clear();

        const promise = compute();
        suggestionCache.set(key, { ts: now, promise });
        const result = await promise;
        suggestionCache.set(key, { ts: Date.now(), data: result });
        return result;
    } catch (e) {
        return [];
    }
});

ipcMain.handle('automate-web', async () => ({ success: false, message: 'Web automation coming soon.' }));

ipcMain.handle('capture-page', async () => {
    if (!mainWindow) return null;
    try {
        const image = await mainWindow.capturePage();
        return image.toDataURL();
    } catch (e) { log.error('[Capture]', e.message); return null; }
});

ipcMain.handle('clear-cache-production', async (_event, options = {}) => {
    try {
        const opts = (options && typeof options === 'object') ? options : {};
        const clearCache = opts.cache !== false;
        const clearStorage = opts.storage === true;
        const ses = session.fromPartition('persist:kits-browser');
        if (clearCache) await ses.clearCache();
        if (clearStorage) await ses.clearStorageData();
        log.info(`[Cache] Cleared (cache=${clearCache} storage=${clearStorage})`);
        return true;
    } catch (e) { log.error('[Cache]', e.message); return false; }
});

ipcMain.handle('clear-site-data-production', async (_event, options = {}) => {
    try {
        const opts = (options && typeof options === 'object') ? options : {};
        const storages = [];
        if (opts.cookies) storages.push('cookies');
        if (opts.cacheStorage) storages.push('cachestorage');
        if (opts.serviceWorkers) storages.push('serviceworkers');
        if (opts.localStorage) storages.push('localstorage');
        if (opts.indexedDB) storages.push('indexdb');
        if (opts.webSQL) storages.push('websql');

        if (storages.length === 0) return true;
        const ses = session.fromPartition('persist:kits-browser');
        await ses.clearStorageData({ storages });
        log.info(`[SiteData] Cleared: ${storages.join(', ')}`);
        return true;
    } catch (e) {
        log.error('[SiteData]', e.message);
        return false;
    }
});

// Store access
ipcMain.handle('store-get', (e, key) => store.get(key));
ipcMain.handle('store-set', (e, key, value) => { store.set(key, value); return true; });

// Account management
ipcMain.handle('account-signup', (event, { name, email, password }) => {
    if (!name || name.length < 2) return { ok: false, msg: 'Name must be at least 2 characters.' };
    if (!email || !email.includes('@')) return { ok: false, msg: 'Enter a valid email.' };
    if (!password || password.length < 4) return { ok: false, msg: 'Password must be at least 4 characters.' };
    const accounts = store.get('accounts', []);
    if (accounts.find(a => a.email === email)) return { ok: false, msg: 'Account exists. Sign in instead.' };
    const { hash, salt } = hashPassword(password);
    const profile = { id: uuidv4(), name: sanitize(name), email: sanitize(email), hash, salt, created: Date.now() };
    accounts.push(profile);
    store.set('accounts', accounts);
    const safe = { id: profile.id, name: profile.name, email: profile.email, avatar: profile.name.charAt(0).toUpperCase(), created: profile.created };
    store.set('userProfile', safe);
    log.info(`[Account] Created: ${profile.email}`);
    return { ok: true, profile: safe };
});

ipcMain.handle('account-login', (event, { email, password }) => {
    if (!email || !password) return { ok: false, msg: 'Email and password required.' };
    const accounts = store.get('accounts', []);
    const account = accounts.find(a => a.email === email);
    if (!account) return { ok: false, msg: 'No account found.' };
    try {
        if (!verifyPassword(password, account.hash, account.salt)) return { ok: false, msg: 'Incorrect password.' };
    } catch (e) { return { ok: false, msg: 'Auth error.' }; }
    const safe = { id: account.id, name: account.name, email: account.email, avatar: account.name.charAt(0).toUpperCase(), created: account.created };
    store.set('userProfile', safe);
    log.info(`[Account] Login: ${account.email}`);
    return { ok: true, profile: safe };
});

ipcMain.handle('account-logout', () => {
    store.set('userProfile', null);
    return true;
});

ipcMain.handle('account-get-profile', () => store.get('userProfile', null));

// Ad block
ipcMain.handle('get-adblock-stats', () => ({
    total: store.get('adBlockStats.totalBlocked', 0),
    session: sessionBlockCount,
    enabled: store.get('adBlockEnabled', true)
}));
ipcMain.handle('toggle-adblock', (e, enabled) => { store.set('adBlockEnabled', enabled); return enabled; });

// System info
ipcMain.handle('get-system-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${os.type()} ${os.release()}`,
    arch: process.arch,
    memory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    uptime: `${Math.round(os.uptime() / 3600)} hours`,
    sessionId: store.get('sessionId'),
    configPath: store.path,
    logPath: log.transports.file.getFile()?.path || 'unknown',
    adsBlocked: store.get('adBlockStats.totalBlocked', 0),
    httpsUpgrade: store.get('httpsUpgrade', true)
}));

// Print page
ipcMain.handle('print-page', async () => {
    if (!mainWindow) return false;
    mainWindow.webContents.print({ silent: false, printBackground: true });
    return true;
});

// Screenshot
ipcMain.handle('take-screenshot', async () => {
    if (!mainWindow) return null;
    try {
        const image = await mainWindow.capturePage();
        const screenshotsDir = path.join(app.getPath('pictures'), 'KITS Screenshots');
        if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
        const filename = `KITS_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const filePath = path.join(screenshotsDir, filename);
        fs.writeFileSync(filePath, image.toPNG());
        log.info(`[Screenshot] Saved: ${filePath}`);
        return { success: true, path: filePath, filename };
    } catch (e) {
        log.error('[Screenshot]', e.message);
        return { success: false };
    }
});

// Open file/folder
ipcMain.handle('open-path', (e, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
});

// Save session
ipcMain.handle('save-session', (e, tabs) => {
    store.set('lastSession', { tabs, timestamp: Date.now() });
    return true;
});

// Load session
ipcMain.handle('load-session', () => {
    return store.get('lastSession', { tabs: [], timestamp: null });
});

// Toggle fullscreen
ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

// Menu actions bridge
ipcMain.on('menu-action', (e, action) => {
    mainWindow?.webContents.send('menu-action', action);
});

// ===========================================================
//  16. SYSTEM SECURITY INTEGRATION
// ===========================================================
const { getSecurityInfo, getDeviceInfo, sendNotification, getNetworkStatus, getSystemSecurity } = require('./main/security-info');
const { monitorNetwork } = require('./main/network-monitor');

ipcMain.handle('get-system-security', () => getSystemSecurity(store));

// Device compatibility info
ipcMain.handle('get-device-info', () => getDeviceInfo());

// Native system notification
ipcMain.handle('send-notification', (e, opts) => sendNotification(mainWindow, opts));

// Network status
ipcMain.handle('get-network-status', () => getNetworkStatus());

// Power status
ipcMain.handle('get-power-status', () => {
    return {
        onBattery: powerMonitor.isOnBatteryPower ? powerMonitor.isOnBatteryPower() : 'unknown',
        idleState: powerMonitor.getSystemIdleState ? powerMonitor.getSystemIdleState(60) : 'unknown',
        idleTime: powerMonitor.getSystemIdleTime ? powerMonitor.getSystemIdleTime() : 0
    };
});


