const DB_NAME = 'kits-client-db';
const DB_VERSION = 1;
const EVENTS_CHANNEL = 'kits-db';

const bc = (() => {
    try { return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(EVENTS_CHANNEL) : null; }
    catch (_) { return null; }
})();

function broadcast(type, payload = {}) {
    try { bc?.postMessage({ type, payload, ts: Date.now() }); } catch (_) { }
}

function isIndexedDBAvailable() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB?.open; } catch (_) { return false; }
}

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
}

function txComplete(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

function safeParseJson(v, fallback) {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (_) { return fallback; }
}

function normalizeBookmark(bm) {
    if (!bm || typeof bm !== 'object') return null;
    const url = typeof bm.url === 'string' ? bm.url.trim() : '';
    if (!url) return null;
    return {
        url,
        title: typeof bm.title === 'string' && bm.title.trim() ? bm.title.trim() : url,
        time: Number.isFinite(bm.time) ? bm.time : Date.now()
    };
}

function normalizeHistoryItem(h) {
    if (!h || typeof h !== 'object') return h;
    const url = typeof h.url === 'string' ? h.url.trim() : '';
    if (!url) return null;
    return {
        url,
        title: typeof h.title === 'string' ? h.title.trim() : '',
        time: Number.isFinite(h.time) ? h.time : Date.now()
    };
}

class KitsDB {
    constructor() {
        this._dbPromise = null;
        this._supported = isIndexedDBAvailable();
        this._lastHistory = { url: '', time: 0 };
        this._historyCleanupTimer = null;
    }

    async open() {
        if (!this._supported) return null;
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('bookmarks')) {
                    const store = db.createObjectStore('bookmarks', { keyPath: 'url' });
                    store.createIndex('by_time', 'time', { unique: false });
                }
                if (!db.objectStoreNames.contains('history')) {
                    const store = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by_time', 'time', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
        });
        return this._dbPromise;
    }

    async getKV(key, fallback = null) {
        if (!this._supported) {
            try {
                const raw = localStorage.getItem(`kv:${key}`);
                return raw === null ? fallback : safeParseJson(raw, raw);
            } catch (_) { return fallback; }
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['kv'], 'readonly');
            const rec = await requestToPromise(tx.objectStore('kv').get(key));
            return rec ? rec.value : fallback;
        } catch (_) { return fallback; }
    }

    async setKV(key, value) {
        if (!this._supported) {
            try { localStorage.setItem(`kv:${key}`, JSON.stringify(value)); } catch (_) { }
            broadcast('kv-changed', { key });
            return true;
        }
        try {
            const db = await this.open();
            const tx = db.transaction(['kv'], 'readwrite');
            tx.objectStore('kv').put({ key, value });
            await txComplete(tx);
            broadcast('kv-changed', { key });
            return true;
        } catch (_) { return false; }
    }

    async delKV(key) {
        if (!this._supported) {
            try { localStorage.removeItem(`kv:${key}`); } catch (_) { }
            broadcast('kv-changed', { key });
            return true;
        }
        try {
            const db = await this.open();
            const tx = db.transaction(['kv'], 'readwrite');
            tx.objectStore('kv').delete(key);
            await txComplete(tx);
            broadcast('kv-changed', { key });
            return true;
        } catch (_) { return false; }
    }

    async count(storeName) {
        if (!this._supported) return 0;
        try {
            const db = await this.open();
            const tx = db.transaction([storeName], 'readonly');
            return await requestToPromise(tx.objectStore(storeName).count());
        } catch (_) { return 0; }
    }

    async getBookmarks({ limit = 5000 } = {}) {
        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            return Array.isArray(list) ? list.map(normalizeBookmark).filter(Boolean) : [];
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readonly');
            const store = tx.objectStore('bookmarks').index('by_time');
            // Faster than cursor if we don't need incremental load
            const results = await requestToPromise(store.getAll(null, limit));
            return results.reverse(); // newest first
        } catch (_) { return []; }
    }

    async setBookmarks(bookmarks = []) {
        const list = Array.isArray(bookmarks) ? bookmarks.map(normalizeBookmark).filter(Boolean) : [];
        if (!this._supported) {
            try { localStorage.setItem('bookmarks', JSON.stringify(list)); } catch (_) { }
            broadcast('bookmarks-changed');
            return list;
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readwrite');
            const store = tx.objectStore('bookmarks');
            store.clear();
            for (const bm of list) store.put(bm);
            await txComplete(tx);
            broadcast('bookmarks-changed');
            return list;
        } catch (_) { return []; }
    }

    async upsertBookmark(bookmark) {
        const bm = normalizeBookmark(bookmark);
        if (!bm) return false;

        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            const next = Array.isArray(list) ? list.map(normalizeBookmark).filter(Boolean) : [];
            const idx = next.findIndex(b => b.url === bm.url);
            if (idx >= 0) next[idx] = bm;
            else next.push(bm);
            next.sort((a, b) => b.time - a.time);
            try { localStorage.setItem('bookmarks', JSON.stringify(next)); } catch (_) { }
            broadcast('bookmarks-changed');
            return true;
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readwrite');
            tx.objectStore('bookmarks').put(bm);
            await txComplete(tx);
            broadcast('bookmarks-changed');
            return true;
        } catch (_) { return false; }
    }

    async removeBookmark(url) {
        if (!url) return false;
        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            const filtered = Array.isArray(list) ? list.filter(b => b.url !== url) : [];
            try { localStorage.setItem('bookmarks', JSON.stringify(filtered)); } catch (_) { }
            broadcast('bookmarks-changed');
            return true;
        }
        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readwrite');
            tx.objectStore('bookmarks').delete(url);
            await txComplete(tx);
            broadcast('bookmarks-changed');
            return true;
        } catch (_) { return false; }
    }

    async isBookmarked(url) {
        if (!url) return false;
        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            return Array.isArray(list) && list.some(b => b?.url === url);
        }
        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readonly');
            const rec = await requestToPromise(tx.objectStore('bookmarks').get(url));
            return !!rec;
        } catch (_) { return false; }
    }

    async addHistory(item, { maxEntries = 20_000 } = {}) {
        const h = normalizeHistoryItem(item);
        if (!h) return false;

        if (this._lastHistory.url === h.url && (Date.now() - this._lastHistory.time) < 2500) return true;
        this._lastHistory = { url: h.url, time: Date.now() };

        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('browsing-history') || '[]', []);
            list.push(h);
            const trimmed = list.slice(-Math.min(maxEntries, 2000));
            try { localStorage.setItem('browsing-history', JSON.stringify(trimmed)); } catch (_) { }
            broadcast('history-changed');
            return true;
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readwrite');
            tx.objectStore('history').add(h);
            await txComplete(tx);
            this._scheduleHistoryCleanup(maxEntries);
            broadcast('history-changed');
            return true;
        } catch (_) { return false; }
    }

    _scheduleHistoryCleanup(maxEntries) {
        if (!this._supported || this._historyCleanupTimer) return;
        this._historyCleanupTimer = setTimeout(() => {
            this._historyCleanupTimer = null;
            this.cleanupHistory({ maxEntries }).catch(() => { });
        }, 5000);
    }

    async cleanupHistory({ maxEntries = 20_000 } = {}) {
        if (!this._supported) return false;
        const total = await this.count('history');
        if (total <= maxEntries) return true;

        const toDelete = total - maxEntries;
        const db = await this.open();
        const tx = db.transaction(['history'], 'readwrite');
        const store = tx.objectStore('history').index('by_time');
        const oldest = await requestToPromise(store.getAllKeys(null, toDelete));

        const mainStore = tx.objectStore('history');
        for (const key of oldest) mainStore.delete(key);
        await txComplete(tx);
        return true;
    }

    async getHistory({ query = '', limit = 1500 } = {}) {
        const q = String(query || '').toLowerCase().trim();
        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('browsing-history') || '[]', []);
            const filtered = q ? list.filter(h => String(h.title || '').toLowerCase().includes(q) || String(h.url || '').toLowerCase().includes(q)) : list;
            return filtered.slice(-limit).reverse();
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readonly');
            const index = tx.objectStore('history').index('by_time');

            // If no query, use fast getAll
            if (!q) {
                const results = await requestToPromise(index.getAll(null, limit));
                return results.reverse();
            }

            // If query, use cursor for efficient filtering (or getAll + filter if limit is small)
            return new Promise((resolve) => {
                const out = [];
                const req = index.openCursor(null, 'prev');
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor || out.length >= limit) return resolve(out);
                    const v = cursor.value;
                    if (String(v.title || '').toLowerCase().includes(q) || String(v.url || '').toLowerCase().includes(q)) out.push(v);
                    cursor.continue();
                };
                req.onerror = () => resolve(out);
            });
        } catch (_) { return []; }
    }

    async removeHistory(id) {
        if (!this._supported) return false;
        try {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readwrite');
            tx.objectStore('history').delete(Number(id));
            await txComplete(tx);
            broadcast('history-changed');
            return true;
        } catch (_) { return false; }
    }

    async clearHistory() {
        if (!this._supported) {
            try { localStorage.setItem('browsing-history', '[]'); } catch (_) { }
            broadcast('history-changed');
            return true;
        }
        try {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readwrite');
            tx.objectStore('history').clear();
            await txComplete(tx);
            broadcast('history-changed');
            return true;
        } catch (_) { return false; }
    }

    async migrateLegacy({ storeGet } = {}) {
        if (!this._supported) return;
        try {
            // Migrate theme, searchEngine from localStorage or Electron store
            const engine = localStorage.getItem('searchEngine') || (storeGet ? await storeGet('searchEngine') : null);
            if (engine) await this.setKV('searchEngine', engine);

            const theme = localStorage.getItem('theme') || (storeGet ? await storeGet('sumTheme') : null);
            if (theme) await this.setKV('theme', theme);

            const showBar = localStorage.getItem('showBookmarksBar') || (storeGet ? await storeGet('showBookmarksBar') : null);
            if (showBar !== null) await this.setKV('showBookmarksBar', showBar === 'true' || showBar === true);

            // Migrate bookmarks from localStorage
            const legacyBookmarks = safeParseJson(localStorage.getItem('bookmarks'), []);
            if (Array.isArray(legacyBookmarks) && legacyBookmarks.length > 0) {
                const current = await this.getBookmarks();
                if (current.length === 0) await this.setBookmarks(legacyBookmarks);
            }
        } catch (e) {
            console.error('[DB] Migration failed:', e);
        }
    }
}

export const db = new KitsDB();
