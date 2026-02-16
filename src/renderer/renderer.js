// ==========================================
// KITS Browser — Production Renderer v4.0
// Security + Chromium Features + Dynamic UI
// ==========================================

const tabsContainer = document.getElementById('tabs-container');
const webviewContainer = document.getElementById('webview-container');
const newTabBtn = document.getElementById('new-tab-btn');
const omnibox = document.getElementById('omnibox');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const refreshBtn = document.getElementById('refresh-btn');
const homeBtn = document.getElementById('home-btn');
const secureIcon = document.getElementById('secure-icon');
const suggestionsList = document.getElementById('suggestions-list');
const aiPanel = document.getElementById('ai-panel');
const aiInput = document.getElementById('ai-input');
const chatContainer = document.getElementById('chat-container');
const palette = document.getElementById('command-palette');
const paletteInput = document.getElementById('palette-input');
const pageProgress = document.getElementById('page-progress');
const tabCountEl = document.getElementById('tab-count');
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const zoomIndicator = document.getElementById('zoom-indicator');
const zoomLevelEl = document.getElementById('zoom-level');
const tabCtxMenu = document.getElementById('tab-context-menu');

// ==========================================
//  Profile Manager
// ==========================================
class ProfileManager {
    constructor() { this.profile = null; }

    async init() {
        this.profile = await window.electronAPI.accountGetProfile();
        this.renderProfile();
    }

    isLoggedIn() { return this.profile !== null; }

    async login(email, password) {
        const result = await window.electronAPI.accountLogin({ email, password });
        if (result.ok) { this.profile = result.profile; this.renderProfile(); }
        return result;
    }

    async signup(name, email, password) {
        const result = await window.electronAPI.accountSignup({ name, email, password });
        if (result.ok) { this.profile = result.profile; this.renderProfile(); }
        return result;
    }

    async logout() {
        await window.electronAPI.accountLogout();
        this.profile = null;
        this.renderProfile();
    }

    renderProfile() {
        const section = document.getElementById('profile-section');
        const userBtn = document.getElementById('user-btn');
        if (!section) return;
        if (this.isLoggedIn()) {
            section.innerHTML = `
                <div style="display:flex; align-items:center; gap:16px; padding:12px 0;">
                    <div style="width:48px; height:48px; border-radius:50%; background:linear-gradient(135deg,#A8C7FA,#7da7f0); display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:600; color:#003355;">${this.profile.avatar}</div>
                    <div style="flex:1;">
                        <div style="font-weight:600; font-size:15px;">${this.profile.name}</div>
                        <div style="opacity:0.6; font-size:12px;">${this.profile.email}</div>
                    </div>
                    <button id="logout-btn" class="kits-btn secondary" style="padding:6px 14px; border-radius:8px; cursor:pointer; font-size:12px;">Sign Out</button>
                </div>`;
            document.getElementById('logout-btn').onclick = async () => { await this.logout(); showNotification('Signed out'); };
            if (userBtn) userBtn.style.color = '#A8C7FA';
        } else {
            section.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px; padding:8px 0;">
                    <div style="width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; opacity:0.5;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <div style="flex:1; opacity:0.7; font-size:13px;">Not signed in</div>
                    <button id="profile-login-btn" class="kits-btn" style="background:#A8C7FA; color:#003355; padding:6px 14px; border-radius:8px; border:none; cursor:pointer; font-size:12px; font-weight:600;">Sign In</button>
                </div>`;
            document.getElementById('profile-login-btn').onclick = () => {
                document.getElementById('settings-modal').classList.add('hidden');
                document.getElementById('login-modal').classList.remove('hidden');
            };
            if (userBtn) userBtn.style.color = '';
        }
    }
}
const PM = new ProfileManager();

// ==========================================
//  Tab Manager (with zoom, pin, mute, context menu)
// ==========================================
class TabManager {
    constructor() {
        this.tabs = [];
        this.activeTabId = null;
        this.zoomLevels = {};
        this.contextTabId = null;
    }

    createTab(url = 'ntp.html', options = { active: true }) {
        const id = crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substr(2, 9);
        const webview = document.createElement('webview');
        webview.src = url;
        webview.setAttribute('allowpopups', '');
        webview.setAttribute('webpreferences', 'contextIsolation=true, sandbox=true');
        webview.id = `webview-${id}`;
        webview.className = 'browser-webview';

        const tabEl = document.createElement('div');
        tabEl.className = 'tab loading';
        tabEl.id = `tab-${id}`;
        tabEl.innerHTML = `
            <div class="tab-spinner"></div>
            <img class="tab-icon" src="" style="display:none" />
            <span class="tab-title">Loading...</span>
            <span class="tab-audio-indicator" style="display:none">🔊</span>
            <span class="tab-close-btn">&times;</span>`;

        webviewContainer.appendChild(webview);
        tabsContainer.appendChild(tabEl);

        const tabData = { id, tabEl, webviewEl: webview, pinned: false, muted: false };
        this.tabs.push(tabData);
        this.zoomLevels[id] = 1.0;

        this._attachEvents(tabData);
        if (options.active) this.switchTab(id);
        this._updateTabCount();
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
            tabCtxMenu.style.left = `${e.clientX}px`;
            tabCtxMenu.style.top = `${e.clientY}px`;
            // Update pin label
            const pinItem = tabCtxMenu.querySelector('[data-action="pin-tab"]');
            if (pinItem) pinItem.textContent = tab.pinned ? '📌 Unpin Tab' : '📌 Pin Tab';
            const muteItem = tabCtxMenu.querySelector('[data-action="mute-tab"]');
            if (muteItem) muteItem.textContent = tab.muted ? '🔊 Unmute Tab' : '🔇 Mute Tab';
            tabCtxMenu.classList.remove('hidden');
        });

        // Progress bar
        tab.webviewEl.addEventListener('did-start-loading', () => {
            tab.tabEl.classList.add('loading');
            if (this.activeTabId === tab.id) { refreshBtn.classList.add('loading'); this._showProgress(); }
        });

        tab.webviewEl.addEventListener('did-stop-loading', () => {
            tab.tabEl.classList.remove('loading');
            if (this.activeTabId === tab.id) { refreshBtn.classList.remove('loading'); this._hideProgress(); this.updateUI(); }
            try {
                const title = tab.webviewEl.getTitle();
                const url = tab.webviewEl.getURL();
                tab.tabEl.querySelector('.tab-title').textContent = title || 'New Tab';
                if (url.startsWith('http')) {
                    try {
                        const hostname = new URL(url).hostname;
                        const iconEl = tab.tabEl.querySelector('.tab-icon');
                        iconEl.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
                        iconEl.style.display = 'block';
                        iconEl.onerror = () => { iconEl.style.display = 'none'; };
                    } catch (_) { }
                    this._logHistory(title, url);
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
            if (e.errorCode === -3 || e.errorCode === 0) return;
            try { if (tab.webviewEl.getURL()?.includes('error.html')) return; } catch (_) { }
            tab.webviewEl.src = `error.html?desc=${encodeURIComponent(e.errorDescription || 'Unknown error')}&code=${e.errorCode}`;
        });

        tab.webviewEl.addEventListener('did-navigate', () => { if (this.activeTabId === tab.id) this.updateUI(); });
        tab.webviewEl.addEventListener('did-navigate-in-page', () => { if (this.activeTabId === tab.id) this.updateUI(); });

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

    _showProgress() { pageProgress.classList.add('active'); }
    _hideProgress() { pageProgress.classList.add('done'); setTimeout(() => pageProgress.classList.remove('active', 'done'), 400); }

    _logHistory(title, url) {
        try {
            let history = JSON.parse(localStorage.getItem('browsing-history') || '[]');
            if (history.length > 0 && history[history.length - 1].url === url) return;
            history.push({ title, url, time: Date.now() });
            if (history.length > 2000) history = history.slice(-1500);
            localStorage.setItem('browsing-history', JSON.stringify(history));
        } catch (e) { }
    }

    _updateTabCount() { if (tabCountEl) tabCountEl.textContent = this.tabs.length; }

    async _saveSession() {
        try {
            const tabs = this.tabs.map(t => {
                try { return t.webviewEl.getURL(); } catch (_) { return null; }
            }).filter(Boolean);
            await window.electronAPI.saveSession(tabs);
        } catch (e) { }
    }

    switchTab(id) {
        this.activeTabId = id;
        this.tabs.forEach(t => {
            const isActive = t.id === id;
            t.tabEl.classList.toggle('active', isActive);
            t.webviewEl.classList.toggle('active', isActive);
            if (isActive) t.tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        this.updateUI();
    }

    closeTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        if (tab.pinned) { showNotification('Unpin tab before closing'); return; }
        const index = this.tabs.indexOf(tab);
        tab.tabEl.remove();
        tab.webviewEl.remove();
        this.tabs.splice(index, 1);
        delete this.zoomLevels[id];
        if (this.activeTabId === id) {
            if (this.tabs.length > 0) this.switchTab(this.tabs[Math.min(index, this.tabs.length - 1)].id);
            else this.createTab();
        }
        this._updateTabCount();
        this._saveSession();
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
        showNotification(tab.pinned ? '📌 Tab pinned' : '📌 Tab unpinned');
        // Move pinned tabs to the left
        if (tab.pinned) tabsContainer.insertBefore(tab.tabEl, tabsContainer.firstChild);
    }

    muteTab(id) {
        const tab = this.tabs.find(t => t.id === id);
        if (!tab) return;
        tab.muted = !tab.muted;
        try { tab.webviewEl.setAudioMuted(tab.muted); } catch (e) { }
        const audioEl = tab.tabEl.querySelector('.tab-audio-indicator');
        if (audioEl) audioEl.textContent = tab.muted ? '🔇' : '🔊';
        showNotification(tab.muted ? '🔇 Tab muted' : '🔊 Tab unmuted');
    }

    closeOtherTabs(id) {
        const toClose = this.tabs.filter(t => t.id !== id && !t.pinned).map(t => t.id);
        toClose.forEach(tid => this.closeTab(tid));
    }

    closeTabsToRight(id) {
        const idx = this.tabs.findIndex(t => t.id === id);
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
        showZoomIndicator(next);
    }

    zoomOut() {
        const tab = this.getActive();
        if (!tab) return;
        const current = this.zoomLevels[tab.id] || 1.0;
        const next = Math.max(current - 0.1, 0.3);
        this.zoomLevels[tab.id] = next;
        tab.webviewEl.setZoomFactor(next);
        showZoomIndicator(next);
    }

    zoomReset() {
        const tab = this.getActive();
        if (!tab) return;
        this.zoomLevels[tab.id] = 1.0;
        tab.webviewEl.setZoomFactor(1.0);
        showZoomIndicator(1.0);
    }

    getActive() { return this.tabs.find(t => t.id === this.activeTabId) || null; }

    updateUI() {
        const active = this.getActive();
        if (!active) return;
        try {
            const webview = active.webviewEl;
            const url = webview.getURL();
            const isInternal = !url.startsWith('http');

            if (document.activeElement !== omnibox) {
                omnibox.value = isInternal ? '' : url;
                omnibox.placeholder = isInternal
                    ? `Search ${currentSearchEngine.charAt(0).toUpperCase() + currentSearchEngine.slice(1)} or type a URL...`
                    : url;
            }

            backBtn.disabled = !webview.canGoBack();
            forwardBtn.disabled = !webview.canGoForward();

            const sessionInfo = document.getElementById('session-info');
            if (url.startsWith('https://')) {
                secureIcon.style.display = 'block';
                secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#81C995" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
                sessionInfo.textContent = new URL(url).hostname;
                sessionInfo.style.color = '#81C995';
            } else if (url.startsWith('http://')) {
                secureIcon.style.display = 'block';
                secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FEBC2E" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
                sessionInfo.textContent = '⚠ Not Secure';
                sessionInfo.style.color = '#FEBC2E';
            } else {
                secureIcon.style.display = 'none';
                sessionInfo.textContent = PM.isLoggedIn() ? `Signed in as ${PM.profile.name}` : 'KITS Browser';
                sessionInfo.style.color = '#E3E3E3';
            }

            document.getElementById('status-text').textContent = webview.isLoading() ? 'Loading...' : 'Ready';
        } catch (e) { }
    }
}

const TM = new TabManager();

// ==========================================
//  Search Engine
// ==========================================
let currentSearchEngine = localStorage.getItem('searchEngine') || 'google';
const searchEngines = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    brave: 'https://search.brave.com/search?q='
};
const engineSelect = document.getElementById('engine-select');
if (engineSelect) engineSelect.value = currentSearchEngine;

function navigateOmnibox() {
    let input = omnibox.value.trim();
    if (!input) return;
    const active = TM.getActive();
    if (!active) return;
    if (input === 'kits://history') { active.webviewEl.src = 'history.html'; omnibox.blur(); return; }
    if (input === 'kits://bookmarks') { active.webviewEl.src = 'bookmarks.html'; omnibox.blur(); return; }
    if (input === 'kits://newtab') { active.webviewEl.src = 'ntp.html'; omnibox.blur(); return; }
    if (input === 'kits://settings') { document.getElementById('settings-modal').classList.remove('hidden'); omnibox.blur(); return; }
    if (!input.startsWith('http://') && !input.startsWith('https://')) {
        if (input.includes('.') && !input.includes(' ')) input = 'https://' + input;
        else input = searchEngines[currentSearchEngine] + encodeURIComponent(input);
    }
    active.webviewEl.loadURL(input);
    omnibox.blur();
    suggestionsList.classList.add('hidden');
}

// ==========================================
//  Autocomplete
// ==========================================
let suggestionDebounce;
let selectedSuggestionIndex = -1;

omnibox.addEventListener('input', () => {
    clearTimeout(suggestionDebounce);
    selectedSuggestionIndex = -1;
    const query = omnibox.value.trim();
    if (query.length < 2) { suggestionsList.classList.add('hidden'); return; }
    suggestionDebounce = setTimeout(async () => {
        try {
            const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`);
            const data = await res.json();
            renderSuggestions(data[1]);
        } catch (e) { suggestionsList.classList.add('hidden'); }
    }, 200);
});

function renderSuggestions(list) {
    if (!list || list.length === 0) { suggestionsList.classList.add('hidden'); return; }
    suggestionsList.innerHTML = '';
    list.slice(0, 6).forEach((s) => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4; flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${s}</span>`;
        div.onclick = () => { omnibox.value = s; navigateOmnibox(); };
        suggestionsList.appendChild(div);
    });
    suggestionsList.classList.remove('hidden');
}

omnibox.addEventListener('keydown', (e) => {
    const items = suggestionsList.querySelectorAll('.suggestion-item');
    if (items.length === 0 || suggestionsList.classList.contains('hidden')) {
        if (e.key === 'Enter') { e.preventDefault(); navigateOmnibox(); }
        return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('selected', i === selectedSuggestionIndex)); omnibox.value = items[selectedSuggestionIndex].querySelector('span').textContent; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0); items.forEach((el, i) => el.classList.toggle('selected', i === selectedSuggestionIndex)); omnibox.value = items[selectedSuggestionIndex].querySelector('span').textContent; }
    else if (e.key === 'Enter') { e.preventDefault(); navigateOmnibox(); }
    else if (e.key === 'Escape') { suggestionsList.classList.add('hidden'); selectedSuggestionIndex = -1; }
});

omnibox.addEventListener('blur', () => setTimeout(() => { suggestionsList.classList.add('hidden'); selectedSuggestionIndex = -1; }, 200));
omnibox.addEventListener('focus', () => omnibox.select());

// ==========================================
//  Notifications & Toasts
// ==========================================
let notificationTimeout;
function showNotification(msg, duration = 3000) {
    const el = document.getElementById('notification');
    const msgEl = document.getElementById('notification-msg');
    if (!el || !msgEl) return;
    clearTimeout(notificationTimeout);
    msgEl.textContent = msg;
    el.classList.remove('hidden');
    notificationTimeout = setTimeout(() => el.classList.add('hidden'), duration);
}

function showDownloadToast(filename, progress, status, isDangerous) {
    const toast = document.getElementById('download-toast');
    if (!toast) return;
    document.getElementById('download-filename').textContent = (isDangerous ? '⚠️ ' : '') + filename;
    document.getElementById('download-progress-fill').style.width = `${Math.round(progress || 0)}%`;
    document.getElementById('download-status-text').textContent =
        status === 'completed' ? '✅ Download complete' :
            status === 'interrupted' ? '❌ Download interrupted' :
                `Downloading... ${Math.round(progress || 0)}%`;
    toast.classList.remove('hidden');
    if (status === 'completed' || status === 'interrupted' || status === 'cancelled') {
        setTimeout(() => toast.classList.add('hidden'), 4000);
    }
}

let zoomTimeout;
function showZoomIndicator(level) {
    zoomLevelEl.textContent = `${Math.round(level * 100)}%`;
    zoomIndicator.classList.remove('hidden');
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => zoomIndicator.classList.add('hidden'), 1500);
}

// ==========================================
//  Find in Page
// ==========================================
let findActive = false;

function openFindBar() {
    findBar.classList.remove('hidden');
    findInput.value = '';
    findInput.focus();
    findActive = true;
    findCount.textContent = '0/0';
}

function closeFindBar() {
    findBar.classList.add('hidden');
    findActive = false;
    const active = TM.getActive();
    if (active) try { active.webviewEl.stopFindInPage('clearSelection'); } catch (e) { }
}

function doFind(forward = true) {
    const query = findInput.value;
    if (!query) return;
    const active = TM.getActive();
    if (!active) return;
    try {
        active.webviewEl.findInPage(query, { forward, findNext: true });
    } catch (e) { }
}

findInput.addEventListener('input', () => {
    const query = findInput.value;
    const active = TM.getActive();
    if (!active || !query) { findCount.textContent = '0/0'; return; }
    try { active.webviewEl.findInPage(query); } catch (e) { }
});

findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
    if (e.key === 'Escape') closeFindBar();
});

document.getElementById('find-next').onclick = () => doFind(true);
document.getElementById('find-prev').onclick = () => doFind(false);
document.getElementById('find-close').onclick = closeFindBar;

// Listen for find results
document.addEventListener('found-in-page', (e) => {
    if (e.detail) findCount.textContent = `${e.detail.activeMatchOrdinal}/${e.detail.matches}`;
});

// ==========================================
//  Tab Context Menu Actions
// ==========================================
document.querySelectorAll('#tab-context-menu .ctx-item').forEach(item => {
    item.addEventListener('click', () => {
        const action = item.getAttribute('data-action');
        const tid = TM.contextTabId;
        tabCtxMenu.classList.add('hidden');
        if (!tid) return;
        switch (action) {
            case 'reload-tab': { const t = TM.tabs.find(t => t.id === tid); if (t) t.webviewEl.reload(); break; }
            case 'duplicate-tab': TM.duplicateTab(tid); break;
            case 'pin-tab': TM.pinTab(tid); break;
            case 'mute-tab': TM.muteTab(tid); break;
            case 'close-other': TM.closeOtherTabs(tid); break;
            case 'close-right': TM.closeTabsToRight(tid); break;
            case 'close-tab': TM.closeTab(tid); break;
        }
    });
});

// Close context menu on click outside
document.addEventListener('click', (e) => {
    if (!tabCtxMenu.contains(e.target)) tabCtxMenu.classList.add('hidden');
});

// ==========================================
//  Security Warning Handler
// ==========================================
window.electronAPI.onSecurityWarning((data) => {
    const banner = document.getElementById('security-banner');
    const msgEl = document.getElementById('security-banner-msg');
    if (!banner || !msgEl) return;
    if (data.type === 'certificate') {
        msgEl.textContent = `⚠️ SSL Certificate error for ${data.url}: ${data.error}`;
    } else if (data.type === 'dangerous-download') {
        msgEl.textContent = `⚠️ Potentially dangerous file: ${data.filename} (${data.extension})`;
    } else if (data.type === 'safe-browsing') {
        msgEl.textContent = `🛡️ Google Safe Browsing: ${data.reason} — ${data.url}`;
    }
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 8000);
});

document.getElementById('security-banner-close').onclick = () => {
    document.getElementById('security-banner').classList.add('hidden');
};

// ==========================================
//  Download Status Handler
// ==========================================
window.electronAPI.onDownloadStatus((data) => {
    showDownloadToast(data.filename, data.progress, data.status, data.isDangerous);
});

// ==========================================
//  Menu Actions from Main Process
// ==========================================
window.electronAPI.onMenuAction((action) => {
    switch (action) {
        case 'new-tab': TM.createTab(); break;
        case 'find': openFindBar(); break;
        case 'zoom-in': TM.zoomIn(); break;
        case 'zoom-out': TM.zoomOut(); break;
        case 'zoom-reset': TM.zoomReset(); break;
        case 'print': { const a = TM.getActive(); if (a) try { a.webviewEl.print(); } catch (e) { } break; }
        case 'about': openAboutModal(); break;
        case 'system-info': openSystemInfo(); break;
        case 'system-security': openSystemSecurityDashboard(); break;
        case 'device-info': openDeviceInfoModal(); break;
    }
});

// ==========================================
//  Sidebar Navigation
// ==========================================
document.querySelectorAll('.side-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.side-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const title = item.getAttribute('title');
        switch (title) {
            case 'History': TM.createTab('history.html'); break;
            case 'Bookmarks': TM.createTab('bookmarks.html'); break;
            case 'Settings': document.getElementById('settings-modal').classList.remove('hidden'); break;
            case 'Privacy Dashboard': openPrivacyDashboard(); break;
            case 'Search': TM.createTab('ntp.html'); break;
            case 'Downloads': showNotification('📁 Downloads saved to Downloads folder'); break;
            default: if (title?.includes('Command')) togglePalette(); break;
        }
    });
});

// ==========================================
//  Command Palette
// ==========================================
function togglePalette() {
    palette.classList.toggle('hidden');
    if (!palette.classList.contains('hidden')) { paletteInput.value = ''; paletteInput.focus(); }
}

document.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('click', () => {
        const cmd = item.getAttribute('data-cmd');
        if (cmd === 'new-tab') TM.createTab();
        else if (cmd === 'toggle-ai') toggleAIPanel();
        else if (cmd === 'toggle-zen') toggleZenMode();
        else if (cmd === 'toggle-reader') toggleReaderMode();
        togglePalette();
    });
});

paletteInput.addEventListener('input', () => {
    const query = paletteInput.value.toLowerCase();
    document.querySelectorAll('.palette-item').forEach(item => {
        const text = item.querySelector('span')?.textContent.toLowerCase() || '';
        item.style.display = text.includes(query) ? '' : 'none';
    });
});
paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const visible = [...document.querySelectorAll('.palette-item')].filter(i => i.style.display !== 'none'); if (visible.length > 0) visible[0].click(); }
});

// ==========================================
//  Keyboard Shortcuts
// ==========================================
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') { e.preventDefault(); togglePalette(); }
    if (e.ctrlKey && e.key === 't') { e.preventDefault(); TM.createTab(); }
    if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (TM.activeTabId) TM.closeTab(TM.activeTabId); }
    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); omnibox.focus(); omnibox.select(); }
    if (e.ctrlKey && e.key === 'j') { e.preventDefault(); toggleAIPanel(); }
    if (e.ctrlKey && e.key === 'd') { e.preventDefault(); bookmarkCurrentPage(); }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); openFindBar(); }
    if (e.ctrlKey && e.key === 'p') { e.preventDefault(); const a = TM.getActive(); if (a) try { a.webviewEl.print(); } catch (e) { } }
    if (e.ctrlKey && e.key === '=') { e.preventDefault(); TM.zoomIn(); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); TM.zoomOut(); }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); TM.zoomReset(); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); takeScreenshot(); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); const a = TM.getActive(); if (a) try { a.webviewEl.openDevTools(); } catch (e) { } }
    if (e.key === 'F5') { e.preventDefault(); const a = TM.getActive(); if (a) a.webviewEl.reload(); }
    if (e.key === 'F11') { e.preventDefault(); window.electronAPI.toggleFullscreen(); }
    if (e.key === 'F12') { e.preventDefault(); const a = TM.getActive(); if (a) try { a.webviewEl.openDevTools(); } catch (e) { } }
    if (e.key === 'Escape') {
        if (findActive) closeFindBar();
        else if (!palette.classList.contains('hidden')) togglePalette();
        else if (!document.getElementById('login-modal').classList.contains('hidden')) document.getElementById('login-modal').classList.add('hidden');
        else if (!document.getElementById('settings-modal').classList.contains('hidden')) document.getElementById('settings-modal').classList.add('hidden');
        else if (!document.getElementById('privacy-modal').classList.contains('hidden')) document.getElementById('privacy-modal').classList.add('hidden');
        else if (!document.getElementById('about-modal').classList.contains('hidden')) document.getElementById('about-modal').classList.add('hidden');
        else if (!document.getElementById('sysinfo-modal').classList.contains('hidden')) document.getElementById('sysinfo-modal').classList.add('hidden');
        else if (!document.getElementById('security-dashboard-modal').classList.contains('hidden')) document.getElementById('security-dashboard-modal').classList.add('hidden');
        else if (!document.getElementById('device-info-modal').classList.contains('hidden')) document.getElementById('device-info-modal').classList.add('hidden');
        else if (document.body.classList.contains('zen-mode')) toggleZenMode();
    }
    // Ctrl+Tab / Ctrl+Shift+Tab - switch tabs
    if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = TM.tabs.findIndex(t => t.id === TM.activeTabId);
        if (e.shiftKey) TM.switchTab(TM.tabs[(idx - 1 + TM.tabs.length) % TM.tabs.length].id);
        else TM.switchTab(TM.tabs[(idx + 1) % TM.tabs.length].id);
    }
});

// ==========================================
//  AI Chat
// ==========================================
async function sendAi() {
    const prompt = aiInput.value.trim();
    if (!prompt) return;
    appendChat('user', prompt);
    aiInput.value = '';
    if (prompt.toLowerCase().includes('summarize')) {
        appendChat('ai', 'Scanning page content... 🔍');
        const active = TM.getActive();
        if (active) {
            try {
                const data = await active.webviewEl.executeJavaScript(`(function(){
                    const a=document.querySelector('article'),m=document.querySelector('main'),c=a?.innerText||m?.innerText||document.body.innerText;
                    return{t:document.title,c:c.substring(0,4000),l:c.length};
                })()`);
                appendChat('ai', `📄 "${data.t}"\n📊 ~${data.c.split(/\s+/).length} words\n\n${data.c.substring(0, 600)}...`);
            } catch (e) { appendChat('ai', "Couldn't read page — it may be restricted."); }
        } else { appendChat('ai', 'No active tab.'); }
    } else {
        try { const res = await window.electronAPI.aiChat(prompt); appendChat('ai', res); }
        catch (e) { appendChat('ai', 'Error communicating with AI.'); }
    }
}

function appendChat(role, msg) {
    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    div.textContent = msg;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function toggleAIPanel() {
    aiPanel.classList.toggle('hidden');
    if (!aiPanel.classList.contains('hidden')) aiInput.focus();
}

// ==========================================
//  Toolbar Features
// ==========================================
function toggleZenMode() {
    document.body.classList.toggle('zen-mode');
    showNotification(document.body.classList.contains('zen-mode') ? '🧘 Zen Mode — Escape to exit' : 'Zen Mode off');
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? null : 'light';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('kits-theme', next || 'dark');
    window.electronAPI.storeSet('theme', next || 'dark');
    showNotification(`🎨 Theme: ${next === 'light' ? 'Light' : 'Dark'}`);
}

function toggleReaderMode() {
    const active = TM.getActive();
    if (!active) return;
    try {
        active.webviewEl.insertCSS(`
            body { max-width:800px !important; margin:0 auto !important; padding:40px !important; font-family:'Georgia',serif !important; line-height:1.8 !important; font-size:18px !important; background:#fdf6e3 !important; color:#586e75 !important; }
            img { max-width:100% !important; height:auto !important; }
            nav,header,footer,aside,.ads,.sidebar,[role="banner"],[role="navigation"],[role="complementary"],#comments,.comments { display:none !important; }
        `);
        showNotification('📖 Reader Mode activated');
    } catch (e) { showNotification('Reader Mode unavailable'); }
}

function bookmarkCurrentPage() {
    const active = TM.getActive();
    if (!active) return;
    try {
        const url = active.webviewEl.getURL();
        const title = active.webviewEl.getTitle();
        if (!url.startsWith('http')) { showNotification('Cannot bookmark this page'); return; }
        let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
        const idx = bookmarks.findIndex(b => b.url === url);
        if (idx >= 0) {
            bookmarks.splice(idx, 1);
            localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
            showNotification(`⭐ Removed: ${title}`);
        } else {
            bookmarks.push({ title, url, time: Date.now() });
            localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
            showNotification(`⭐ Bookmarked: ${title}`);
        }
        renderBookmarksBar();
    } catch (e) { showNotification('Failed to bookmark'); }
}

async function takeScreenshot() {
    showNotification('📸 Capturing screenshot...');
    const result = await window.electronAPI.takeScreenshot();
    if (result?.success) showNotification(`📸 Saved: ${result.filename}`, 4000);
    else showNotification('Screenshot failed');
}

// ==========================================
//  Bookmarks Bar
// ==========================================
function renderBookmarksBar() {
    const bar = document.getElementById('bookmarks-bar');
    if (!bar) return;
    const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
    if (bookmarks.length === 0) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    bookmarks.slice(0, 12).forEach(bm => {
        let domain = '';
        try { domain = new URL(bm.url).hostname; } catch (_) { }
        const btn = document.createElement('button');
        btn.className = 'bookmarks-bar-item';
        btn.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" onerror="this.style.display='none'"><span>${bm.title.substring(0, 20)}</span>`;
        btn.onclick = () => { const a = TM.getActive(); if (a) a.webviewEl.loadURL(bm.url); else TM.createTab(bm.url); };
        bar.appendChild(btn);
    });
}

// ==========================================
//  Privacy Dashboard
// ==========================================
async function openPrivacyDashboard() {
    document.getElementById('privacy-modal').classList.remove('hidden');
    try {
        const stats = await window.electronAPI.getAdblockStats();
        document.getElementById('ads-blocked-count').textContent = stats.total.toLocaleString();
        document.getElementById('trackers-blocked-count').textContent = stats.session.toLocaleString();
    } catch (e) { }
}

// ==========================================
//  About & System Info Modals
// ==========================================
async function openAboutModal() {
    const info = await window.electronAPI.getSystemInfo();
    document.getElementById('about-info').innerHTML = `
        <div>Chromium: <strong>${info.chrome}</strong></div>
        <div>Electron: <strong>${info.electron}</strong></div>
        <div>Node.js: <strong>${info.node}</strong></div>
        <div>Platform: <strong>${info.platform}</strong></div>
        <div>Architecture: <strong>${info.arch}</strong></div>
        <div>Ads Blocked: <strong>${info.adsBlocked.toLocaleString()}</strong></div>
        <div>HTTPS Upgrade: <strong>${info.httpsUpgrade ? 'On' : 'Off'}</strong></div>
    `;
    document.getElementById('about-modal').classList.remove('hidden');
}

async function openSystemInfo() {
    const info = await window.electronAPI.getSystemInfo();
    document.getElementById('sysinfo-content').innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 24px;">
            <div>CPU</div><div><strong>${info.cpuModel}</strong></div>
            <div>Cores</div><div><strong>${info.cpus}</strong></div>
            <div>Memory</div><div><strong>${info.memory}</strong></div>
            <div>System Uptime</div><div><strong>${info.uptime}</strong></div>
            <div>Platform</div><div><strong>${info.platform}</strong></div>
            <div>Architecture</div><div><strong>${info.arch}</strong></div>
            <div>Chromium</div><div><strong>${info.chrome}</strong></div>
            <div>Electron</div><div><strong>${info.electron}</strong></div>
            <div>Node.js</div><div><strong>${info.node}</strong></div>
            <div>Session ID</div><div><strong style="font-size:10px; opacity:0.6;">${info.sessionId}</strong></div>
            <div>Config Path</div><div><strong style="font-size:10px; opacity:0.6; word-break:break-all;">${info.configPath}</strong></div>
            <div>Log Path</div><div><strong style="font-size:10px; opacity:0.6; word-break:break-all;">${info.logPath}</strong></div>
        </div>
    `;
    document.getElementById('sysinfo-modal').classList.remove('hidden');
}

// ==========================================
//  Theme Restore
// ==========================================
if (localStorage.getItem('kits-theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');

// ==========================================
//  Login Modal Wiring
// ==========================================
document.getElementById('user-btn').onclick = () => {
    if (PM.isLoggedIn()) document.getElementById('settings-modal').classList.remove('hidden');
    else document.getElementById('login-modal').classList.remove('hidden');
};
document.getElementById('close-login').onclick = () => document.getElementById('login-modal').classList.add('hidden');

document.getElementById('login-submit-btn').onclick = async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!email || !pass) { errEl.textContent = 'Email and password required.'; errEl.style.display = 'block'; return; }
    const result = await PM.login(email, pass);
    if (result.ok) { document.getElementById('login-modal').classList.add('hidden'); showNotification(`Welcome back, ${PM.profile.name}! 👋`); }
    else { errEl.textContent = result.msg; errEl.style.display = 'block'; }
};

document.getElementById('login-signup-btn').onclick = async () => {
    const name = document.getElementById('login-name').value.trim();
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const result = await PM.signup(name, email, pass);
    if (result.ok) { document.getElementById('login-modal').classList.add('hidden'); showNotification(`🎉 Welcome to KITS, ${PM.profile.name}!`); }
    else { errEl.textContent = result.msg; errEl.style.display = 'block'; }
};

// Google Search shortcut — opens Google in a new tab for easy access
document.getElementById('google-search-btn').onclick = () => {
    document.getElementById('login-modal').classList.add('hidden');
    TM.createTab('https://accounts.google.com/signin');
    showNotification('🔍 Sign in with your Google account for search sync');
};

// Input focus highlight
['login-name', 'login-email', 'login-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('focus', () => { el.style.borderColor = '#4285F4'; });
        el.addEventListener('blur', () => { el.style.borderColor = 'rgba(255,255,255,0.15)'; });
        el.addEventListener('input', () => { document.getElementById('login-error').style.display = 'none'; });
    }
});

// ==========================================
//  Event Wiring
// ==========================================
document.getElementById('min-btn').onclick = () => window.electronAPI.minimizeWindow();
document.getElementById('max-btn').onclick = () => window.electronAPI.maximizeWindow();
document.getElementById('close-btn-win').onclick = () => window.electronAPI.closeWindow();

backBtn.onclick = () => { const a = TM.getActive(); if (a) try { if (a.webviewEl.canGoBack()) a.webviewEl.goBack(); } catch (e) { } };
forwardBtn.onclick = () => { const a = TM.getActive(); if (a) try { if (a.webviewEl.canGoForward()) a.webviewEl.goForward(); } catch (e) { } };
refreshBtn.onclick = () => { const a = TM.getActive(); if (a) a.webviewEl.reload(); };
homeBtn.onclick = () => { const a = TM.getActive(); if (a) a.webviewEl.src = 'ntp.html'; };
newTabBtn.onclick = () => TM.createTab();

document.getElementById('ai-toggle-btn').onclick = toggleAIPanel;
document.getElementById('theme-btn').onclick = toggleTheme;
document.getElementById('zen-btn').onclick = toggleZenMode;
document.getElementById('reader-btn').onclick = toggleReaderMode;
document.getElementById('bookmark-btn').onclick = bookmarkCurrentPage;

document.getElementById('ai-send-btn').onclick = sendAi;
aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAi(); });
document.getElementById('ai-close-btn').onclick = () => aiPanel.classList.add('hidden');
document.getElementById('ai-summarize-btn').onclick = () => { aiInput.value = 'summarize this page'; sendAi(); };

document.getElementById('menu-btn').onclick = () => document.getElementById('settings-modal').classList.remove('hidden');

window.electronAPI.onNewTab((url) => TM.createTab(url));

// Settings
document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').classList.add('hidden');
document.getElementById('close-privacy').onclick = () => document.getElementById('privacy-modal').classList.add('hidden');
document.getElementById('close-about').onclick = () => document.getElementById('about-modal').classList.add('hidden');
document.getElementById('close-sysinfo').onclick = () => document.getElementById('sysinfo-modal').classList.add('hidden');

engineSelect.onchange = (e) => {
    currentSearchEngine = e.target.value;
    localStorage.setItem('searchEngine', currentSearchEngine);
    window.electronAPI.storeSet('searchEngine', currentSearchEngine);
    showNotification(`🔍 Search engine: ${e.target.options[e.target.selectedIndex].text}`);
    TM.updateUI();
};

document.getElementById('clear-cache-btn').onclick = async () => {
    const success = await window.electronAPI.clearCache();
    showNotification(success ? '🧹 Cache cleared' : 'Failed to clear cache');
};

const adblockToggle = document.getElementById('adblock-toggle');
if (adblockToggle) {
    window.electronAPI.getAdblockStats().then(stats => { adblockToggle.checked = stats.enabled; });
    adblockToggle.onchange = async () => {
        await window.electronAPI.toggleAdblock(adblockToggle.checked);
        showNotification(adblockToggle.checked ? '🛡️ Ad blocker enabled' : '⚠️ Ad blocker disabled');
    };
}

// ==========================================
//  SYSTEM SECURITY DASHBOARD
// ==========================================
function getUsageColor(percent) {
    if (percent >= 90) return '#EA4335';
    if (percent >= 70) return '#FBBC05';
    return '#34A853';
}

function makeUsageBar(percent, label) {
    return `<div style="margin:8px 0;">
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
            <span>${label}</span><span style="opacity:0.7;">${percent}%</span>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${percent}%; background:${getUsageColor(percent)}; border-radius:4px; transition:width 0.6s ease;"></div>
        </div>
    </div>`;
}

function makeCheckItem(label, checked) {
    return `<div style="display:flex; align-items:center; gap:10px; padding:6px 10px; background:rgba(255,255,255,0.03); border-radius:8px; margin-bottom:4px;">
        <span style="color:${checked ? '#34A853' : '#EA4335'}; font-size:16px;">${checked ? '✅' : '❌'}</span>
        <span style="flex:1; font-size:12px;">${label}</span>
        <span style="font-size:11px; padding:2px 8px; border-radius:6px; background:${checked ? 'rgba(52,168,83,0.15)' : 'rgba(234,67,53,0.15)'}; color:${checked ? '#34A853' : '#EA4335'};">${checked ? 'Active' : 'Off'}</span>
    </div>`;
}

function makeInfoRow(label, value) {
    return `<div style="display:flex; justify-content:space-between; padding:6px 10px; border-bottom:1px solid rgba(255,255,255,0.04); font-size:12px;">
        <span style="opacity:0.6;">${label}</span><span style="font-weight:500;">${value}</span>
    </div>`;
}

async function openSystemSecurityDashboard() {
    document.getElementById('security-dashboard-modal').classList.remove('hidden');
    const data = await window.electronAPI.getSystemSecurity();

    // Score badge
    document.getElementById('security-grade-badge').textContent = data.securityGrade;
    document.getElementById('security-score-text').textContent = `${data.securityScore}/${data.maxSecurityScore}`;
    document.getElementById('security-score-fill').style.width = `${(data.securityScore / data.maxSecurityScore) * 100}%`;

    const gradeColors = { 'A+': '#34A853', 'A': '#4CAF50', 'B': '#FBBC05', 'C': '#EA4335' };
    const color = gradeColors[data.securityGrade] || '#4CAF50';
    document.getElementById('security-grade-badge').style.background = `linear-gradient(135deg, ${color}, ${color}dd)`;
    document.getElementById('security-grade-badge').style.boxShadow = `0 4px 20px ${color}55`;

    // Security tab
    const secChecks = data.securityChecks;
    document.getElementById('sec-panel-security').innerHTML = `
        <h3 style="font-size:14px; margin-bottom:12px; opacity:0.8;">Security Protections</h3>
        ${makeCheckItem('HTTPS Auto-Upgrade', secChecks.httpsUpgrade)}
        ${makeCheckItem('Ad & Tracker Blocker', secChecks.adBlocker)}
        ${makeCheckItem('Do Not Track (DNT)', secChecks.doNotTrack)}
        ${makeCheckItem('Fingerprint Protection (GPC)', secChecks.fingerprintProtection)}
        ${makeCheckItem('Block Third-Party Cookies', secChecks.thirdPartyCookiesBlocked)}
        ${makeCheckItem('Sandbox Mode', secChecks.sandboxEnabled)}
        ${makeCheckItem('Context Isolation', secChecks.contextIsolation)}
        ${makeCheckItem('Encrypted Config Storage', secChecks.secureEncryption)}
        ${makeCheckItem('Safe Browsing (URL Scanner)', secChecks.safeBrowsing)}
        ${makeCheckItem('PBKDF2 Password Hashing', secChecks.pbkdf2Auth)}
    `;

    // Hardware tab
    document.getElementById('sec-panel-hardware').innerHTML = `
        <h3 style="font-size:14px; margin-bottom:12px; opacity:0.8;">System Hardware</h3>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; margin-bottom:12px;">
            ${makeInfoRow('🖥️ Platform', `${data.platformName} ${data.platformVersion}`)}
            ${makeInfoRow('🏗️ Architecture', data.arch)}
            ${makeInfoRow('👤 User', `${data.username}@${data.hostname}`)}
            ${makeInfoRow('🐚 Shell', data.shell)}
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; margin-bottom:12px;">
            ${makeInfoRow('⚙️ CPU', data.cpuModel)}
            ${makeInfoRow('🧮 Cores', `${data.cpuCores} cores @ ${data.cpuSpeed}`)}
            ${makeInfoRow('🎮 GPU', data.gpuInfo)}
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px;">
            <h4 style="font-size:12px; margin-bottom:8px; opacity:0.7;">Memory Usage</h4>
            ${makeUsageBar(data.memUsagePercent, `${data.usedMemory} / ${data.totalMemory}`)}
            <div style="font-size:11px; opacity:0.5; margin-top:4px;">Free: ${data.freeMemory}</div>
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; margin-top:12px;">
            ${makeInfoRow('🖥️ Display', `${data.primaryResolution} @ ${data.scaleFactor}x`)}
            ${makeInfoRow('🎨 Color Depth', `${data.colorDepth}-bit`)}
            ${makeInfoRow('📺 Displays', data.displayCount)}
            ${makeInfoRow('🖱️ Touch', data.touchSupport)}
            ${makeInfoRow('🔄 Refresh Rate', data.refreshRate + ' Hz')}
        </div>
    `;

    // Network tab
    const netSection = data.networkInterfaces.map(iface =>
        `<div style="background:rgba(255,255,255,0.03); border-radius:10px; padding:10px; margin-bottom:8px;">
            <div style="font-weight:600; font-size:13px; margin-bottom:4px;">${iface.name}</div>
            ${makeInfoRow('IP Address', iface.address)}
            ${makeInfoRow('MAC', iface.mac)}
            ${makeInfoRow('Subnet', iface.netmask)}
        </div>`
    ).join('');
    document.getElementById('sec-panel-network').innerHTML = `
        <h3 style="font-size:14px; margin-bottom:12px; opacity:0.8;">Network Interfaces</h3>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding:10px; background:${data.isOnline ? 'rgba(52,168,83,0.1)' : 'rgba(234,67,53,0.1)'}; border-radius:10px; border:1px solid ${data.isOnline ? 'rgba(52,168,83,0.2)' : 'rgba(234,67,53,0.2)'};">
            <span style="font-size:18px;">${data.isOnline ? '🟢' : '🔴'}</span>
            <span style="font-size:13px; font-weight:500;">${data.isOnline ? 'Connected to Internet' : 'Offline'}</span>
        </div>
        ${netSection || '<div style="opacity:0.5; font-size:13px;">No active network interfaces</div>'}
    `;

    // Storage tab
    document.getElementById('sec-panel-storage').innerHTML = `
        <h3 style="font-size:14px; margin-bottom:12px; opacity:0.8;">Disk Storage</h3>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; margin-bottom:12px;">
            ${makeUsageBar(data.diskUsedPercent, `Disk Usage`)}
            ${makeInfoRow('Total', data.diskTotal)}
            ${makeInfoRow('Free', data.diskFree)}
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px;">
            <h4 style="font-size:12px; margin-bottom:8px; opacity:0.7;">Paths</h4>
            ${makeInfoRow('Home', data.homeDir)}
            ${makeInfoRow('Temp', data.tempDir)}
            ${makeInfoRow('Config', data.configPath)}
        </div>
    `;

    // Browser tab
    document.getElementById('sec-panel-browser').innerHTML = `
        <h3 style="font-size:14px; margin-bottom:12px; opacity:0.8;">Browser Engine</h3>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; margin-bottom:12px;">
            ${makeInfoRow('KITS Browser', data.browserVersion)}
            ${makeInfoRow('Chromium', data.chromeVersion)}
            ${makeInfoRow('Electron', data.electronVersion)}
            ${makeInfoRow('Node.js', data.nodeVersion)}
            ${makeInfoRow('V8 Engine', data.v8Version)}
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:12px;">
            ${makeInfoRow('System Uptime', data.uptime)}
            ${makeInfoRow('Browser Uptime', data.processUptime)}
            ${makeInfoRow('Process ID', data.pid)}
        </div>
    `;
}

// Dashboard tab switching
document.querySelectorAll('.sec-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.sec-tab').forEach(t => {
            t.classList.remove('active');
            t.style.background = 'rgba(255,255,255,0.04)';
        });
        tab.classList.add('active');
        tab.style.background = 'rgba(168,199,250,0.15)';
        document.querySelectorAll('.sec-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById(`sec-panel-${tab.getAttribute('data-sec-tab')}`);
        if (panel) panel.style.display = 'block';
    });
});

document.getElementById('close-security-dashboard').onclick = () =>
    document.getElementById('security-dashboard-modal').classList.add('hidden');

// ==========================================
//  DEVICE COMPATIBILITY
// ==========================================
async function openDeviceInfoModal() {
    document.getElementById('device-info-modal').classList.remove('hidden');
    const info = await window.electronAPI.getDeviceInfo();

    const displaysHtml = info.displays.map((d, i) => `
        <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:14px; margin-bottom:10px; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-weight:600; font-size:14px; margin-bottom:8px;">
                ${i === 0 ? '🖥️' : '📺'} ${d.label || `Display ${i + 1}`}
                ${i === 0 ? '<span style="font-size:10px; padding:2px 8px; background:rgba(66,133,244,0.15); color:#4285F4; border-radius:6px; margin-left:8px;">Primary</span>' : ''}
                ${d.internal ? '<span style="font-size:10px; padding:2px 8px; background:rgba(52,168,83,0.15); color:#34A853; border-radius:6px; margin-left:4px;">Internal</span>' : ''}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px; font-size:12px;">
                ${makeInfoRow('Resolution', d.resolution)}
                ${makeInfoRow('Work Area', d.workArea)}
                ${makeInfoRow('Scale Factor', `${d.scaleFactor}x (${Math.round(d.scaleFactor * 96)} DPI)`)}
                ${makeInfoRow('Color Depth', `${d.colorDepth}-bit`)}
                ${makeInfoRow('Refresh Rate', d.refreshRate + ' Hz')}
                ${makeInfoRow('Rotation', d.rotation + '°')}
                ${makeInfoRow('Touch Support', d.touchSupport)}
            </div>
        </div>
    `).join('');

    document.getElementById('device-info-content').innerHTML = `
        <!-- Platform Info -->
        <div style="background:rgba(66,133,244,0.08); border-radius:12px; padding:14px; margin-bottom:14px; border:1px solid rgba(66,133,244,0.15);">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                <span style="font-size:28px;">${info.platformName === 'Windows' ? '🪟' : info.platformName === 'macOS' ? '🍎' : '🐧'}</span>
                <div>
                    <div style="font-weight:600; font-size:16px;">${info.platformName}</div>
                    <div style="font-size:11px; opacity:0.6;">${info.arch} ${info.is64bit ? '(64-bit)' : '(32-bit)'} ${info.isARM ? '— ARM' : ''}</div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px; font-size:12px;">
                ${makeInfoRow('Locale', info.locale)}
                ${makeInfoRow('System Locale', info.systemLocale)}
                ${makeInfoRow('Hi-DPI', info.primary.isHiDPI ? '✅ Yes' : '❌ No')}
                ${makeInfoRow('Primary DPI', `${info.primary.dpi} DPI`)}
            </div>
        </div>

        <!-- Displays -->
        <h3 style="font-size:14px; margin-bottom:10px; opacity:0.8;">Connected Displays (${info.displays.length})</h3>
        ${displaysHtml}

        <!-- Compatibility Summary -->
        <div style="background:rgba(52,168,83,0.08); border-radius:12px; padding:14px; margin-top:14px; border:1px solid rgba(52,168,83,0.15);">
            <div style="font-weight:600; font-size:13px; margin-bottom:8px;">✅ Compatibility Status</div>
            <div style="font-size:12px; line-height:2; opacity:0.8;">
                • ${info.platformName} ${info.is64bit ? '64-bit' : '32-bit'} — <strong style="color:#34A853;">Fully Supported</strong><br>
                • ${info.displays.length > 1 ? 'Multi-monitor' : 'Single monitor'} — <strong style="color:#34A853;">Supported</strong><br>
                • ${info.primary.isHiDPI ? 'Hi-DPI scaling' : 'Standard DPI'} — <strong style="color:#34A853;">Optimized</strong><br>
                • Hardware acceleration — <strong style="color:#34A853;">Enabled</strong><br>
                • Chromium sandbox — <strong style="color:#34A853;">Active</strong>
            </div>
        </div>
    `;
}

document.getElementById('close-device-info').onclick = () =>
    document.getElementById('device-info-modal').classList.add('hidden');

// ==========================================
//  NETWORK CONNECTIVITY MONITOR
// ==========================================
let lastOnlineState = navigator.onLine;

function showNetworkToast(online) {
    const toast = document.getElementById('network-status-toast');
    const icon = document.getElementById('network-status-icon');
    const msg = document.getElementById('network-status-msg');
    if (!toast) return;
    icon.textContent = online ? '🟢' : '🔴';
    msg.textContent = online ? 'Back online' : 'You are offline';
    toast.classList.remove('hidden');
    toast.style.display = 'flex';
    setTimeout(() => { toast.classList.add('hidden'); toast.style.display = 'none'; }, 4000);
}

window.addEventListener('online', () => {
    if (!lastOnlineState) { showNetworkToast(true); showNotification('🌐 Connection restored'); }
    lastOnlineState = true;
});

window.addEventListener('offline', () => {
    showNetworkToast(false);
    showNotification('📡 Network disconnected');
    lastOnlineState = false;
});

// ==========================================
//  POWER EVENTS (Battery/AC/Sleep/Resume)
// ==========================================
window.electronAPI.onPowerEvent((data) => {
    showNotification(data.message, 3000);
    // Auto-save session on suspend
    if (data.type === 'suspend') TM._saveSession();
});

// ==========================================
//  Global Clock
// ==========================================
function updateGlobalClock() {
    const el = document.getElementById('global-time');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateGlobalClock, 1000);
updateGlobalClock();

// ==========================================
//  Initialize
// ==========================================
async function init() {
    await PM.init();
    renderBookmarksBar();
    TM.createTab();

    // Restore search engine
    try {
        const savedEngine = await window.electronAPI.storeGet('searchEngine');
        if (savedEngine && searchEngines[savedEngine]) {
            currentSearchEngine = savedEngine;
            localStorage.setItem('searchEngine', savedEngine);
            if (engineSelect) engineSelect.value = savedEngine;
        }
    } catch (e) { }

    // Restore session tabs
    try {
        const session = await window.electronAPI.loadSession();
        if (session?.tabs?.length > 1) {
            // Don't restore internal pages; first tab already created
            session.tabs.slice(1).filter(url => url.startsWith('http')).forEach(url => {
                TM.createTab(url, { active: false });
            });
        }
    } catch (e) { }
}

init();
