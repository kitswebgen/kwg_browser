
export class TabManager {
    constructor(tabsContainer, webviewContainer, callbacks = {}) {
        this.tabsContainer = tabsContainer;
        this.webviewContainer = webviewContainer;
        this.tabs = [];
        this.activeTabId = null;
        this.zoomLevels = {};
        this.contextTabId = null;
        this.closedTabs = [];
        this.draggingTabId = null;
        this.callbacks = callbacks; // onUpdateUI, onSaveSession, onError, etc.
        this._saveSessionDebounce = null;
    }

    createTab(url = 'ntp.html', options = { active: true }) {
        const id = crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substr(2, 9);
        const webview = document.createElement('webview');

        // Ensure URL is valid (simple check)
        if (!url) url = 'ntp.html';

        webview.src = url;
        webview.setAttribute('allowpopups', '');
        webview.setAttribute('webpreferences', 'contextIsolation=true, sandbox=true');
        webview.id = `webview-${id}`;
        webview.className = 'browser-webview';

        const tabEl = document.createElement('div');
        tabEl.className = 'tab loading';
        tabEl.id = `tab-${id}`;
        tabEl.draggable = true;
        tabEl.innerHTML = `
            <div class="tab-spinner"></div>
            <img class="tab-icon" src="" style="display:none" />
            <span class="tab-title">Loading...</span>
            <span class="tab-audio-indicator" style="display:none">🔊</span>
            <span class="tab-close-btn">&times;</span>`;

        this.webviewContainer.appendChild(webview);
        this.tabsContainer.appendChild(tabEl);

        const tabData = { id, tabEl, webviewEl: webview, pinned: false, muted: false };
        this.tabs.push(tabData);
        this.zoomLevels[id] = 1.0;

        this._attachEvents(tabData);
        if (options.active) this.switchTab(id);

        if (this.callbacks.onTabCountUpdate) this.callbacks.onTabCountUpdate(this.tabs.length);
        this._saveSession();
        return tabData;
    }

    _attachEvents(tab) {
        tab.tabEl.onclick = (e) => {
            if (e.target.classList.contains('tab-close-btn')) return;
            this.switchTab(tab.id);
        };
        tab.tabEl.querySelector('.tab-close-btn').onclick = (e) => { e.stopPropagation(); this.closeTab(tab.id); };

        // Right-click context menu
        tab.tabEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.contextTabId = tab.id;
            if (this.callbacks.onContextMenu) this.callbacks.onContextMenu(e, tab);
        });

        // Drag-to-reorder tabs (unpinned only)
        tab.tabEl.addEventListener('dragstart', (e) => {
            if (tab.pinned) { e.preventDefault(); return; }
            this.draggingTabId = tab.id;
            tab.tabEl.classList.add('dragging');
            try {
                e.dataTransfer.setData('text/plain', tab.id);
                e.dataTransfer.effectAllowed = 'move';
            } catch (_) { }
        });
        tab.tabEl.addEventListener('dragend', () => {
            this.draggingTabId = null;
            tab.tabEl.classList.remove('dragging');
        });
        tab.tabEl.addEventListener('dragover', (e) => {
            if (!this.draggingTabId || this.draggingTabId === tab.id) return;
            const dragging = this.tabs.find(t => t.id === this.draggingTabId);
            if (!dragging || dragging.pinned || tab.pinned) return;
            e.preventDefault();
            const rect = tab.tabEl.getBoundingClientRect();
            const before = e.clientX < rect.left + rect.width / 2;
            const ref = before ? tab.tabEl : tab.tabEl.nextSibling;
            if (ref === dragging.tabEl) return;
            this.tabsContainer.insertBefore(dragging.tabEl, ref);
            this._syncTabOrderFromDom();
        });

        // Crash Recovery
        tab.webviewEl.addEventListener('crashed', () => {
            this.activeTabId === tab.id && this.callbacks.onNotification && this.callbacks.onNotification('⚠️ Tab crashed! Reloading...');
            tab.webviewEl.reload();
        });

        tab.webviewEl.addEventListener('unresponsive', () => {
            this.activeTabId === tab.id && this.callbacks.onNotification && this.callbacks.onNotification('⚠️ Tab unresponsive');
        });

        // Webview events
        tab.webviewEl.addEventListener('did-start-loading', () => {
            tab.tabEl.classList.add('loading');
            if (this.activeTabId === tab.id && this.callbacks.onLoadingStart) this.callbacks.onLoadingStart();
        });

        tab.webviewEl.addEventListener('did-stop-loading', () => {
            tab.tabEl.classList.remove('loading');
            if (this.activeTabId === tab.id && this.callbacks.onLoadingStop) {
                this.callbacks.onLoadingStop();
                this.callbacks.onUpdateUI();
            }
            try {
                const title = tab.webviewEl.getTitle();
                const url = tab.webviewEl.getURL();
                tab.tabEl.querySelector('.tab-title').textContent = title || 'New Tab';

                if (url.startsWith('http')) {
                    try {
                        const hostname = new URL(url).hostname;
                        const iconEl = tab.tabEl.querySelector('.tab-icon');
                        const hasIcon = !!(iconEl?.getAttribute('src') && iconEl.style.display !== 'none');
                        if (!hasIcon) {
                            iconEl.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
                            iconEl.style.display = 'block';
                            iconEl.onerror = () => { iconEl.style.display = 'none'; };
                        }
                    } catch (_) { }
                    if (this.callbacks.onLogHistory) this.callbacks.onLogHistory(title, url);
                }
            } catch (e) { }
        });

        tab.webviewEl.addEventListener('page-title-updated', (e) => {
            tab.tabEl.querySelector('.tab-title').textContent = e.title;
        });

        tab.webviewEl.addEventListener('page-favicon-updated', (e) => {
            if (e.favicons?.length > 0) {
                const iconEl = tab.tabEl.querySelector('.tab-icon');
                iconEl.src = e.favicons[0];
                iconEl.style.display = 'block';
                iconEl.onerror = () => { iconEl.style.display = 'none'; };
            }
        });

        tab.webviewEl.addEventListener('new-window', (e) => this.createTab(e.url));

        tab.webviewEl.addEventListener('did-fail-load', (e) => {
            // -3 is aborted (usually by user), 0 is success in some contexts but here likely fail
            if (e.errorCode === -3 || e.errorCode === 0) return;
            try { if (tab.webviewEl.getURL()?.includes('error.html')) return; } catch (_) { }
            // Using absolute path or relative? renderer.js uses relative 'error.html'
            tab.webviewEl.src = `error.html?desc=${encodeURIComponent(e.errorDescription || 'Unknown error')}&code=${e.errorCode}`;
        });

        tab.webviewEl.addEventListener('did-navigate', () => { if (this.activeTabId === tab.id && this.callbacks.onUpdateUI) this.callbacks.onUpdateUI(); });
        tab.webviewEl.addEventListener('did-navigate-in-page', () => { if (this.activeTabId === tab.id && this.callbacks.onUpdateUI) this.callbacks.onUpdateUI(); });

        // Audio detection
        tab.webviewEl.addEventListener('media-started-playing', () => {
            const audioEl = tab.tabEl.querySelector('.tab-audio-indicator');
            if (audioEl) audioEl.style.display = 'flex';
        });
        tab.webviewEl.addEventListener('media-paused', () => {
            const audioEl = tab.tabEl.querySelector('.tab-audio-indicator');
            if (audioEl) audioEl.style.display = 'none';
        });
    }

    _saveSession(options = {}) {
        if (!this.callbacks.onSaveSession) return;

        const immediate = options === true || options?.immediate === true;
        const run = () => {
            try {
                const tabs = this.tabs.map(t => {
                    try { return t.webviewEl.getURL(); } catch (_) { return null; }
                }).filter(Boolean);
                this.callbacks.onSaveSession(tabs);
            } catch (_) { }
        };

        if (immediate) {
            if (this._saveSessionDebounce) clearTimeout(this._saveSessionDebounce);
            this._saveSessionDebounce = null;
            run();
            return;
        }

        if (this._saveSessionDebounce) clearTimeout(this._saveSessionDebounce);
        this._saveSessionDebounce = setTimeout(run, 350);
    }

    switchTab(id) {
        this.activeTabId = id;
        this.tabs.forEach(t => {
            const isActive = t.id === id;
            t.tabEl.classList.toggle('active', isActive);
            t.webviewEl.classList.toggle('active', isActive);
            if (isActive) {
                try { t.tabEl.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch (_) { }
            }
        });
        if (this.callbacks.onUpdateUI) this.callbacks.onUpdateUI();
    }

    closeTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        if (tab.pinned) {
            if (this.callbacks.onNotification) this.callbacks.onNotification('Unpin tab before closing');
            return;
        }

        // Track recently closed tabs for quick restore.
        try {
            const url = tab.webviewEl.getURL();
            const title = tab.webviewEl.getTitle();
            if (url) {
                this.closedTabs.push({ url, title: title || url, time: Date.now() });
                if (this.closedTabs.length > 30) this.closedTabs.splice(0, this.closedTabs.length - 30);
            }
        } catch (_) { }

        const index = this.tabs.indexOf(tab);
        tab.tabEl.remove();
        tab.webviewEl.remove();
        this.tabs.splice(index, 1);
        delete this.zoomLevels[id];

        if (this.activeTabId === id) {
            if (this.tabs.length > 0) this.switchTab(this.tabs[Math.min(index, this.tabs.length - 1)].id);
            else this.createTab();
        } else if (this.tabs.length === 0) {
            this.createTab();
        }

        if (this.callbacks.onTabCountUpdate) this.callbacks.onTabCountUpdate(this.tabs.length);
        this._saveSession();
    }

    reopenClosedTab() {
        const last = this.closedTabs.pop();
        if (!last?.url) return false;
        this.createTab(last.url, { active: true });
        return true;
    }

    switchToNextTab() {
        if (this.tabs.length < 2) return;
        const idx = this.tabs.findIndex(t => t.id === this.activeTabId);
        const next = this.tabs[(idx + 1) % this.tabs.length];
        if (next) this.switchTab(next.id);
    }

    switchToPrevTab() {
        if (this.tabs.length < 2) return;
        const idx = this.tabs.findIndex(t => t.id === this.activeTabId);
        const prev = this.tabs[(idx - 1 + this.tabs.length) % this.tabs.length];
        if (prev) this.switchTab(prev.id);
    }

    duplicateTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        try { this.createTab(tab.webviewEl.getURL()); } catch (_) { this.createTab(); }
    }

    pinTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        tab.pinned = !tab.pinned;
        tab.tabEl.classList.toggle('pinned', tab.pinned);
        tab.tabEl.draggable = !tab.pinned;
        if (this.callbacks.onNotification) this.callbacks.onNotification(tab.pinned ? '📌 Tab pinned' : '📌 Tab unpinned');

        // Move pinned tabs to the left
        if (tab.pinned && this.tabsContainer.firstChild) {
            this.tabsContainer.insertBefore(tab.tabEl, this.tabsContainer.firstChild);
            this._syncTabOrderFromDom();
        }
    }

    muteTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        tab.muted = !tab.muted;
        try { tab.webviewEl.setAudioMuted(tab.muted); } catch (e) { }
        const audioEl = tab.tabEl.querySelector('.tab-audio-indicator');
        if (audioEl) audioEl.textContent = tab.muted ? '🔇' : '🔊';
        if (this.callbacks.onNotification) this.callbacks.onNotification(tab.muted ? '🔇 Tab muted' : '🔊 Tab unmuted');
    }

    closeOtherTabs(id) {
        const toClose = this.tabs.filter(t => t.id !== id && !t.pinned).map(t => t.id);
        toClose.forEach(tid => this.closeTab(tid));
    }

    closeTabsToRight(id) {
        const idx = this.tabs.findIndex(t => t.id === id);
        if (idx === -1) return;
        const toClose = this.tabs.slice(idx + 1).filter(t => !t.pinned).map(t => t.id);
        toClose.forEach(tid => this.closeTab(tid));
    }

    // Zoom
    zoomIn() {
        const tab = this.getActive();
        if (!tab) return;
        const current = this.zoomLevels[tab.id] || 1.0;
        const next = Math.min(current + 0.1, 3.0);
        this.zoomLevels[tab.id] = next;
        tab.webviewEl.setZoomFactor(next);
        if (this.callbacks.onZoomUpdate) this.callbacks.onZoomUpdate(next);
    }

    zoomOut() {
        const tab = this.getActive();
        if (!tab) return;
        const current = this.zoomLevels[tab.id] || 1.0;
        const next = Math.max(current - 0.1, 0.3);
        this.zoomLevels[tab.id] = next;
        tab.webviewEl.setZoomFactor(next);
        if (this.callbacks.onZoomUpdate) this.callbacks.onZoomUpdate(next);
    }

    zoomReset() {
        const tab = this.getActive();
        if (!tab) return;
        this.zoomLevels[tab.id] = 1.0;
        tab.webviewEl.setZoomFactor(1.0);
        if (this.callbacks.onZoomUpdate) this.callbacks.onZoomUpdate(1.0);
    }

    getActive() { return this.tabs.find(t => t.id === this.activeTabId) || null; }

    // For external navigation control
    goBack() { const a = this.getActive(); if (a) try { if (a.webviewEl.canGoBack()) a.webviewEl.goBack(); } catch (e) { } }
    goForward() { const a = this.getActive(); if (a) try { if (a.webviewEl.canGoForward()) a.webviewEl.goForward(); } catch (e) { } }
    reload() { const a = this.getActive(); if (a) a.webviewEl.reload(); }
    loadURL(url) {
        const active = this.getActive();
        if (active) active.webviewEl.loadURL(url);
    }

    _syncTabOrderFromDom() {
        const order = [...this.tabsContainer.children]
            .map(el => (el?.id || '').replace(/^tab-/, ''))
            .filter(Boolean);
        const indexById = new Map(order.map((id, i) => [id, i]));
        this.tabs.sort((a, b) => (indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER));
        this._saveSession();
    }
}
