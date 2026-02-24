const { ipcMain, session, app, dialog, https, shell, powerMonitor } = require('electron');
const log = require('electron-log/main');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');
const { userAgent } = require('./constants');
const { sanitize, hashPassword, verifyPassword } = require('./utils');
const { getSessionBlockCount } = require('./session-manager');
const { getSystemSecurity, getDeviceInfo, sendNotification, getNetworkStatus } = require('./security-info');

// Cache for suggestions
const SUGGESTION_CACHE_TTL_MS = 30_000;
const suggestionCache = new Map();

function setupIpcHandlers(getMainWindow) {
    const getWin = () => {
        const win = getMainWindow();
        return (win && !win.isDestroyed()) ? win : null;
    };

    ipcMain.on('window-min', () => getWin()?.minimize());
    ipcMain.on('window-max', () => {
        const win = getWin();
        if (win?.isMaximized()) win.unmaximize();
        else win?.maximize();
    });
    ipcMain.on('window-close', () => getWin()?.close());

    // OpenAI Integration (Lazy loaded)
    let openai = null;
    ipcMain.handle('ai-chat', async (event, prompt, context) => {
        try {
            if (!openai) {
                const OpenAI = require('openai');
                openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-proj-PLACEHOLDER' });
            }

            const p = sanitize(prompt);
            let sysPrompt = "You are KITS AI, a helpful browser assistant. Answer concisely.";
            if (context) {
                sysPrompt += `\n\nCurrent Page Context:\nTitle: ${context.title}\nUrl: ${context.url}\nContent Snippet: ${context.content ? context.content.substring(0, 1000) : ''}`;
            }

            const completion = await openai.chat.completions.create({
                messages: [{ role: "system", content: sysPrompt }, { role: "user", content: p }],
                model: "gpt-3.5-turbo",
            });
            return completion.choices[0].message.content;
        } catch (error) {
            log.error('[AI] OpenAI Error:', error);
            return "I'm having trouble connecting to the AI service right now. Please check your API Key.";
        }
    });

    // Helper for suggestions
    function fetchJson(url, timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { if (raw.length < 1024 * 1024) raw += chunk; });
                res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        });
    }

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
                const url = eng === 'duckduckgo'
                    ? `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`
                    : eng === 'bing'
                        ? `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
                        : `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`;

                const data = await fetchJson(url);
                if (!Array.isArray(data)) return [];
                const suggestions = eng === 'duckduckgo' ? data.map(i => i?.phrase) : (Array.isArray(data[1]) ? data[1] : []);
                return suggestions.filter(s => typeof s === 'string' && s.trim().length > 0).slice(0, 8);
            };

            if (suggestionCache.size > 250) suggestionCache.clear();
            const promise = compute();
            suggestionCache.set(key, { ts: now, promise });
            const result = await promise;
            suggestionCache.set(key, { ts: Date.now(), data: result });
            return result;
        } catch (e) { return []; }
    });

    ipcMain.handle('automate-web', async () => ({ success: false, message: 'Web automation coming soon.' }));

    ipcMain.handle('capture-page', async () => {
        try {
            const win = getWin();
            if (!win) return null;
            const image = await win.capturePage();
            return image.toDataURL();
        } catch (e) { log.error('[Capture]', e.message); return null; }
    });

    ipcMain.handle('clear-cache-production', async (_event, options = {}) => {
        try {
            const ses = session.fromPartition('persist:kits-browser');
            if (options.cache !== false) await ses.clearCache();
            if (options.storage === true) await ses.clearStorageData();
            return true;
        } catch (e) { log.error('[Cache]', e.message); return false; }
    });

    ipcMain.handle('clear-site-data-production', async (_event, options = {}) => {
        try {
            const storages = [];
            const keys = ['cookies', 'cacheStorage', 'serviceWorkers', 'localStorage', 'indexedDB', 'webSQL'];
            keys.forEach(k => { if (options[k]) storages.push(k.toLowerCase()); });
            if (storages.length === 0) return true;
            await session.fromPartition('persist:kits-browser').clearStorageData({ storages });
            return true;
        } catch (e) { log.error('[SiteData]', e.message); return false; }
    });

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
        return { ok: true, profile: safe };
    });

    ipcMain.handle('account-login', (event, { email, password }) => {
        if (!email || !password) return { ok: false, msg: 'Email and password required.' };
        const accounts = store.get('accounts', []);
        const account = accounts.find(a => a.email === email);
        if (!account || !verifyPassword(password, account.hash, account.salt)) return { ok: false, msg: 'Invalid email or password.' };
        const safe = { id: account.id, name: account.name, email: account.email, avatar: account.name.charAt(0).toUpperCase(), created: account.created };
        store.set('userProfile', safe);
        return { ok: true, profile: safe };
    });

    ipcMain.handle('account-logout', () => {
        store.delete('userProfile');
        return true;
    });

    ipcMain.handle('account-get-profile', () => store.get('userProfile', null));

    // Adblock stats
    ipcMain.handle('adblock-stats', () => ({
        session: getSessionBlockCount(),
        enabled: store.get('adBlockEnabled', true)
    }));

    // Backward compatibility for adblock-stats
    ipcMain.handle('get-adblock-stats', () => ({
        session: getSessionBlockCount(),
        enabled: store.get('adBlockEnabled', true)
    }));

    ipcMain.handle('toggle-adblock', (e, enabled) => {
        store.set('adBlockEnabled', enabled);
        return enabled;
    });

    // System info handlers
    ipcMain.handle('get-system-info', () => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: `${require('os').type()} ${require('os').release()}`,
        arch: process.arch
    }));

    ipcMain.handle('get-system-security', async () => await getSystemSecurity(store));
    ipcMain.handle('get-device-info', () => getDeviceInfo());
    ipcMain.handle('get-network-status', () => getNetworkStatus());
    ipcMain.handle('send-notification', (event, data) => sendNotification(getWin(), data));

    ipcMain.handle('get-power-status', () => ({
        idleTime: powerMonitor.getSystemIdleTime(),
        onBattery: powerMonitor.isOnBatteryPower()
    }));

    ipcMain.handle('open-path', (event, p) => {
        if (!p) return false;
        shell.openPath(p);
        return true;
    });

    ipcMain.handle('save-session', (event, data) => {
        store.set('savedSession', data);
        return true;
    });

    ipcMain.handle('load-session', () => store.get('savedSession', null));

    ipcMain.handle('print-page', async () => {
        const win = getWin();
        if (!win) return false;
        win.webContents.print({ silent: false, printBackground: true });
        return true;
    });

    ipcMain.handle('take-screenshot', async () => {
        const win = getWin();
        if (!win) return null;
        try {
            const image = await win.capturePage();
            const screenshotsDir = path.join(app.getPath('pictures'), 'KITS Screenshots');
            if (!require('fs').existsSync(screenshotsDir)) require('fs').mkdirSync(screenshotsDir, { recursive: true });
            const filePath = path.join(screenshotsDir, `Screenshot_${Date.now()}.png`);
            require('fs').writeFileSync(filePath, image.toPNG());
            return filePath;
        } catch (e) { log.error('[Screenshot]', e.message); return null; }
    });

    ipcMain.on('menu-action', (e, action) => getWin()?.webContents.send('menu-action', action));
}

module.exports = { setupIpcHandlers };
