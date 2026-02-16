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
    try { return JSON.parse(v); } catch (_) { return fallback; }
}

function normalizeBookmark(bm) {
    if (!bm || typeof bm !== 'object') return null;
    const url = typeof bm.url === 'string' ? bm.url.trim() : '';
    if (!url) return null;
    const title = typeof bm.title === 'string' && bm.title.trim() ? bm.title.trim() : url;
    const time = Number.isFinite(bm.time) ? bm.time : Date.now();
    return { url, title, time };
}

function normalizeHistoryItem(h) {
    if (!h || typeof h !== 'object') return null;
    const url = typeof h.url === 'string' ? h.url.trim() : '';
    if (!url) return null;
    const title = typeof h.title === 'string' ? h.title.trim() : '';
    const time = Number.isFinite(h.time) ? h.time : Date.now();
    return { url, title, time };
}

class KitsDB {
    constructor() {
        this._dbPromise = null;
        this._supported = isIndexedDBAvailable();
        this._lastHistory = { url: '', time: 0 };
        this._historyCleanupTimer = null;
    }

    supported() { return this._supported; }

    async open() {
        if (!this._supported) return null;
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('kv')) {
                    db.createObjectStore('kv', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('bookmarks')) {
                    const store = db.createObjectStore('bookmarks', { keyPath: 'url' });
                    store.createIndex('by_time', 'time', { unique: false });
                    store.createIndex('by_title', 'title', { unique: false });
                }
                if (!db.objectStoreNames.contains('history')) {
                    const store = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('by_time', 'time', { unique: false });
                    store.createIndex('by_url', 'url', { unique: false });
                    store.createIndex('by_title', 'title', { unique: false });
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
            const store = tx.objectStore('kv');
            const rec = await requestToPromise(store.get(key));
            await txComplete(tx);
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
            const store = tx.objectStore(storeName);
            const n = await requestToPromise(store.count());
            await txComplete(tx);
            return Number(n) || 0;
        } catch (_) { return 0; }
    }

    async getBookmarks({ limit = 5000 } = {}) {
        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            return Array.isArray(list) ? list.map(normalizeBookmark).filter(Boolean) : [];
        }

        const db = await this.open();
        return new Promise((resolve) => {
            const tx = db.transaction(['bookmarks'], 'readonly');
            const store = tx.objectStore('bookmarks').index('by_time');
            const out = [];
            const req = store.openCursor(null, 'prev');

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor || out.length >= limit) return resolve(out);
                out.push(cursor.value);
                cursor.continue();
            };
            req.onerror = () => resolve(out);
        });
    }

    async setBookmarks(bookmarks = []) {
        const list = Array.isArray(bookmarks) ? bookmarks.map(normalizeBookmark).filter(Boolean) : [];

        if (!this._supported) {
            try { localStorage.setItem('bookmarks', JSON.stringify(list)); } catch (_) { }
            broadcast('bookmarks-changed');
            return list;
        }

        const db = await this.open();
        const tx = db.transaction(['bookmarks'], 'readwrite');
        const store = tx.objectStore('bookmarks');
        store.clear();
        for (const bm of list) store.put(bm);
        await txComplete(tx);
        broadcast('bookmarks-changed');
        return list;
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
            next.sort((a, b) => (b.time || 0) - (a.time || 0));
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
        const u = typeof url === 'string' ? url.trim() : '';
        if (!u) return false;

        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            const next = Array.isArray(list) ? list.map(normalizeBookmark).filter(Boolean) : [];
            const filtered = next.filter(b => b.url !== u);
            try { localStorage.setItem('bookmarks', JSON.stringify(filtered)); } catch (_) { }
            broadcast('bookmarks-changed');
            return true;
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readwrite');
            tx.objectStore('bookmarks').delete(u);
            await txComplete(tx);
            broadcast('bookmarks-changed');
            return true;
        } catch (_) { return false; }
    }

    async isBookmarked(url) {
        const u = typeof url === 'string' ? url.trim() : '';
        if (!u) return false;

        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
            return Array.isArray(list) && list.some(b => b?.url === u);
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['bookmarks'], 'readonly');
            const rec = await requestToPromise(tx.objectStore('bookmarks').get(u));
            await txComplete(tx);
            return !!rec;
        } catch (_) { return false; }
    }

    async addHistory(item, { maxEntries = 20_000 } = {}) {
        const h = normalizeHistoryItem(item);
        if (!h) return false;

        // Cheap in-memory de-dupe.
        if (this._lastHistory.url === h.url && (Date.now() - this._lastHistory.time) < 2_500) return true;
        this._lastHistory = { url: h.url, time: Date.now() };

        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('browsing-history') || '[]', []);
            const next = Array.isArray(list) ? list.map(normalizeHistoryItem).filter(Boolean) : [];
            next.push(h);
            // Keep a reasonable size for legacy fallback.
            const trimmed = next.slice(-Math.min(maxEntries, 2000));
            try { localStorage.setItem('browsing-history', JSON.stringify(trimmed)); } catch (_) { }
            broadcast('history-changed');
            return true;
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readwrite');
            tx.objectStore('history').add(h);
            await txComplete(tx);

            // Opportunistic cleanup.
            this._scheduleHistoryCleanup(maxEntries);
            broadcast('history-changed');
            return true;
        } catch (_) { return false; }
    }

    _scheduleHistoryCleanup(maxEntries) {
        if (!this._supported) return;
        if (this._historyCleanupTimer) return;
        this._historyCleanupTimer = setTimeout(() => {
            this._historyCleanupTimer = null;
            this.cleanupHistory({ maxEntries }).catch(() => { });
        }, 2000);
    }

    async cleanupHistory({ maxEntries = 20_000 } = {}) {
        if (!this._supported) return false;
        const total = await this.count('history');
        if (total <= maxEntries) return true;

        const toDelete = total - maxEntries;
        const db = await this.open();

        return new Promise((resolve) => {
            let deleted = 0;
            const tx = db.transaction(['history'], 'readwrite');
            const store = tx.objectStore('history').index('by_time');
            const req = store.openCursor(null, 'next'); // oldest first

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor || deleted >= toDelete) return resolve(true);
                cursor.delete();
                deleted++;
                cursor.continue();
            };
            req.onerror = () => resolve(false);
        });
    }

    async getHistory({ query = '', limit = 1500 } = {}) {
        const q = String(query || '').toLowerCase().trim();

        if (!this._supported) {
            const list = safeParseJson(localStorage.getItem('browsing-history') || '[]', []);
            const arr = Array.isArray(list) ? list.map(normalizeHistoryItem).filter(Boolean) : [];
            const filtered = q ? arr.filter(h => String(h.title || '').toLowerCase().includes(q) || String(h.url || '').toLowerCase().includes(q)) : arr;
            return filtered.slice(-limit).reverse().map((h, idx) => ({ id: idx + 1, ...h }));
        }

        const db = await this.open();
        return new Promise((resolve) => {
            const out = [];
            const tx = db.transaction(['history'], 'readonly');
            const index = tx.objectStore('history').index('by_time');
            const req = index.openCursor(null, 'prev'); // newest first

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor || out.length >= limit) return resolve(out);
                const v = cursor.value;
                if (!q || String(v?.title || '').toLowerCase().includes(q) || String(v?.url || '').toLowerCase().includes(q)) out.push(v);
                cursor.continue();
            };
            req.onerror = () => resolve(out);
        });
    }

    async removeHistory(id) {
        const n = Number(id);
        if (!Number.isFinite(n)) return false;

        if (!this._supported) {
            // Legacy fallback cannot map stable IDs; no-op.
            return false;
        }

        try {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readwrite');
            tx.objectStore('history').delete(n);
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
        if (!this._supported) return false;

        const migrated = await this.getKV('__migrated_v1', false);
        if (migrated) return true;

        // Merge bookmarks from localStorage + optional electron-store.
        const lsBookmarks = safeParseJson(localStorage.getItem('bookmarks') || '[]', []);
        let storeBookmarks = [];
        if (typeof storeGet === 'function') {
            try {
                const v = await storeGet('bookmarks');
                storeBookmarks = Array.isArray(v) ? v : [];
            } catch (_) { storeBookmarks = []; }
        }

        const mergedMap = new Map();
        for (const bm of [...storeBookmarks, ...lsBookmarks]) {
            const n = normalizeBookmark(bm);
            if (!n) continue;
            const existing = mergedMap.get(n.url);
            if (!existing || (n.time || 0) >= (existing.time || 0)) mergedMap.set(n.url, n);
        }
        const mergedBookmarks = [...mergedMap.values()].sort((a, b) => (b.time || 0) - (a.time || 0));

        // History (best-effort; only import if DB is empty)
        const historyCount = await this.count('history');
        const lsHistory = safeParseJson(localStorage.getItem('browsing-history') || '[]', []);
        const historyToImport = historyCount === 0 && Array.isArray(lsHistory)
            ? lsHistory.map(normalizeHistoryItem).filter(Boolean)
            : [];

        // Settings
        const theme = localStorage.getItem('theme');
        const searchEngine = localStorage.getItem('searchEngine');
        const showBookmarksBar = localStorage.getItem('showBookmarksBar');
        const profile = safeParseJson(localStorage.getItem('profile') || 'null', null);

        // Commit migration.
        if (mergedBookmarks.length > 0) await this.setBookmarks(mergedBookmarks);
        if (historyToImport.length > 0) {
            const db = await this.open();
            const tx = db.transaction(['history'], 'readwrite');
            const store = tx.objectStore('history');
            for (const h of historyToImport) store.add(h);
            await txComplete(tx);
        }
        if (theme) await this.setKV('theme', theme);
        if (searchEngine) await this.setKV('searchEngine', searchEngine);
        if (showBookmarksBar !== null) await this.setKV('showBookmarksBar', showBookmarksBar === 'true');
        if (profile && typeof profile === 'object') await this.setKV('profile', profile);

        await this.setKV('__migrated_v1', true);
        return true;
    }
}

export const db = new KitsDB();
