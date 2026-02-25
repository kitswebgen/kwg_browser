const { session, app, dialog } = require('electron');
const path = require('path');
const log = require('electron-log/main');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');
const {
    userAgent,
    adBlockList,
    dangerousProtocols,
    unsafeUrlPatterns,
    dangerousExtensions
} = require('./constants');

const adBlockSet = new Set(adBlockList);
const configuredPartitions = new Set();
const runtimePermissionCache = new Map();
let permissionPromptQueue = Promise.resolve();

let mainWindowInstance = null;
let sessionBlockCount = 0;

function setMainWindow(win) {
    mainWindowInstance = win;
}

function getSessionBlockCount() {
    return sessionBlockCount;
}

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
    const map = {
        'media': 'Camera / Microphone',
        'geolocation': 'Location',
        'notifications': 'Notifications',
        'clipboard-read': 'Clipboard Read',
        'display-capture': 'Screen Capture',
        'pointerlock': 'Pointer Lock',
        'fullscreen': 'Fullscreen'
    };
    return map[p] || permission;
}

async function promptPermission({ partition, permission, requestingUrl }) {
    const origin = safeUrlOrigin(requestingUrl);
    const host = safeUrlHost(requestingUrl) || origin || 'this site';
    const permKey = normalizePermissionKey(permission);

    const runtimeKey = `${partition}|${origin}|${permKey}`;
    if (runtimePermissionCache.has(runtimeKey)) return runtimePermissionCache.get(runtimeKey);

    const isIncognito = partition === 'incognito';
    if (!isIncognito) {
        const stored = getStoredPermission(origin, permKey);
        if (typeof stored === 'boolean') return stored;
    }

    permissionPromptQueue = permissionPromptQueue.then(async () => {
        const win = mainWindowInstance && !mainWindowInstance.isDestroyed() ? mainWindowInstance : null;
        const opts = {
            type: 'question',
            buttons: ['Allow', 'Deny'],
            defaultId: 1,
            cancelId: 1,
            title: 'Permission request',
            message: `Allow ${permissionDisplayName(permKey)} for ${host}?`,
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

function checkUrlSafety(url) {
    for (const pattern of unsafeUrlPatterns) {
        if (pattern.test(url)) return { safe: false, reason: 'Suspected phishing or malware URL' };
    }
    return { safe: true };
}

function configureSession(partition) {
    if (configuredPartitions.has(partition)) return session.fromPartition(partition);
    configuredPartitions.add(partition);

    const ses = session.fromPartition(partition);

    ses.webRequest.onHeadersReceived((details, callback) => {
        const headers = { ...details.responseHeaders };
        if (details.url.startsWith('file://')) {
            headers['X-Content-Type-Options'] = ['nosniff'];
            headers['X-Frame-Options'] = ['DENY'];
            headers['X-XSS-Protection'] = ['1; mode=block'];
        }
        callback({ responseHeaders: headers });
    });

    ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = userAgent;
        details.requestHeaders['Sec-CH-UA'] = '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"';
        details.requestHeaders['Sec-CH-UA-Mobile'] = '?0';
        details.requestHeaders['Sec-CH-UA-Platform'] = '"Windows"';
        if (store.get('privacySettings.doNotTrack')) details.requestHeaders['DNT'] = '1';
        if (store.get('privacySettings.fingerprintProtection')) details.requestHeaders['Sec-GPC'] = '1';
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        const url = details.url;
        if (url.startsWith('file://')) return callback({ cancel: false });

        for (const proto of dangerousProtocols) {
            if (url.toLowerCase().startsWith(proto)) {
                log.warn(`[Security] Blocked dangerous URL: ${url.substring(0, 80)}`);
                return callback({ cancel: true });
            }
        }

        const safety = checkUrlSafety(url);
        if (!safety.safe) {
            log.warn(`[SafeBrowsing] Blocked: ${url.substring(0, 80)} — ${safety.reason}`);
            if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                try {
                    mainWindowInstance.webContents.send('security-warning', {
                        type: 'safe-browsing',
                        url: url.substring(0, 100),
                        reason: safety.reason
                    });
                } catch (e) { }
            }
            return callback({ cancel: true });
        }

        if (store.get('httpsUpgrade') && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
            return callback({ redirectURL: url.replace('http://', 'https://') });
        }

        if (store.get('adBlockEnabled')) {
            try {
                const urlObj = new URL(url);
                const host = urlObj.hostname;
                if (!host) return callback({ cancel: false });

                let shouldBlock = adBlockSet.has(host);
                if (!shouldBlock) {
                    const parts = host.split('.');
                    if (parts.length > 2) shouldBlock = adBlockSet.has(parts.slice(-2).join('.'));
                }
                if (!shouldBlock && (url.includes('doubleclick') || url.includes('tracker'))) shouldBlock = true;

                if (shouldBlock) {
                    sessionBlockCount++;
                    return callback({ cancel: true });
                }
            } catch (e) {
                // If URL parsing fails, continue without blocking
            }
        }

        callback({ cancel: false });
    });

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const perm = normalizePermissionKey(permission);
        if (perm === 'persistent-storage') return callback(true);

        const promptable = new Set(['geolocation', 'notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture', 'pointerlock', 'fullscreen', 'persistent-storage']);
        if (!promptable.has(perm)) return callback(false);

        const reqUrl = details?.requestingUrl || details?.url || webContents?.getURL?.() || '';
        promptPermission({ partition, permission: perm, requestingUrl: reqUrl })
            .then((allowed) => callback(!!allowed))
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

    ses.on('will-download', (event, item) => {
        const downloadId = uuidv4();
        const filename = item.getFilename();
        const filePath = path.join(app.getPath('downloads'), filename);
        const isIncognito = partition === 'incognito';
        const ext = path.extname(filename).toLowerCase();
        const isDangerous = dangerousExtensions.includes(ext);

        item.setSavePath(filePath);
        log.info(`[Download] ${isIncognito ? '[Incognito] ' : ''}${isDangerous ? '⚠️ DANGEROUS ' : ''}${filename} → ${filePath}`);

        if (isDangerous) {
            if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                try {
                    mainWindowInstance.webContents.send('security-warning', { type: 'dangerous-download', filename, extension: ext });
                } catch (e) { }
            }
        }

        const startMs = Date.now();
        item.on('updated', (event, state) => {
            const total = item.getTotalBytes();
            const received = item.getReceivedBytes();
            const progress = total > 0 ? (received / total) * 100 : 0;
            const elapsedMs = Math.max(1, Date.now() - startMs);
            const speedBps = Math.max(0, received / (elapsedMs / 1000));

            if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                try {
                    mainWindowInstance.webContents.send('download-status', {
                        id: downloadId,
                        status: state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'downloading'),
                        filename, progress, received, total,
                        speed: Math.round(speedBps),
                        isDangerous,
                        incognito: isIncognito
                    });
                } catch (e) { }
            }
        });

        item.once('done', (event, state) => {
            if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
                try {
                    mainWindowInstance.webContents.send('download-status', { id: downloadId, status: state, filename, path: filePath, isDangerous, incognito: isIncognito });
                } catch (e) { }
            }
            if (isIncognito) return;

            const history = store.get('downloadHistory', []);
            history.push({ id: downloadId, filename, path: filePath, status: state, timestamp: Date.now(), size: item.getTotalBytes() });
            if (history.length > 500) history.splice(0, history.length - 400);
            store.set('downloadHistory', history);
        });
    });

    return ses;
}

function installGlobalSecurityHooks() {
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
        log.warn(`[SSL] Certificate error for ${url}: ${error}`);
        event.preventDefault();
        mainWindowInstance?.webContents.send('security-warning', { type: 'certificate', url, error, issuer: certificate?.issuerName });
        callback(false);
    });
}

module.exports = {
    configureSession,
    installGlobalSecurityHooks,
    setMainWindow,
    getSessionBlockCount
};
