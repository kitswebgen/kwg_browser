
export class UIManager {
    constructor(tabManager, profileManager) {
        this.TM = tabManager;
        this.PM = profileManager;
        this.notificationTimeout = null;
        this.zoomTimeout = null;
        this.suggestionDebounce = null;
        this.selectedSuggestionIndex = -1;
        this.findActive = false;

        this.elements = {
            omnibox: document.getElementById('omnibox'),
            suggestionsList: document.getElementById('suggestions-list'),
            backBtn: document.getElementById('back-btn'),
            forwardBtn: document.getElementById('forward-btn'),
            refreshBtn: document.getElementById('refresh-btn'),
            homeBtn: document.getElementById('home-btn'),
            secureIcon: document.getElementById('secure-icon'),
            aiPanel: document.getElementById('ai-panel'),
            aiInput: document.getElementById('ai-input'),
            chatContainer: document.getElementById('chat-container'),
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
            adblockToggle: document.getElementById('adblock-toggle')
        };

        this.searchEngines = {
            google: 'https://www.google.com/search?q=',
            bing: 'https://www.bing.com/search?q=',
            duckduckgo: 'https://duckduckgo.com/?q=',
            brave: 'https://search.brave.com/search?q='
        };
        this.currentSearchEngine = localStorage.getItem('searchEngine') || 'google';
    }

    init() {
        this.setupEventListeners();
        this.setupOmnibox();
        this.setupCommandPalette();
        this.setupAIChat();
        this.setupFindBar();
        this.setupSettings();

        // Restore search engine selection
        if (this.elements.engineSelect) this.elements.engineSelect.value = this.currentSearchEngine;

        // Global Clock
        setInterval(() => this.updateGlobalClock(), 1000);
        this.updateGlobalClock();
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
        const active = this.TM.getActive();
        if (!active) return;

        try {
            const webview = active.webviewEl;
            const url = webview.getURL();
            const isInternal = !url.startsWith('http');
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
                secureIcon.style.display = 'block';
                secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#81C995" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
                if (sessionInfo) {
                    sessionInfo.textContent = new URL(url).hostname;
                    sessionInfo.style.color = '#81C995';
                }
            } else if (url.startsWith('http://')) {
                secureIcon.style.display = 'block';
                secureIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FEBC2E" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
                if (sessionInfo) {
                    sessionInfo.textContent = '⚠ Not Secure';
                    sessionInfo.style.color = '#FEBC2E';
                }
            } else {
                secureIcon.style.display = 'none';
                if (sessionInfo) {
                    sessionInfo.textContent = this.PM.isLoggedIn() ? `Signed in as ${this.PM.profile.name}` : 'KITS Browser';
                    sessionInfo.style.color = '#E3E3E3';
                }
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
        if (input === 'kits://newtab') { this.TM.createTab('ntp.html'); omnibox.blur(); return; }
        if (input === 'kits://settings') { document.getElementById('settings-modal').classList.remove('hidden'); omnibox.blur(); return; }

        if (!input.startsWith('http://') && !input.startsWith('https://')) {
            if (input.includes('.') && !input.includes(' ')) input = 'https://' + input;
            else input = this.searchEngines[this.currentSearchEngine] + encodeURIComponent(input);
        }
        active.webviewEl.loadURL(input);
        omnibox.blur();
        suggestionsList.classList.add('hidden');
    }

    setupOmnibox() {
        const { omnibox, suggestionsList } = this.elements;

        omnibox.addEventListener('input', () => {
            clearTimeout(this.suggestionDebounce);
            this.selectedSuggestionIndex = -1;
            const query = omnibox.value.trim();
            if (query.length < 2) { suggestionsList.classList.add('hidden'); return; }

            this.suggestionDebounce = setTimeout(async () => {
                try {
                    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`);
                    const data = await res.json();
                    this.renderSuggestions(data[1]);
                } catch (e) { suggestionsList.classList.add('hidden'); }
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
            else if (e.key === 'Escape') { suggestionsList.classList.add('hidden'); this.selectedSuggestionIndex = -1; }
        });

        omnibox.addEventListener('blur', () => setTimeout(() => { suggestionsList.classList.add('hidden'); this.selectedSuggestionIndex = -1; }, 200));
        omnibox.addEventListener('focus', () => omnibox.select());
    }

    renderSuggestions(list) {
        const { suggestionsList, omnibox } = this.elements;
        if (!list || list.length === 0) { suggestionsList.classList.add('hidden'); return; }
        suggestionsList.innerHTML = '';
        list.slice(0, 6).forEach((s) => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4; flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${s}</span>`;
            div.onclick = () => { omnibox.value = s; this.navigateOmnibox(); };
            suggestionsList.appendChild(div);
        });
        suggestionsList.classList.remove('hidden');
    }

    highlightSuggestion(items) {
        items.forEach((el, i) => el.classList.toggle('selected', i === this.selectedSuggestionIndex));
        if (this.selectedSuggestionIndex >= 0) {
            this.elements.omnibox.value = items[this.selectedSuggestionIndex].querySelector('span').textContent;
        }
    }

    setupEventListeners() {
        const { backBtn, forwardBtn, refreshBtn, homeBtn } = this.elements;

        backBtn.onclick = () => this.TM.goBack();
        forwardBtn.onclick = () => this.TM.goForward();
        refreshBtn.onclick = () => this.TM.reload();
        homeBtn.onclick = () => { const a = this.TM.getActive(); if (a) a.webviewEl.src = 'ntp.html'; };

        document.getElementById('new-tab-btn').onclick = () => this.TM.createTab();
        document.getElementById('ai-toggle-btn').onclick = () => this.toggleAIPanel();
        document.getElementById('theme-btn').onclick = () => this.toggleTheme();
        document.getElementById('zen-btn').onclick = () => this.toggleZenMode();
        document.getElementById('reader-btn').onclick = () => this.toggleReaderMode();
        document.getElementById('bookmark-btn').onclick = () => this.bookmarkCurrentPage();
        document.getElementById('menu-btn').onclick = () => document.getElementById('settings-modal').classList.remove('hidden');

        // Window controls
        document.getElementById('min-btn').onclick = () => window.electronAPI.minimizeWindow();
        document.getElementById('max-btn').onclick = () => window.electronAPI.maximizeWindow();
        document.getElementById('close-btn-win').onclick = () => window.electronAPI.closeWindow();

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => this.handleKeyboardShortcuts(e));

        // Sidebar
        document.querySelectorAll('.side-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.side-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const title = item.getAttribute('title');
                this.handleSidebarClick(title);
            });
        });
    }

    handleSidebarClick(title) {
        switch (title) {
            case 'History': this.TM.createTab('history.html'); break;
            case 'Bookmarks': this.TM.createTab('bookmarks.html'); break;
            case 'Settings': document.getElementById('settings-modal').classList.remove('hidden'); break;
            case 'Privacy Dashboard': openPrivacyDashboard(); break; // Global or moved to UI?
            case 'Search': this.TM.createTab('ntp.html'); break;
            case 'Downloads': this.showNotification('📁 Downloads saved to Downloads folder'); break;
            default: if (title?.includes('Command')) this.togglePalette(); break;
        }
    }

    handleKeyboardShortcuts(e) {
        if (e.ctrlKey && e.key === 'k') { e.preventDefault(); this.togglePalette(); }
        if (e.ctrlKey && e.key === 't') { e.preventDefault(); this.TM.createTab(); }
        if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (this.TM.activeTabId) this.TM.closeTab(this.TM.activeTabId); }
        if (e.ctrlKey && e.key === 'l') { e.preventDefault(); this.elements.omnibox.focus(); this.elements.omnibox.select(); }
        if (e.ctrlKey && e.key === 'j') { e.preventDefault(); this.toggleAIPanel(); }
        if (e.ctrlKey && e.key === 'd') { e.preventDefault(); this.bookmarkCurrentPage(); }
        if (e.ctrlKey && e.key === 'f') { e.preventDefault(); this.openFindBar(); }
        if (e.ctrlKey && e.key === 'p') { e.preventDefault(); const a = this.TM.getActive(); if (a) try { a.webviewEl.print(); } catch (e) { } }
        if (e.ctrlKey && e.key === '=') { e.preventDefault(); this.TM.zoomIn(); }
        if (e.ctrlKey && e.key === '-') { e.preventDefault(); this.TM.zoomOut(); }
        if (e.ctrlKey && e.key === '0') { e.preventDefault(); this.TM.zoomReset(); }
        if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); this.takeScreenshot(); }
        if (e.key === 'F5') { e.preventDefault(); this.TM.reload(); }
        if (e.key === 'F11') { e.preventDefault(); window.electronAPI.toggleFullscreen(); }
        if (e.key === 'Escape') {
            if (this.findActive) this.closeFindBar();
            else if (!this.elements.palette.classList.contains('hidden')) this.togglePalette();
            // Close modals...
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            if (document.body.classList.contains('zen-mode')) this.toggleZenMode();
        }
    }

    toggleAIPanel() {
        this.elements.aiPanel.classList.toggle('hidden');
        if (!this.elements.aiPanel.classList.contains('hidden')) this.elements.aiInput.focus();
    }

    toggleZenMode() {
        document.body.classList.toggle('zen-mode');
        this.showNotification(document.body.classList.contains('zen-mode') ? '🧘 Zen Mode — Escape to exit' : 'Zen Mode off');
    }

    toggleReaderMode() {
        const active = this.TM.getActive();
        if (!active) return;
        try {
            active.webviewEl.insertCSS(`
                body { max-width:800px !important; margin:0 auto !important; padding:40px !important; font-family:'Georgia',serif !important; line-height:1.8 !important; font-size:18px !important; background:#fdf6e3 !important; color:#586e75 !important; }
                img { max-width:100% !important; height:auto !important; }
                nav,header,footer,aside,.ads,.sidebar,[role="banner"],[role="navigation"],[role="complementary"],#comments,.comments { display:none !important; }
            `);
            this.showNotification('📖 Reader Mode activated');
        } catch (e) { this.showNotification('Reader Mode unavailable'); }
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? null : 'light';
        if (next) document.documentElement.setAttribute('data-theme', next);
        else document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('kits-theme', next || 'dark');
        if (window.electronAPI) window.electronAPI.storeSet('theme', next || 'dark');
        this.showNotification(`🎨 Theme: ${next === 'light' ? 'Light' : 'Dark'}`);
    }

    async bookmarkCurrentPage() {
        const active = this.TM.getActive();
        if (!active) return;
        try {
            const url = active.webviewEl.getURL();
            const title = active.webviewEl.getTitle();
            if (!url.startsWith('http')) { this.showNotification('Cannot bookmark this page'); return; }

            let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
            const idx = bookmarks.findIndex(b => b.url === url);
            if (idx >= 0) {
                bookmarks.splice(idx, 1);
                localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
                this.showNotification(`⭐ Removed: ${title}`);
            } else {
                bookmarks.push({ title, url, time: Date.now() });
                localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
                this.showNotification(`⭐ Bookmarked: ${title}`);
            }
            this.renderBookmarksBar();
        } catch (e) { this.showNotification('Failed to bookmark'); }
    }

    renderBookmarksBar() {
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
            btn.onclick = () => { const a = this.TM.getActive(); if (a) a.webviewEl.loadURL(bm.url); else this.TM.createTab(bm.url); };
            bar.appendChild(btn);
        });
    }

    setupCommandPalette() {
        const { palette, paletteInput } = this.elements;
        document.querySelectorAll('.palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const cmd = item.getAttribute('data-cmd');
                if (cmd === 'new-tab') this.TM.createTab();
                else if (cmd === 'toggle-ai') this.toggleAIPanel();
                else if (cmd === 'toggle-zen') this.toggleZenMode();
                else if (cmd === 'toggle-reader') this.toggleReaderMode();
                this.togglePalette();
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
    }

    togglePalette() {
        const { palette, paletteInput } = this.elements;
        palette.classList.toggle('hidden');
        if (!palette.classList.contains('hidden')) { paletteInput.value = ''; paletteInput.focus(); }
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

    setupAIChat() {
        const { aiInput } = this.elements;
        document.getElementById('ai-send-btn').onclick = () => this.sendAi();
        aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendAi(); });
        document.getElementById('ai-close-btn').onclick = () => this.elements.aiPanel.classList.add('hidden');
        document.getElementById('ai-summarize-btn').onclick = () => { aiInput.value = 'summarize this page'; this.sendAi(); };
    }

    async sendAi() {
        const { aiInput, chatContainer } = this.elements;
        const prompt = aiInput.value.trim();
        if (!prompt) return;
        this.appendChat('user', prompt);
        aiInput.value = '';

        if (prompt.toLowerCase().includes('summarize')) {
            this.appendChat('ai', 'Scanning page content... 🔍');
            const active = this.TM.getActive();
            if (active) {
                try {
                    const data = await active.webviewEl.executeJavaScript(`(function(){
                        const a=document.querySelector('article'),m=document.querySelector('main'),c=a?.innerText||m?.innerText||document.body.innerText;
                        return{t:document.title,c:c.substring(0,4000),l:c.length};
                    })()`);
                    this.appendChat('ai', `📄 "${data.t}"\n📊 ~${data.c.split(/\s+/).length} words\n\n${data.c.substring(0, 600)}...`);
                } catch (e) { this.appendChat('ai', "Couldn't read page — it may be restricted."); }
            } else { this.appendChat('ai', 'No active tab.'); }
        } else {
            try {
                if (window.electronAPI) {
                    const res = await window.electronAPI.aiChat(prompt);
                    this.appendChat('ai', res);
                } else {
                    this.appendChat('ai', 'AI API unavailable.');
                }
            }
            catch (e) { this.appendChat('ai', 'Error communicating with AI.'); }
        }
    }

    appendChat(role, msg) {
        const { chatContainer } = this.elements;
        const div = document.createElement('div');
        div.className = `chat-message ${role}`;
        div.textContent = msg;
        chatContainer.appendChild(div);
        chatContainer.scrollTop = chatContainer.scrollHeight;
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
        const { engineSelect, adblockToggle } = this.elements;

        if (engineSelect) {
            engineSelect.onchange = (e) => {
                this.currentSearchEngine = e.target.value;
                localStorage.setItem('searchEngine', this.currentSearchEngine);
                if (window.electronAPI) window.electronAPI.storeSet('searchEngine', this.currentSearchEngine);
                this.showNotification(`🔍 Search engine: ${e.target.options[e.target.selectedIndex].text}`);
                this.updateUI();
            };
        }

        if (adblockToggle && window.electronAPI) {
            window.electronAPI.getAdblockStats().then(stats => { adblockToggle.checked = stats.enabled; });
            adblockToggle.onchange = async () => {
                await window.electronAPI.toggleAdblock(adblockToggle.checked);
                this.showNotification(adblockToggle.checked ? '🛡️ Ad blocker enabled' : '⚠️ Ad blocker disabled');
            };
        }

        document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').classList.add('hidden');
        document.getElementById('close-privacy').onclick = () => document.getElementById('privacy-modal').classList.add('hidden');
        document.getElementById('close-about').onclick = () => document.getElementById('about-modal').classList.add('hidden');
        document.getElementById('close-sysinfo').onclick = () => document.getElementById('sysinfo-modal').classList.add('hidden');
    }
}
