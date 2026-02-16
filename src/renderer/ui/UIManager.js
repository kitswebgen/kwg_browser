
import { db } from '../db.js';

export class UIManager {
    constructor(tabManager, profileManager) {
        this.TM = tabManager;
        this.PM = profileManager;
        this.notificationTimeout = null;
        this.zoomTimeout = null;
        this.suggestionDebounce = null;
        this.selectedSuggestionIndex = -1;
        this.findActive = false;
        this._uiUpdatePending = false;
        this._clockTimeout = null;
        this._bookmarksCache = [];
        this._bookmarkUrlSet = new Set();
        this._dbChannel = null;
        this._dbSyncTimers = { bookmarks: null, kv: null };
        this._omniboxOverlaySpace = 0;
        this._omniboxOverlayRaf = null;

        this.elements = {
            omnibox: document.getElementById('omnibox'),
            suggestionsList: document.getElementById('suggestions-list'),
            backBtn: document.getElementById('back-btn'),
            forwardBtn: document.getElementById('forward-btn'),
            refreshBtn: document.getElementById('refresh-btn'),
            homeBtn: document.getElementById('home-btn'),
            secureIcon: document.getElementById('secure-icon'),
            palette: document.getElementById('command-palette'),
            paletteInput: document.getElementById('palette-input'),
            notification: document.getElementById('notification'),
            notificationMsg: document.getElementById('notification-msg'),
            findBar: document.getElementById('find-bar'),
            findInput: document.getElementById('find-input'),
            findCount: document.getElementById('find-count'),
            zoomIndicator: document.getElementById('zoom-indicator'),
            zoomLevelEl: document.getElementById('zoom-level'),
            engineSelect: document.getElementById('engine-select'),
            themeSelect: document.getElementById('theme-select'),
            adblockToggle: document.getElementById('adblock-toggle')
        };

        this.searchEngines = {
            google: 'https://www.google.com/search?q=',
            bing: 'https://www.bing.com/search?q=',
            duckduckgo: 'https://duckduckgo.com/?q=',
            brave: 'https://search.brave.com/search?q='
        };
        this.currentSearchEngine = localStorage.getItem('searchEngine') || 'google';
        this.showBookmarksBar = localStorage.getItem('showBookmarksBar') !== 'false';
        this.paletteSelectedIndex = 0;
        this.theme = localStorage.getItem('theme') || 'system';
    }

    init() {
        this.setupEventListeners();
        this.setupOmnibox();
        this.setupCommandPalette();
        this.setupFindBar();
        this.setupSettings();
        this.setupDownloads();
        this.setupOverlayGuards();

        // Restore search engine selection
        if (this.elements.engineSelect) this.elements.engineSelect.value = this.currentSearchEngine;
        if (this.elements.themeSelect) this.elements.themeSelect.value = this.theme;
        this.applyTheme(this.theme);

        // Hydrate preferences/bookmarks from IndexedDB if available.
        this.hydrateFromDB();

        // Keep UI in sync with internal pages (webviews) that also write to IndexedDB.
        this.setupDbBroadcastSync();

        // Global Clock
        this.startGlobalClock();
    }

    setupOverlayGuards() {
        const update = () => {
            const anyModalOpen = [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'));
            document.body.classList.toggle('overlay-open', anyModalOpen);
        };

        const observer = new MutationObserver(update);
        document.querySelectorAll('.modal').forEach((m) => {
            observer.observe(m, { attributes: true, attributeFilter: ['class'] });
        });

        update();
    }

    setupDbBroadcastSync() {
        if (this._dbChannel) return;

        let bc = null;
        try { bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kits-db') : null; }
        catch (_) { bc = null; }
        if (!bc) return;

        this._dbChannel = bc;

        const scheduleBookmarks = () => {
            if (this._dbSyncTimers.bookmarks) clearTimeout(this._dbSyncTimers.bookmarks);
            this._dbSyncTimers.bookmarks = setTimeout(async () => {
                this._dbSyncTimers.bookmarks = null;
                await this.getBookmarks();
                this.renderBookmarksBar(this._bookmarksCache);
                this.updateUI();
            }, 80);
        };

        const scheduleKv = () => {
            if (this._dbSyncTimers.kv) clearTimeout(this._dbSyncTimers.kv);
            this._dbSyncTimers.kv = setTimeout(async () => {
                this._dbSyncTimers.kv = null;
                await this._syncPrefsFromDB();
            }, 50);
        };

        bc.addEventListener('message', (e) => {
            const msg = e?.data || {};
            const type = msg?.type;
            if (type === 'bookmarks-changed') scheduleBookmarks();
            if (type === 'kv-changed') scheduleKv();
        });
    }

    async _syncPrefsFromDB() {
        if (!db?.supported?.()) return;
        try {
            const storedEngine = await db.getKV('searchEngine', null);
            if (storedEngine && typeof storedEngine === 'string') this.currentSearchEngine = storedEngine;

            const storedTheme = await db.getKV('theme', null);
            if (storedTheme && typeof storedTheme === 'string') this.theme = storedTheme;

            const storedShow = await db.getKV('showBookmarksBar', null);
            if (typeof storedShow === 'boolean') this.showBookmarksBar = storedShow;

            try { localStorage.setItem('searchEngine', this.currentSearchEngine); } catch (_) { }
            try { localStorage.setItem('theme', this.theme); } catch (_) { }
            try { localStorage.setItem('showBookmarksBar', String(this.showBookmarksBar)); } catch (_) { }

            if (this.elements.engineSelect) this.elements.engineSelect.value = this.currentSearchEngine;
            if (this.elements.themeSelect) this.elements.themeSelect.value = this.theme;
            this.applyTheme(this.theme);
            this.renderBookmarksBar();
            this.updateUI();
        } catch (_) { }
    }

    async hydrateFromDB() {
        if (!db?.supported?.()) return;

        try {
            const storedEngine = await db.getKV('searchEngine', null);
            if (storedEngine && typeof storedEngine === 'string') this.currentSearchEngine = storedEngine;

            const storedTheme = await db.getKV('theme', null);
            if (storedTheme && typeof storedTheme === 'string') this.theme = storedTheme;

            const storedShow = await db.getKV('showBookmarksBar', null);
            if (typeof storedShow === 'boolean') this.showBookmarksBar = storedShow;

            // Keep localStorage in sync for internal pages and quick access.
            try { localStorage.setItem('searchEngine', this.currentSearchEngine); } catch (_) { }
            try { localStorage.setItem('theme', this.theme); } catch (_) { }
            try { localStorage.setItem('showBookmarksBar', String(this.showBookmarksBar)); } catch (_) { }

            if (this.elements.engineSelect) this.elements.engineSelect.value = this.currentSearchEngine;
            if (this.elements.themeSelect) this.elements.themeSelect.value = this.theme;
            this.applyTheme(this.theme);

            await this.getBookmarks();
            this.renderBookmarksBar();
            this.updateUI();
        } catch (_) { }
    }

    startGlobalClock() {
        if (this._clockTimeout) clearTimeout(this._clockTimeout);

        const tick = () => {
            this.updateGlobalClock();
            const now = new Date();
            const msToNextMinute = ((60 - now.getSeconds()) * 1000) - now.getMilliseconds();
            this._clockTimeout = setTimeout(tick, Math.max(1_000, msToNextMinute + 25));
        };

        tick();
    }

    showNotification(msg, duration = 3000) {
        const { notification, notificationMsg } = this.elements;
        if (!notification || !notificationMsg) return;
        clearTimeout(this.notificationTimeout);
        notificationMsg.textContent = msg;
        notification.classList.remove('hidden');
        this.notificationTimeout = setTimeout(() => notification.classList.add('hidden'), duration);
    }

    showZoomIndicator(level) {
        const { zoomIndicator, zoomLevelEl } = this.elements;
        if (!zoomIndicator) return;
        zoomLevelEl.textContent = `${Math.round(level * 100)}%`;
        zoomIndicator.classList.remove('hidden');
        clearTimeout(this.zoomTimeout);
        this.zoomTimeout = setTimeout(() => zoomIndicator.classList.add('hidden'), 1500);
    }

    updateUI() {
        if (this._uiUpdatePending) return;
        this._uiUpdatePending = true;
        requestAnimationFrame(() => {
            this._uiUpdatePending = false;
            this._updateUIImmediate();
        });
    }

    _updateUIImmediate() {
        const active = this.TM?.getActive?.();
        if (!active) return;

        try {
            const webview = active.webviewEl;
            const url = webview.getURL();
            const isInternal = !url.startsWith('http');
            const isIncognito = !!active.incognito;
            const { omnibox, backBtn, forwardBtn, secureIcon } = this.elements;

            if (document.activeElement !== omnibox) {
                omnibox.value = isInternal ? '' : url;
                omnibox.placeholder = isInternal
                    ? `Search ${this.currentSearchEngine.charAt(0).toUpperCase() + this.currentSearchEngine.slice(1)} or type a URL...`
                    : url;
            }

            backBtn.disabled = !webview.canGoBack();
            forwardBtn.disabled = !webview.canGoForward();

            const sessionInfo = document.getElementById('session-info');
            if (url.startsWith('https://')) {
                if (secureIcon) {
                    secureIcon.style.display = 'inline-flex';
                    secureIcon.dataset.state = 'secure';
                    secureIcon.title = 'Secure connection (HTTPS)';
                    secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
                }
                if (sessionInfo) {
                    sessionInfo.textContent = `${isIncognito ? '🕶 ' : ''}${new URL(url).hostname}`;
                    sessionInfo.style.color = '#81C995';
                }
            } else if (url.startsWith('http://')) {
                if (secureIcon) {
                    secureIcon.style.display = 'inline-flex';
                    secureIcon.dataset.state = 'warning';
                    secureIcon.title = 'Not secure (HTTP)';
                    secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
                }
                if (sessionInfo) {
                    sessionInfo.textContent = `${isIncognito ? '🕶 ' : ''}⚠ Not Secure`;
                    sessionInfo.style.color = '#FEBC2E';
                }
            } else {
                if (secureIcon) {
                    secureIcon.style.display = 'inline-flex';
                    secureIcon.dataset.state = 'neutral';
                    secureIcon.title = 'Internal page';
                    secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
                }
                if (sessionInfo) {
                    if (isIncognito) sessionInfo.textContent = '🕶 Incognito';
                    else sessionInfo.textContent = this.PM.isLoggedIn() ? `Signed in as ${this.PM.profile.name}` : 'KITSWebGen';
                    sessionInfo.style.color = '#E3E3E3';
                }
            }

            const bmBtn = document.getElementById('bookmark-btn');
            if (bmBtn) {
                if (url.startsWith('http')) bmBtn.classList.toggle('bookmarked', this.isBookmarked(url));
                else bmBtn.classList.remove('bookmarked');
            }

            const statusText = document.getElementById('status-text');
            if (statusText) statusText.textContent = webview.isLoading() ? 'Loading...' : 'Ready';
        } catch (e) { console.error(e); }
    }

    navigateOmnibox() {
        const { omnibox, suggestionsList } = this.elements;
        let input = omnibox.value.trim();
        if (!input) return;
        const active = this.TM.getActive();
        if (!active) return;

        if (input === 'kits://history') { this.TM.createTab('history.html'); omnibox.blur(); return; }
        if (input === 'kits://bookmarks') { this.TM.createTab('bookmarks.html'); omnibox.blur(); return; }
        if (input === 'kits://downloads') { this.openDownloads(); omnibox.blur(); return; }
        if (input === 'kits://newtab') { this.TM.createTab('ntp.html'); omnibox.blur(); return; }
        if (input === 'kits://settings') { document.getElementById('settings-modal').classList.remove('hidden'); omnibox.blur(); return; }

        if (!input.startsWith('http://') && !input.startsWith('https://')) {
            if (input.includes('.') && !input.includes(' ')) input = 'https://' + input;
            else input = this.searchEngines[this.currentSearchEngine] + encodeURIComponent(input);
        }
        active.webviewEl.loadURL(input);
        omnibox.blur();
        suggestionsList.classList.add('hidden');
        this._setOmniboxOverlaySpace(0);
    }

    setupOmnibox() {
        const { omnibox, suggestionsList } = this.elements;

        omnibox.addEventListener('input', () => {
            clearTimeout(this.suggestionDebounce);
            this.selectedSuggestionIndex = -1;
            const query = omnibox.value.trim();
            if (query.length < 2) { suggestionsList.classList.add('hidden'); this._setOmniboxOverlaySpace(0); return; }

            this.suggestionDebounce = setTimeout(async () => {
                try {
                    const local = this.getLocalUrlSuggestions(query);
                    let remote = [];
                    if (window.electronAPI?.getSearchSuggestions) {
                        remote = await window.electronAPI.getSearchSuggestions(query, this.currentSearchEngine);
                    } else {
                        const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`);
                        const data = await res.json();
                        remote = data?.[1] || [];
                    }
                    const remoteItems = (Array.isArray(remote) ? remote : [])
                        .filter(s => typeof s === 'string')
                        .map(s => ({ type: 'search', value: s, label: s }));

                    const seen = new Set();
                    const combined = [...local, ...remoteItems].filter(s => {
                        const v = String(s?.value || '').trim();
                        if (!v || seen.has(v)) return false;
                        seen.add(v);
                        return true;
                    });

                    this.renderSuggestions(combined);
                } catch (e) { suggestionsList.classList.add('hidden'); this._setOmniboxOverlaySpace(0); }
            }, 200);
        });

        omnibox.addEventListener('keydown', (e) => {
            const items = suggestionsList.querySelectorAll('.suggestion-item');
            if (items.length === 0 || suggestionsList.classList.contains('hidden')) {
                if (e.key === 'Enter') { e.preventDefault(); this.navigateOmnibox(); }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectedSuggestionIndex = Math.min(this.selectedSuggestionIndex + 1, items.length - 1);
                this.highlightSuggestion(items);
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectedSuggestionIndex = Math.max(this.selectedSuggestionIndex - 1, 0);
                this.highlightSuggestion(items);
            }
            else if (e.key === 'Enter') { e.preventDefault(); this.navigateOmnibox(); }
            else if (e.key === 'Escape') { suggestionsList.classList.add('hidden'); this._setOmniboxOverlaySpace(0); this.selectedSuggestionIndex = -1; }
        });

        omnibox.addEventListener('blur', () => setTimeout(() => { suggestionsList.classList.add('hidden'); this._setOmniboxOverlaySpace(0); this.selectedSuggestionIndex = -1; }, 200));
        omnibox.addEventListener('focus', () => {
            omnibox.select();
            if (window.innerWidth < 800) {
                // Maybe hide other elements or expand omnibox if needed, for now just ensure select
            }
        });

        window.addEventListener('resize', () => this._scheduleOmniboxOverlaySpaceUpdate());
    }

    _setOmniboxOverlaySpace(px) {
        const chrome = document.querySelector('.browser-chrome');
        if (!chrome) return;
        const next = Math.max(0, Math.min(520, Math.round(Number(px) || 0)));
        if (next === this._omniboxOverlaySpace) return;
        this._omniboxOverlaySpace = next;
        if (next === 0) chrome.style.removeProperty('--omnibox-overlay-space');
        else chrome.style.setProperty('--omnibox-overlay-space', `${next}px`);
    }

    _scheduleOmniboxOverlaySpaceUpdate() {
        if (this._omniboxOverlayRaf) cancelAnimationFrame(this._omniboxOverlayRaf);
        this._omniboxOverlayRaf = requestAnimationFrame(() => {
            this._omniboxOverlayRaf = null;
            this._updateOmniboxOverlaySpace();
        });
    }

    _updateOmniboxOverlaySpace() {
        const { suggestionsList } = this.elements;
        if (!suggestionsList || suggestionsList.classList.contains('hidden')) return this._setOmniboxOverlaySpace(0);
        const chrome = document.querySelector('.browser-chrome');
        if (!chrome) return;

        const chromeRect = chrome.getBoundingClientRect();
        const listRect = suggestionsList.getBoundingClientRect();
        const extra = Math.max(0, listRect.bottom - chromeRect.bottom + 10);
        this._setOmniboxOverlaySpace(extra);
    }

    renderSuggestions(list) {
        const { suggestionsList, omnibox } = this.elements;
        if (!list || list.length === 0) { suggestionsList.classList.add('hidden'); this._setOmniboxOverlaySpace(0); return; }
        const frag = document.createDocumentFragment();
        list.slice(0, 8).forEach((raw) => {
            const s = typeof raw === 'string' ? { type: 'search', value: raw, label: raw } : raw;
            const value = String(s?.value ?? s?.label ?? '').trim();
            const labelText = String(s?.label ?? s?.value ?? '').trim();
            if (!value) return;

            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.dataset.value = value;
            div.innerHTML = s?.type === 'url'
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.45; flex-shrink:0;"><path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 1 1 7 7l-1 1"/><path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 1 1-7-7l1-1"/></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4; flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
            const label = document.createElement('span');
            label.textContent = labelText;
            div.appendChild(label);
            div.onclick = () => { omnibox.value = value; this.navigateOmnibox(); };
            frag.appendChild(div);
        });
        suggestionsList.replaceChildren(frag);
        suggestionsList.classList.remove('hidden');
        this._scheduleOmniboxOverlaySpaceUpdate();
    }

    highlightSuggestion(items) {
        items.forEach((el, i) => el.classList.toggle('selected', i === this.selectedSuggestionIndex));
        if (this.selectedSuggestionIndex >= 0) {
            const el = items[this.selectedSuggestionIndex];
            this.elements.omnibox.value = el?.dataset?.value || el?.querySelector?.('span')?.textContent || '';
        }
    }

    getLocalUrlSuggestions(query) {
        const q = String(query || '').toLowerCase().trim();
        if (!q) return [];

        const out = [];
        const seen = new Set();
        const push = (url) => {
            const u = String(url || '').trim();
            if (!u || seen.has(u)) return;
            seen.add(u);
            out.push({ type: 'url', value: u, label: u });
        };

        // Bookmarks first
        try {
            const bookmarks = this._bookmarksCache?.length ? this._bookmarksCache : this._readLocalArray('bookmarks');
            for (const bm of bookmarks) {
                if (out.length >= 4) break;
                const title = String(bm?.title || '').toLowerCase();
                const url = String(bm?.url || '');
                if (title.includes(q) || url.toLowerCase().includes(q)) push(url);
            }
        } catch (_) { }

        // History (most recent first)
        try {
            let history = [];
            try { history = JSON.parse(localStorage.getItem('browsing-history') || '[]'); } catch (_) { history = []; }
            if (Array.isArray(history)) {
                for (let i = history.length - 1; i >= 0 && out.length < 8; i--) {
                    const h = history[i];
                    const title = String(h?.title || '').toLowerCase();
                    const url = String(h?.url || '');
                    if (!url) continue;
                    if (title.includes(q) || url.toLowerCase().includes(q)) push(url);
                }
            }
        } catch (_) { }

        return out;
    }

    setupEventListeners() {
        const { backBtn, forwardBtn, refreshBtn, homeBtn } = this.elements;

        backBtn.onclick = () => this.TM.goBack();
        forwardBtn.onclick = () => this.TM.goForward();
        refreshBtn.onclick = () => this.TM.reload();
        homeBtn.onclick = () => { const a = this.TM.getActive(); if (a) a.webviewEl.src = 'ntp.html'; };

        document.getElementById('new-tab-btn').onclick = () => this.TM.createTab();

        document.getElementById('zen-btn').onclick = () => this.toggleZenMode();
        document.getElementById('reader-btn').onclick = () => this.toggleReaderMode();
        document.getElementById('bookmark-btn').onclick = () => this.bookmarkCurrentPage();
        document.getElementById('menu-btn').onclick = (e) => { e.stopPropagation(); this.toggleAppMenu(); };
        document.getElementById('sidebar-settings-btn').addEventListener('click', () => this.TM.createTab('settings.html'));

        // Window controls
        document.getElementById('min-btn').onclick = () => window.electronAPI?.minimizeWindow?.();
        document.getElementById('max-btn').onclick = () => window.electronAPI?.toggleFullscreen?.();
        document.getElementById('close-btn-win').onclick = () => window.electronAPI?.closeWindow?.();
        document.getElementById('titleapi')?.addEventListener('dblclick', (e) => {
            const t = e?.target;
            if (t?.closest?.('.tab, .new-tab-btn, .win-btn, input, button')) return;
            window.electronAPI?.maximizeWindow?.();
        });

        // Site info indicator
        const secBtn = document.getElementById('secure-icon');
        if (secBtn) {
            secBtn.style.cursor = 'pointer';
            secBtn.onclick = () => this.showSiteInfo();
        }

        // Security banner close
        const bannerClose = document.getElementById('security-banner-close');
        if (bannerClose) bannerClose.onclick = () => document.getElementById('security-banner')?.classList.add('hidden');

        // App menu items
        document.querySelectorAll('.app-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                switch (action) {
                    case 'new-tab': this.TM.createTab(); break;
                    case 'new-incognito-tab': this.newIncognitoTab(); break;
                    case 'reopen-closed': {
                        const ok = this.TM.reopenClosedTab?.();
                        if (!ok) this.showNotification('No recently closed tabs');
                        break;
                    }
                    case 'history': this.TM.createTab('history.html'); break;
                    case 'bookmarks': this.TM.createTab('bookmarks.html'); break;
                    case 'downloads': this.openDownloads(); break;
                    case 'clear-browsing-data': this.openClearDataModal(); break;
                    case 'privacy': window.openPrivacyDashboard?.(); break;
                    case 'settings': document.getElementById('settings-modal')?.classList.remove('hidden'); break;
                    case 'screenshot': this.takeScreenshot(); break;
                    case 'about': window.openAboutModal?.(); break;
                    case 'system-info': window.openSystemInfo?.(); break;
                }
                this.closeAppMenu();
            });
        });

        // Close app menu on outside click
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('app-menu');
            const btn = document.getElementById('menu-btn');
            if (!menu || menu.classList.contains('hidden')) return;
            if (menu.contains(e.target) || btn?.contains(e.target)) return;
            this.closeAppMenu();
        });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Sidebar
        document.querySelectorAll('.side-item').forEach(item => {
                item.addEventListener('click', () => {
                    const title = item.getAttribute('title');

                    document.querySelectorAll('.side-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');

                if (title === 'Settings') {
                    this.TM.createTab('settings.html');
                } else {
                    this.handleSidebarClick(title);
                }
            });
        });
    }

    handleSidebarClick(title) {
        switch (title) {
            case 'History': this.TM.createTab('history.html'); break;
            case 'Bookmarks': this.TM.createTab('bookmarks.html'); break;
            case 'Settings': document.getElementById('settings-modal').classList.remove('hidden'); break;
            case 'Privacy Dashboard': window.openPrivacyDashboard?.(); break;
            case 'Search': this.TM.createTab('ntp.html'); break;
            case 'Downloads': this.openDownloads(); break;
            default: if (title?.includes('Command')) this.togglePalette(); break;
        }
    }

    newIncognitoTab() {
        const theme = String(this.theme || 'system');
        const themeParam = theme === 'dark' || theme === 'light' ? `?theme=${encodeURIComponent(theme)}` : '';
        this.TM.createTab(`incognito.html${themeParam}`, { active: true, incognito: true });
        this.showNotification('🕶 Incognito tab opened');
    }

    openClearDataModal() {
        document.getElementById('clear-data-modal')?.classList.remove('hidden');
    }

    closeClearDataModal() {
        document.getElementById('clear-data-modal')?.classList.add('hidden');
    }

    async confirmClearDataFromModal() {
        const history = document.getElementById('clear-data-history')?.checked;
        const cache = document.getElementById('clear-data-cache')?.checked;
        const cookies = document.getElementById('clear-data-cookies')?.checked;
        const downloads = document.getElementById('clear-data-downloads')?.checked;
        const bookmarks = document.getElementById('clear-data-bookmarks')?.checked;

        if (!history && !cache && !cookies && !downloads && !bookmarks) {
            this.showNotification('Select at least one item to clear');
            return;
        }

        if (bookmarks) {
            const ok = confirm('This will delete your saved bookmarks. Continue?');
            if (!ok) return;
        }

        const confirmMsg = 'Clear selected browsing data now?';
        if (!confirm(confirmMsg)) return;

        const btn = document.getElementById('clear-data-confirm');
        if (btn) btn.disabled = true;

        this.showNotification('Clearing browsing data…', 2200);

        const tasks = [];

        if (history) {
            tasks.push((async () => {
                try { await db.clearHistory(); } catch (_) { }
                try { localStorage.setItem('browsing-history', '[]'); } catch (_) { }
            })());
        }

        if (bookmarks) {
            tasks.push((async () => {
                try { await this.setBookmarks([]); } catch (_) { }
            })());
        }

        if (downloads && window.electronAPI) {
            tasks.push((async () => {
                try { await window.electronAPI.storeSet('downloadHistory', []); } catch (_) { }
            })());
        }

        if (cache && window.electronAPI?.clearCache) {
            tasks.push((async () => {
                try { await window.electronAPI.clearCache({ cache: true }); } catch (_) { }
            })());
        }

        if (cookies && window.electronAPI?.clearSiteData) {
            tasks.push((async () => {
                try { await window.electronAPI.clearSiteData({ cookies: true, cacheStorage: true, serviceWorkers: true }); } catch (_) { }
            })());
        }

        await Promise.allSettled(tasks);

        if (btn) btn.disabled = false;
        this.closeClearDataModal();
        this.showNotification('🧹 Browsing data cleared', 3000);
        this.updateUI();
    }

    handleKeyboardShortcuts(e) {
        const mod = e.ctrlKey || e.metaKey;

        if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); this.togglePalette(); }
        if (mod && (e.key === 't' || e.key === 'T')) { e.preventDefault(); this.TM.createTab(); }
        if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); e.shiftKey ? this.TM.switchToPrevTab?.() : this.TM.switchToNextTab?.(); }
        if (mod && e.shiftKey && (e.key === 'T' || e.key === 't')) {
            e.preventDefault();
            const ok = this.TM.reopenClosedTab?.();
            if (!ok) this.showNotification('No recently closed tabs');
        }
        if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) { e.preventDefault(); this.toggleBookmarksBar(); }
        if (mod && e.shiftKey && (e.key === 'N' || e.key === 'n')) { e.preventDefault(); this.newIncognitoTab(); }
        if (mod && e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.openClearDataModal(); }
        if (mod && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (this.TM.activeTabId) this.TM.closeTab(this.TM.activeTabId); }
        if (mod && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); this.elements.omnibox.focus(); this.elements.omnibox.select(); }
        if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); this.bookmarkCurrentPage(); }
        if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); this.openFindBar(); }
        if (mod && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); const a = this.TM.getActive(); if (a) try { a.webviewEl.print(); } catch (e) { } }
        if (mod && e.key === '=') { e.preventDefault(); this.TM.zoomIn(); }
        if (mod && e.key === '-') { e.preventDefault(); this.TM.zoomOut(); }
        if (mod && e.key === '0') { e.preventDefault(); this.TM.zoomReset(); }
        if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); this.takeScreenshot(); }
        if (e.key === 'F5') { e.preventDefault(); this.TM.reload(); }
        if (e.key === 'F11') { e.preventDefault(); window.electronAPI?.toggleFullscreen?.(); }
        if (e.key === 'Escape') {
            if (this.findActive) this.closeFindBar();
            else if (!this.elements.palette.classList.contains('hidden')) this.togglePalette();
            // Close modals...
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            document.getElementById('tab-context-menu')?.classList.add('hidden');
            document.getElementById('app-menu')?.classList.add('hidden');
            document.getElementById('security-banner')?.classList.add('hidden');
            if (document.body.classList.contains('zen-mode')) this.toggleZenMode();
        }
    }

    toggleAppMenu() {
        const menu = document.getElementById('app-menu');
        const btn = document.getElementById('menu-btn');
        if (!menu || !btn) return;

        if (!menu.classList.contains('hidden')) {
            this.closeAppMenu();
            return;
        }

        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        // Position relative to the menu button, clamped to the viewport.
        requestAnimationFrame(() => {
            const b = btn.getBoundingClientRect();
            const m = menu.getBoundingClientRect();
            let left = b.right - m.width;
            let top = b.bottom + 8;
            left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
            if (top + m.height > window.innerHeight - 8) top = Math.max(8, b.top - m.height - 8);
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        });
    }

    closeAppMenu() {
        document.getElementById('app-menu')?.classList.add('hidden');
    }

    toggleZenMode() {
        document.body.classList.toggle('zen-mode');
        this.showNotification(document.body.classList.contains('zen-mode') ? '🧘 Zen Mode — Escape to exit' : 'Zen Mode off');
    }

    async toggleReaderMode() {
        const active = this.TM.getActive();
        if (!active) return;
        try {
            if (active.readerCssKey) {
                await active.webviewEl.removeInsertedCSS(active.readerCssKey);
                active.readerCssKey = null;
                this.showNotification('📖 Reader Mode off');
                return;
            }

            const key = await active.webviewEl.insertCSS(`
                body { max-width:800px !important; margin:0 auto !important; padding:40px !important; font-family:'Georgia',serif !important; line-height:1.8 !important; font-size:18px !important; background:#fdf6e3 !important; color:#586e75 !important; }
                img { max-width:100% !important; height:auto !important; }
                nav,header,footer,aside,.ads,.sidebar,[role="banner"],[role="navigation"],[role="complementary"],#comments,.comments { display:none !important; }
            `);
            active.readerCssKey = key;
            this.showNotification('📖 Reader Mode on');
        } catch (e) { this.showNotification('Reader Mode unavailable'); }
    }



    async bookmarkCurrentPage() {
        const active = this.TM.getActive();
        if (!active) return;
        try {
            const url = active.webviewEl.getURL();
            const title = active.webviewEl.getTitle();
            if (!url.startsWith('http')) { this.showNotification('Cannot bookmark this page'); return; }

            const already = this._bookmarkUrlSet.has(url) || await db.isBookmarked(url);
            if (already) {
                await db.removeBookmark(url);
                await this.getBookmarks();
                document.getElementById('bookmark-btn')?.classList.remove('bookmarked');
                this.showNotification(`⭐ Removed: ${title}`);
            } else {
                await db.upsertBookmark({ title, url, time: Date.now() });
                await this.getBookmarks();
                document.getElementById('bookmark-btn')?.classList.add('bookmarked');
                this.showNotification(`⭐ Bookmarked: ${title}`);
            }
            this.renderBookmarksBar(this._bookmarksCache);
        } catch (e) { console.error(e); this.showNotification('Failed to bookmark'); }
    }

    async renderBookmarksBar(bookmarks = null) {
        const bar = document.getElementById('bookmarks-bar');
        if (!bar) return;

        let list = Array.isArray(bookmarks) ? bookmarks : (Array.isArray(this._bookmarksCache) ? this._bookmarksCache : []);
        if (!Array.isArray(bookmarks) && (!Array.isArray(this._bookmarksCache) || this._bookmarksCache.length === 0)) {
            try { list = await this.getBookmarks(); } catch (_) { list = []; }
        }

        if (!this.showBookmarksBar || list.length === 0) { bar.classList.add('hidden'); return; }
        bar.classList.remove('hidden');
        const frag = document.createDocumentFragment();
        list.slice(0, 12).forEach(bm => {
            let domain = '';
            try { domain = new URL(bm.url).hostname; } catch (_) { }
            const btn = document.createElement('button');
            btn.className = 'bookmarks-bar-item';
            const img = document.createElement('img');
            img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
            img.onerror = () => { img.style.display = 'none'; };

            const label = document.createElement('span');
            label.textContent = String(bm.title || '').substring(0, 20);

            btn.appendChild(img);
            btn.appendChild(label);
            btn.onclick = () => { const a = this.TM.getActive(); if (a) a.webviewEl.loadURL(bm.url); else this.TM.createTab(bm.url); };
            frag.appendChild(btn);
        });
        bar.replaceChildren(frag);
    }

    toggleBookmarksBar() {
        this.showBookmarksBar = !this.showBookmarksBar;
        try { localStorage.setItem('showBookmarksBar', String(this.showBookmarksBar)); } catch (_) { }
        db.setKV('showBookmarksBar', this.showBookmarksBar).catch(() => { });
        this.renderBookmarksBar();
        this.showNotification(this.showBookmarksBar ? 'Bookmarks bar shown' : 'Bookmarks bar hidden');
    }

    isBookmarked(url) {
        if (!url || typeof url !== 'string') return false;
        return this._bookmarkUrlSet.has(url);
    }

    applyTheme(mode) {
        const m = mode === 'dark' || mode === 'light' ? mode : 'system';
        this.theme = m;
        if (m === 'system') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', m);
    }

    _readLocalArray(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (_) { return []; }
    }

    _mergeBookmarks(a = [], b = []) {
        const map = new Map();
        const add = (bm) => {
            if (!bm || typeof bm !== 'object') return;
            if (typeof bm.url !== 'string' || !bm.url) return;
            const url = bm.url;
            const existing = map.get(url);
            const next = {
                title: typeof bm.title === 'string' && bm.title.trim() ? bm.title : url,
                url,
                time: typeof bm.time === 'number' ? bm.time : Date.now()
            };
            if (!existing || (next.time || 0) >= (existing.time || 0)) map.set(url, next);
        };
        (b || []).forEach(add);
        (a || []).forEach(add);
        return [...map.values()].sort((x, y) => (y.time || 0) - (x.time || 0));
    }

    async getBookmarks() {
        let list = [];
        try { list = await db.getBookmarks({ limit: 5000 }); } catch (_) { list = []; }

        // Keep localStorage/electron-store in sync for robustness + legacy pages.
        try { localStorage.setItem('bookmarks', JSON.stringify(list)); } catch (_) { }
        if (window.electronAPI) {
            try { await window.electronAPI.storeSet('bookmarks', list); } catch (_) { }
        }

        this._bookmarksCache = list;
        this._bookmarkUrlSet = new Set(list.map(b => b.url));
        return list;
    }

    async setBookmarks(bookmarks) {
        const list = Array.isArray(bookmarks) ? bookmarks : [];
        let normalized = list;
        try { normalized = await db.setBookmarks(list); } catch (_) { normalized = list; }
        try { localStorage.setItem('bookmarks', JSON.stringify(normalized)); } catch (_) { }
        if (window.electronAPI) {
            try { await window.electronAPI.storeSet('bookmarks', normalized); } catch (_) { }
        }

        this._bookmarksCache = normalized;
        this._bookmarkUrlSet = new Set(normalized.map(b => b.url));
        return normalized;
    }

    showSiteInfo() {
        const active = this.TM.getActive();
        if (!active) return;
        try {
            const url = active.webviewEl.getURL();
            if (url.startsWith('https://')) this.showNotification('🔒 Secure connection (HTTPS)');
            else if (url.startsWith('http://')) this.showNotification('⚠️ Not secure (HTTP)');
            else this.showNotification('🌐 Internal page');
        } catch (_) {
            this.showNotification('Site info unavailable');
        }
    }

    setupDownloads() {
        const closeBtn = document.getElementById('close-downloads');
        const clearBtn = document.getElementById('downloads-clear-btn');
        const search = document.getElementById('downloads-search');
        const toast = document.getElementById('download-toast');

        closeBtn?.addEventListener('click', () => document.getElementById('downloads-modal')?.classList.add('hidden'));
        toast?.addEventListener('click', () => this.openDownloads());

        search?.addEventListener('input', (e) => this.renderDownloads(e.target.value || ''));

        clearBtn?.addEventListener('click', async () => {
            if (!window.electronAPI) {
                this.showNotification('Downloads history unavailable');
                return;
            }
            if (!confirm('Clear download history?')) return;
            await window.electronAPI.storeSet('downloadHistory', []);
            await this.renderDownloads(document.getElementById('downloads-search')?.value || '');
            this.showNotification('Download history cleared');
        });
    }

    async openDownloads() {
        const modal = document.getElementById('downloads-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        await this.renderDownloads(document.getElementById('downloads-search')?.value || '');
    }

    async refreshDownloadsIfOpen() {
        const modal = document.getElementById('downloads-modal');
        if (!modal || modal.classList.contains('hidden')) return;
        await this.renderDownloads(document.getElementById('downloads-search')?.value || '');
    }

    _formatBytes(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '—';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
        const v = n / (1024 ** i);
        return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
    }

    _formatWhen(ts) {
        const t = Number(ts);
        if (!Number.isFinite(t) || t <= 0) return '';
        try { return new Date(t).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
        catch (_) { return ''; }
    }

    async renderDownloads(filter = '') {
        const listEl = document.getElementById('downloads-list');
        if (!listEl) return;

        if (!window.electronAPI) {
            listEl.innerHTML = `<div style="padding:18px; opacity:0.7;">Downloads history is available in the desktop app.</div>`;
            return;
        }

        let history = [];
        try {
            const v = await window.electronAPI.storeGet('downloadHistory');
            history = Array.isArray(v) ? v : [];
        } catch (_) { history = []; }

        const q = String(filter || '').toLowerCase().trim();
        const filtered = q
            ? history.filter(h => String(h?.filename || '').toLowerCase().includes(q) || String(h?.path || '').toLowerCase().includes(q))
            : history;

        const ordered = [...filtered].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));

        if (ordered.length === 0) {
            listEl.innerHTML = `<div style="padding:18px; opacity:0.7;">No downloads yet.</div>`;
            return;
        }

        listEl.innerHTML = '';
        ordered.slice(0, 250).forEach((item) => {
            const row = document.createElement('div');
            row.className = 'download-item';

            const icon = document.createElement('div');
            icon.className = 'd-icon';
            icon.textContent = '⬇️';

            const info = document.createElement('div');
            info.className = 'd-info';

            const title = document.createElement('div');
            title.className = 'd-title';
            title.textContent = item?.filename || 'Download';

            const sub = document.createElement('div');
            sub.className = 'd-sub';
            const when = this._formatWhen(item?.timestamp);
            const size = this._formatBytes(item?.size);
            const status = String(item?.status || 'unknown');
            sub.textContent = [status, size, when].filter(Boolean).join(' • ');

            info.appendChild(title);
            info.appendChild(sub);

            const actions = document.createElement('div');
            actions.className = 'd-actions';

            const badge = document.createElement('span');
            const statusLower = status.toLowerCase();
            let badgeCls = '';
            if (statusLower === 'completed') badgeCls = 'completed';
            else if (statusLower === 'interrupted' || statusLower === 'cancelled') badgeCls = 'interrupted';
            else if (statusLower === 'failed') badgeCls = 'failed';
            badge.className = `download-badge ${badgeCls}`.trim();
            badge.textContent = statusLower;
            actions.appendChild(badge);

            if (item?.path) {
                const showBtn = document.createElement('button');
                showBtn.className = 'download-action';
                showBtn.textContent = 'Show';
                showBtn.onclick = () => window.electronAPI.openPath(item.path);
                actions.appendChild(showBtn);
            }

            row.appendChild(icon);
            row.appendChild(info);
            row.appendChild(actions);
            listEl.appendChild(row);
        });
    }

    setupCommandPalette() {
        const { palette, paletteInput } = this.elements;
        const results = document.getElementById('palette-results');
        if (!palette || !paletteInput || !results) return;

        const runCmd = (cmd, meta = {}) => {
            switch (cmd) {
                case 'new-tab': this.TM.createTab(); break;
                case 'new-incognito-tab': this.newIncognitoTab(); break;
                case 'toggle-zen': this.toggleZenMode(); break;
                case 'toggle-reader': this.toggleReaderMode(); break;
                case 'open-history': this.TM.createTab('history.html'); break;
                case 'open-bookmarks': this.TM.createTab('bookmarks.html'); break;
                case 'open-downloads': this.openDownloads(); break;
                case 'open-settings': document.getElementById('settings-modal')?.classList.remove('hidden'); break;
                case 'open-privacy': window.openPrivacyDashboard?.(); break;
                case 'clear-browsing-data': this.openClearDataModal(); break;
                case 'reopen-closed': {
                    const ok = this.TM.reopenClosedTab?.();
                    if (!ok) this.showNotification('No recently closed tabs');
                    break;
                }
                case 'toggle-bookmarks-bar': this.toggleBookmarksBar(); break;
                case 'screenshot': this.takeScreenshot(); break;
                case 'switch-tab': if (meta.tabId) this.TM.switchTab(meta.tabId); break;
            }
        };

        const build = (queryRaw = '') => {
            const q = String(queryRaw || '').toLowerCase().trim();
            results.innerHTML = '';

            const appendGroup = (label) => {
                const g = document.createElement('div');
                g.className = 'palette-group';
                g.textContent = label;
                results.appendChild(g);
            };

            const appendItem = ({ cmd, label, icon, kbd, tabId }) => {
                const item = document.createElement('div');
                item.className = 'palette-item';
                item.setAttribute('data-cmd', cmd);
                if (tabId) item.setAttribute('data-tab-id', tabId);

                const iconWrap = document.createElement('div');
                iconWrap.className = 'p-item-icon';
                iconWrap.textContent = icon || '•';

                const span = document.createElement('span');
                span.textContent = label;

                item.appendChild(iconWrap);
                item.appendChild(span);

                if (kbd) {
                    const key = document.createElement('kbd');
                    key.textContent = kbd;
                    item.appendChild(key);
                }

                results.appendChild(item);
            };

            const commands = [
                { cmd: 'new-tab', label: 'New Tab', icon: '+', kbd: 'Ctrl+T' },
                { cmd: 'new-incognito-tab', label: 'New Incognito Tab', icon: '🕶', kbd: 'Ctrl+Shift+N' },
                { cmd: 'reopen-closed', label: 'Reopen Closed Tab', icon: '↩︎', kbd: 'Ctrl+Shift+T' },
                { cmd: 'open-history', label: 'History', icon: '🕘' },
                { cmd: 'open-bookmarks', label: 'Bookmarks', icon: '🔖' },
                { cmd: 'open-downloads', label: 'Downloads', icon: '⬇️' },
                { cmd: 'open-settings', label: 'Settings', icon: '⚙️' },
                { cmd: 'open-privacy', label: 'Privacy Dashboard', icon: '🛡️' },
                { cmd: 'clear-browsing-data', label: 'Clear Browsing Data', icon: '🧹', kbd: 'Ctrl+Shift+Del' },
                { cmd: 'toggle-bookmarks-bar', label: 'Toggle Bookmarks Bar', icon: '★', kbd: 'Ctrl+Shift+B' },
                { cmd: 'toggle-zen', label: 'Toggle Zen Mode', icon: '🧘' },
                { cmd: 'toggle-reader', label: 'Reader Mode', icon: '📖' },
                { cmd: 'screenshot', label: 'Screenshot', icon: '📸', kbd: 'Ctrl+Shift+S' }
            ];

            const cmdMatches = commands.filter(c => !q || c.label.toLowerCase().includes(q));
            if (cmdMatches.length > 0) {
                appendGroup('COMMANDS');
                cmdMatches.forEach(appendItem);
            }

            const tabs = (this.TM?.tabs || []).map(t => {
                let url = '';
                try { url = t.webviewEl?.getURL?.() || ''; } catch (_) { }
                const title = t.tabEl?.querySelector?.('.tab-title')?.textContent || 'Tab';
                return { id: t.id, title, url };
            });
            const tabMatches = tabs.filter(t => !q || t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
            if (tabMatches.length > 0) {
                appendGroup('TABS');
                tabMatches.slice(0, 12).forEach(t => appendItem({ cmd: 'switch-tab', label: t.title, icon: '🌐', tabId: t.id }));
            }

            const items = [...results.querySelectorAll('.palette-item')];
            this.paletteSelectedIndex = 0;
            items.forEach((el, i) => el.classList.toggle('active', i === 0));

            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.style.padding = '14px 12px';
                empty.style.opacity = '0.65';
                empty.textContent = 'No results';
                results.appendChild(empty);
            }
        };

        const highlight = (index) => {
            const items = [...results.querySelectorAll('.palette-item')];
            if (items.length === 0) return;
            const i = Math.max(0, Math.min(index, items.length - 1));
            this.paletteSelectedIndex = i;
            items.forEach((el, idx) => el.classList.toggle('active', idx === i));
            items[i]?.scrollIntoView?.({ block: 'nearest' });
        };

        const runActive = () => {
            const items = [...results.querySelectorAll('.palette-item')];
            const el = items[this.paletteSelectedIndex] || items[0];
            if (!el) return;
            const cmd = el.getAttribute('data-cmd');
            const tabId = el.getAttribute('data-tab-id');
            runCmd(cmd, { tabId });
            this.togglePalette();
        };

        results.addEventListener('click', (e) => {
            const el = e.target.closest('.palette-item');
            if (!el) return;
            const cmd = el.getAttribute('data-cmd');
            const tabId = el.getAttribute('data-tab-id');
            runCmd(cmd, { tabId });
            this.togglePalette();
        });

        paletteInput.addEventListener('input', () => build(paletteInput.value));
        paletteInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); highlight(this.paletteSelectedIndex + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(this.paletteSelectedIndex - 1); }
            else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.togglePalette(); }
        });

        // Keep a reference so togglePalette() can rebuild live tab results.
        this._buildPalette = build;
        build('');
    }

    togglePalette() {
        const { palette, paletteInput } = this.elements;
        palette.classList.toggle('hidden');
        if (!palette.classList.contains('hidden')) {
            paletteInput.value = '';
            this._buildPalette?.('');
            paletteInput.focus();
        }
    }

    setupFindBar() {
        const { findInput } = this.elements;

        document.getElementById('find-next').onclick = () => this.doFind(true);
        document.getElementById('find-prev').onclick = () => this.doFind(false);
        document.getElementById('find-close').onclick = () => this.closeFindBar();

        findInput.addEventListener('input', () => {
            const query = findInput.value;
            const active = this.TM.getActive();
            if (!active || !query) { this.elements.findCount.textContent = '0/0'; return; }
            try { active.webviewEl.findInPage(query); } catch (e) { }
        });

        findInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.doFind(!e.shiftKey); }
            if (e.key === 'Escape') this.closeFindBar();
        });
    }

    openFindBar() {
        this.elements.findBar.classList.remove('hidden');
        this.elements.findInput.value = '';
        this.elements.findInput.focus();
        this.findActive = true;
        this.elements.findCount.textContent = '0/0';
    }

    closeFindBar() {
        this.elements.findBar.classList.add('hidden');
        this.findActive = false;
        const active = this.TM.getActive();
        if (active) try { active.webviewEl.stopFindInPage('clearSelection'); } catch (e) { }
    }

    doFind(forward = true) {
        const query = this.elements.findInput.value;
        if (!query) return;
        const active = this.TM.getActive();
        if (!active) return;
        try {
            active.webviewEl.findInPage(query, { forward, findNext: true });
        } catch (e) { }
    }

    updateGlobalClock() {
        const el = document.getElementById('global-time');
        if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    async takeScreenshot() {
        this.showNotification('📸 Capturing screenshot...');
        if (window.electronAPI) {
            const result = await window.electronAPI.takeScreenshot();
            if (result?.success) this.showNotification(`📸 Saved: ${result.filename}`, 4000);
            else this.showNotification('Screenshot failed');
        }
    }

    setupSettings() {
        const { engineSelect, themeSelect, adblockToggle } = this.elements;

        if (engineSelect) {
            engineSelect.onchange = (e) => {
                this.currentSearchEngine = e.target.value;
                localStorage.setItem('searchEngine', this.currentSearchEngine);
                if (window.electronAPI) window.electronAPI.storeSet('searchEngine', this.currentSearchEngine);
                db.setKV('searchEngine', this.currentSearchEngine).catch(() => { });
                this.showNotification(`🔍 Search engine: ${e.target.options[e.target.selectedIndex].text}`);
                this.updateUI();
            };
        }

        if (themeSelect) {
            themeSelect.onchange = (e) => {
                const mode = e.target.value;
                this.applyTheme(mode);
                localStorage.setItem('theme', this.theme);
                if (window.electronAPI) window.electronAPI.storeSet('theme', this.theme);
                db.setKV('theme', this.theme).catch(() => { });
                this.showNotification(`🎨 Theme: ${this.theme}`);
            };

            // Prefer persisted app config on first run if localStorage has no preference yet.
            if (window.electronAPI && localStorage.getItem('theme') === null) {
                window.electronAPI.storeGet('theme')
                    .then((stored) => {
                        if (stored && typeof stored === 'string') {
                            this.applyTheme(stored);
                            themeSelect.value = this.theme;
                        }
                    })
                    .catch(() => { });
            }
        }

        if (adblockToggle && window.electronAPI) {
            window.electronAPI.getAdblockStats().then(stats => { adblockToggle.checked = stats.enabled; });
            adblockToggle.onchange = async () => {
                await window.electronAPI.toggleAdblock(adblockToggle.checked);
                this.showNotification(adblockToggle.checked ? '🛡️ Ad blocker enabled' : '⚠️ Ad blocker disabled');
            };
        }

        const clearCacheBtn = document.getElementById('clear-cache-btn');
        if (clearCacheBtn) {
            clearCacheBtn.onclick = async () => {
                if (!window.electronAPI) return this.showNotification('Cache clearing unavailable');
                const ok = await window.electronAPI.clearCache({ cache: true });
                this.showNotification(ok ? '🧹 Cache cleared' : 'Cache clear failed');
            };
        }

        const openClearDataBtn = document.getElementById('open-clear-data-btn');
        if (openClearDataBtn) openClearDataBtn.onclick = () => this.openClearDataModal();
        document.getElementById('close-clear-data')?.addEventListener('click', () => this.closeClearDataModal());
        document.getElementById('clear-data-cancel')?.addEventListener('click', () => this.closeClearDataModal());
        document.getElementById('clear-data-confirm')?.addEventListener('click', () => this.confirmClearDataFromModal());

        document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').classList.add('hidden');
        document.getElementById('close-privacy').onclick = () => document.getElementById('privacy-modal').classList.add('hidden');
        document.getElementById('close-about').onclick = () => document.getElementById('about-modal').classList.add('hidden');
        document.getElementById('close-sysinfo').onclick = () => document.getElementById('sysinfo-modal').classList.add('hidden');
        document.getElementById('close-security-dashboard').onclick = () => document.getElementById('security-dashboard-modal').classList.add('hidden');
        document.getElementById('close-device-info').onclick = () => document.getElementById('device-info-modal').classList.add('hidden');
    }
}
