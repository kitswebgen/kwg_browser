
import { TabManager } from './managers/TabManager.js';
import { ProfileManager } from './managers/ProfileManager.js';
import { GoogleAppsManager } from './managers/GoogleAppsManager.js';
import { UIManager } from './ui/UIManager.js';
import { AIPanel } from './ui/AIPanel.js';
import { db } from './db.js';
import { openSystemSecurityDashboard } from './ui/SecurityDashboard.js';

// Global instances
const tabsContainer = document.getElementById('tabs-container');
const webviewContainer = document.getElementById('webview-container');

// Platform-specific styling
document.body.classList.add(window.electronAPI.platform === 'darwin' ? 'platform-mac' : 'platform-win');

// Instantiate Managers
const PM = new ProfileManager({
    onProfileUpdate: (profile) => {
        renderProfileSection(profile);
    }
});

const UI = new UIManager(null, PM);

// Define AI first to be available for TM callback
let AI;

const TM = new TabManager(tabsContainer, webviewContainer, {
    onUpdateUI: () => UI.updateUI(),
    onPageContentUpdate: (data) => AI && AI.handlePageContent(data),
    onTabCountUpdate: (count) => {
        const countEl = document.getElementById('tab-count');
        if (countEl) countEl.textContent = count;
    },
    onContextMenu: (e, tab) => {
        const ctxMenu = document.getElementById('tab-context-menu');
        if (!ctxMenu) return;

        ctxMenu.style.left = `${e.clientX}px`;
        ctxMenu.style.top = `${e.clientY}px`;

        const pinItem = ctxMenu.querySelector('[data-action="pin-tab"]');
        if (pinItem) pinItem.textContent = tab.pinned ? '📌 Unpin Tab' : '📌 Pin Tab';
        const muteItem = ctxMenu.querySelector('[data-action="mute-tab"]');
        if (muteItem) muteItem.textContent = tab.muted ? '🔊 Unmute Tab' : '🔇 Mute Tab';

        ctxMenu.classList.remove('hidden');

        // Clamp to viewport after it becomes visible.
        requestAnimationFrame(() => {
            const rect = ctxMenu.getBoundingClientRect();
            let left = e.clientX;
            let top = e.clientY;
            if (rect.right > window.innerWidth) left = Math.max(8, window.innerWidth - rect.width - 8);
            if (rect.bottom > window.innerHeight) top = Math.max(8, window.innerHeight - rect.height - 8);
            ctxMenu.style.left = `${left}px`;
            ctxMenu.style.top = `${top}px`;
        });
    },
    onLoadingStart: () => {
        const pageProgress = document.getElementById('page-progress');
        if (pageProgress) pageProgress.classList.add('active');
        const refBtn = document.getElementById('refresh-btn');
        if (refBtn) refBtn.classList.add('loading');
    },
    onLoadingStop: () => {
        const pageProgress = document.getElementById('page-progress');
        if (pageProgress) {
            pageProgress.classList.add('done');
            setTimeout(() => pageProgress.classList.remove('active', 'done'), 400);
        }
        const refBtn = document.getElementById('refresh-btn');
        if (refBtn) refBtn.classList.remove('loading');
    },
    onSaveSession: async (tabs) => {
        if (window.electronAPI) await window.electronAPI.saveSession(tabs);
    },
    onLogHistory: (title, url) => {
        try {
            const ts = Date.now();
            let history = JSON.parse(localStorage.getItem('browsing-history') || '[]');
            if (history.length > 0 && history[history.length - 1].url === url) return;
            history.push({ title, url, time: ts });
            if (history.length > 2000) history = history.slice(-1500);
            localStorage.setItem('browsing-history', JSON.stringify(history));
            db.addHistory({ title, url, time: ts }).catch(() => { });
        } catch (e) { }
    },
    onNotification: (msg) => UI.showNotification(msg),
    onZoomUpdate: (level) => UI.showZoomIndicator(level),
    onPerformSearch: (query) => {
        if (!query) return;
        UI.elements.omnibox.value = query;
        UI.navigateOmnibox();
    }
});

if (window.electronAPI?.onPerformSearch) {
    window.electronAPI.onPerformSearch((query) => {
        if (!query) return;
        UI.elements.omnibox.value = query;
        UI.navigateOmnibox();
    });
}

AI = new AIPanel(TM);
const GM = new GoogleAppsManager(TM, UI);

// Link UI with TM
UI.TM = TM;

function setupTabContextMenu() {
    const ctxMenu = document.getElementById('tab-context-menu');
    if (!ctxMenu) return;

    const hide = () => ctxMenu.classList.add('hidden');

    ctxMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.ctx-item');
        if (!item) return;
        const action = item.getAttribute('data-action');
        const tabId = TM.contextTabId || TM.activeTabId;
        if (!tabId) return hide();

        switch (action) {
            case 'reload-tab': {
                const tab = TM.tabs.find(t => t.id === tabId);
                try { tab?.webviewEl?.reload(); } catch (_) { }
                break;
            }
            case 'duplicate-tab': TM.duplicateTab(tabId); break;
            case 'pin-tab': TM.pinTab(tabId); break;
            case 'mute-tab': TM.muteTab(tabId); break;
            case 'close-other': TM.closeOtherTabs(tabId); break;
            case 'close-right': TM.closeTabsToRight(tabId); break;
            case 'close-tab': TM.closeTab(tabId); break;
        }
        hide();
    });

    document.addEventListener('click', (e) => {
        if (ctxMenu.classList.contains('hidden')) return;
        if (ctxMenu.contains(e.target)) return;
        hide();
    });

    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
}

function setupLoginModal() {
    const modal = document.getElementById('login-modal');
    if (!modal) return;

    const titleEl = document.getElementById('login-title');
    const subtitleEl = document.getElementById('login-subtitle');
    const nameRow = document.getElementById('login-name-row');
    const nameInput = document.getElementById('login-name');
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const toggleBtn = document.getElementById('login-signup-btn');
    const submitBtn = document.getElementById('login-submit-btn');
    const closeBtn = document.getElementById('close-login');
    const googleBtn = document.getElementById('google-search-btn');

    let mode = 'signin';

    const showError = (msg) => {
        if (!errorEl) return;
        errorEl.textContent = msg || '';
        errorEl.style.display = msg ? 'block' : 'none';
    };

    const setMode = (next) => {
        mode = next;
        const isSignup = mode === 'signup';
        if (nameRow) nameRow.style.display = isSignup ? '' : 'none';
        if (titleEl) titleEl.textContent = isSignup ? 'Create account' : 'Sign in';
        if (subtitleEl) subtitleEl.textContent = isSignup
            ? 'Create a KITS Account to sync bookmarks, history & settings'
            : 'Use your KITS Account to sync bookmarks, history & settings';
        if (submitBtn) submitBtn.textContent = isSignup ? 'Create account' : 'Sign In';
        if (toggleBtn) toggleBtn.textContent = isSignup ? 'Use existing account' : 'Create account';
        showError('');
    };

    const open = (nextMode = 'signin') => {
        setMode(nextMode);
        modal.classList.remove('hidden');
        setTimeout(() => {
            if (mode === 'signup') nameInput?.focus();
            else emailInput?.focus();
        }, 0);
    };

    const close = () => {
        modal.classList.add('hidden');
        showError('');
        if (passInput) passInput.value = '';
    };

    closeBtn?.addEventListener('click', close);
    toggleBtn?.addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    googleBtn?.addEventListener('click', () => {
        close();
        TM.createTab('https://www.google.com', { active: true });
    });

    const submit = async () => {
        showError('');
        if (!window.electronAPI) {
            showError('Sign-in is unavailable in this build.');
            return;
        }

        const name = nameInput?.value?.trim() || '';
        const email = emailInput?.value?.trim() || '';
        const password = passInput?.value || '';

        if (mode === 'signup' && name.length < 2) return showError('Name must be at least 2 characters.');
        if (!email.includes('@')) return showError('Enter a valid email.');
        if (password.length < 4) return showError('Password must be at least 4 characters.');

        try {
            submitBtn.disabled = true;
            const result = mode === 'signup'
                ? await PM.signup(name, email, password)
                : await PM.login(email, password);

            if (!result?.ok) {
                showError(result?.msg || 'Sign-in failed.');
                return;
            }

            close();
            UI.showNotification(mode === 'signup' ? '✅ Account created' : '✅ Signed in');
        } catch (e) {
            showError('Sign-in failed. Please try again.');
        } finally {
            submitBtn.disabled = false;
        }
    };

    submitBtn?.addEventListener('click', submit);
    [nameInput, emailInput, passInput].forEach((el) => {
        el?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
        });
    });

    // Expose for other UI entry points.
    window.openLoginModal = open;
    window.closeLoginModal = close;

    // Default state
    setMode('signin');
}

setupTabContextMenu();
setupLoginModal();

// User button: opens profile/settings or login.
document.getElementById('user-btn')?.addEventListener('click', () => {
    if (PM.isLoggedIn()) document.getElementById('settings-modal')?.classList.remove('hidden');
    else window.openLoginModal?.('signin') || document.getElementById('login-modal')?.classList.remove('hidden');
});

// Helpers
function renderProfileSection(profile) {
    const section = document.getElementById('profile-section');
    const userBtn = document.getElementById('user-btn');
    if (!section) return;

    if (profile) {
        section.innerHTML = `
            <div style="display:flex; align-items:center; gap:16px; padding:12px 0;">
                <div style="width:48px; height:48px; border-radius:50%; background:linear-gradient(135deg,#A8C7FA,#7da7f0); display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:600; color:#003355;">${profile.avatar}</div>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:15px;">${profile.name}</div>
                    <div style="opacity:0.6; font-size:12px;">${profile.email}</div>
                </div>
                <button id="logout-btn" class="kits-btn secondary" style="padding:6px 14px; border-radius:8px; cursor:pointer; font-size:12px;">Sign Out</button>
            </div>`;
        document.getElementById('logout-btn').onclick = async () => { await PM.logout(); UI.showNotification('Signed out'); };
        if (userBtn) userBtn.style.color = '#A8C7FA';
    } else {
        section.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; padding:8px 0;">
                <div style="width:36px; height:36px; border-radius:50%; background:var(--sys-glass-highlight); display:flex; align-items:center; justify-content:center; opacity:0.5;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div style="flex:1; opacity:0.7; font-size:13px;">Not signed in</div>
                <button id="profile-login-btn" class="kits-btn" style="background:var(--md-sys-color-primary); color:var(--md-sys-color-on-primary); padding:6px 14px; border-radius:8px; border:none; cursor:pointer; font-size:12px; font-weight:600;">Sign In</button>
            </div>`;
        const item = document.getElementById('profile-login-btn');
        if (item) {
            item.onclick = () => {
                document.getElementById('settings-modal').classList.add('hidden');
                if (window.openLoginModal) window.openLoginModal('signin');
                else document.getElementById('login-modal').classList.remove('hidden');
            };
        }
        if (userBtn) userBtn.style.color = '';
    }
}

// Global functions for modal access
window.openPrivacyDashboard = async function () {
    const el = document.getElementById('privacy-modal');
    if (el) el.classList.remove('hidden');
    try {
        if (window.electronAPI) {
            const stats = await window.electronAPI.getAdblockStats();
            document.getElementById('ads-blocked-count').textContent = stats.total.toLocaleString();
            document.getElementById('trackers-blocked-count').textContent = stats.session.toLocaleString();
        }
    } catch (e) { }
}

window.openAboutModal = async function () {
    if (!window.electronAPI) return;
    const info = await window.electronAPI.getSystemInfo();
    const el = document.getElementById('about-info');
    if (el) {
        el.innerHTML = `
            <div>Chromium: <strong>${info.chrome}</strong></div>
            <div>Electron: <strong>${info.electron}</strong></div>
            <div>Node.js: <strong>${info.node}</strong></div>
            <div>Platform: <strong>${info.platform}</strong></div>
            <div>Architecture: <strong>${info.arch}</strong></div>
            <div>Ads Blocked: <strong>${info.adsBlocked.toLocaleString()}</strong></div>
            <div>HTTPS Upgrade: <strong>${info.httpsUpgrade ? 'On' : 'Off'}</strong></div>
        `;
    }
    document.getElementById('about-modal').classList.remove('hidden');
}

window.openSystemInfo = async function () {
    if (!window.electronAPI) return;
    const info = await window.electronAPI.getSystemInfo();
    const el = document.getElementById('sysinfo-content');
    if (el) {
        el.innerHTML = `
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
            </div>
        `;
    }
    document.getElementById('sysinfo-modal').classList.remove('hidden');
}

window.openSystemSecurityDashboard = openSystemSecurityDashboard;

window.openDeviceInfoModal = async function () {
    document.getElementById('device-info-modal').classList.remove('hidden');
    if (!window.electronAPI) return;
    const info = await window.electronAPI.getDeviceInfo();
    const displaysHtml = info.displays.map((d, i) => `
        <div style="background:var(--sys-glass-highlight); border-radius:12px; padding:14px; margin-bottom:10px; border:1px solid var(--sys-glass-border);">
            <div style="font-weight:600; font-size:14px; margin-bottom:8px;">${i === 0 ? '🖥️' : '📺'} ${d.label || `Display ${i + 1}`}</div>
            <div style="font-size:12px;">${d.resolution} @ ${d.refreshRate}Hz</div>
        </div>
    `).join('');
    document.getElementById('device-info-content').innerHTML = displaysHtml;
}

// Menu Action Listener
if (window.electronAPI) {
    window.electronAPI.onMenuAction((action) => {
        switch (action) {
            case 'new-tab': TM.createTab(); break;
            case 'new-incognito-tab': UI.newIncognitoTab(); break;
            case 'clear-browsing-data': UI.openClearDataModal(); break;
            case 'find': UI.openFindBar(); break;
            case 'zoom-in': TM.zoomIn(); break;
            case 'zoom-out': TM.zoomOut(); break;
            case 'zoom-reset': TM.zoomReset(); break;
            case 'print': { const a = TM.getActive(); if (a) try { a.webviewEl.print(); } catch (e) { } break; }
            case 'about': window.openAboutModal(); break;
            case 'system-info': window.openSystemInfo(); break;
            case 'system-security': window.openSystemSecurityDashboard(); break;
            case 'device-info': window.openDeviceInfoModal(); break;
        }
    });

    window.electronAPI.onNewTab((url) => TM.createTab(url));

    window.electronAPI.onSecurityWarning((data) => {
        const banner = document.getElementById('security-banner');
        const msgEl = document.getElementById('security-banner-msg');
        if (!banner || !msgEl) return;
        msgEl.textContent = `⚠️ ${data.type.toUpperCase()}: ${data.url || data.filename}`; // Simplified
        banner.classList.remove('hidden');
        setTimeout(() => banner.classList.add('hidden'), 8000);
    });

    window.electronAPI.onDownloadStatus((data) => {
        const toast = document.getElementById('download-toast');
        if (!toast) return;
        document.getElementById('download-filename').textContent = (data.isDangerous ? '⚠️ ' : '') + data.filename;
        document.getElementById('download-progress-fill').style.width = `${Math.round(data.progress || 0)}%`;
        document.getElementById('download-status-text').textContent = data.status;
        toast.classList.remove('hidden');
        if (data.status === 'completed' || data.status === 'interrupted' || data.status === 'cancelled') {
            setTimeout(() => toast.classList.add('hidden'), 4000);
        }
        UI.refreshDownloadsIfOpen?.();
    });

    window.electronAPI.onPowerEvent((data) => {
        UI.showNotification(data.message, 3000);
        if (data.type === 'suspend') TM._saveSession({ immediate: true });
    });

    if (window.electronAPI.onNetworkSpeed) {
        window.electronAPI.onNetworkSpeed((stats) => {
            const el = document.getElementById('network-speed');
            if (el) el.textContent = `⬇️ ${stats.download} | ⬆️ ${stats.upload}`;
        });
    }
}

// Init
async function init() {
    try {
        await db.open();
        await db.migrateLegacy({ storeGet: window.electronAPI?.storeGet });
        // Ask for persistent storage when supported (prevents eviction under disk pressure).
        try { await navigator.storage?.persist?.(); } catch (_) { }
    } catch (_) { }

    await PM.init();
    UI.init();

    // Restore session
    let restored = false;
    try {
        if (window.electronAPI) {
            const session = await window.electronAPI.loadSession();
            if (session && session.tabs && session.tabs.length > 0) {
                // Filter valid http/https URLs or internal pages
                const validTabs = session.tabs.filter(url => url && (url.startsWith('http') || url.endsWith('.html')));
                if (validTabs.length > 0) {
                    restored = true;
                    // Create first tab active
                    TM.createTab(validTabs[0], { active: true });
                    // Create remaining tabs
                    validTabs.slice(1).forEach(url => TM.createTab(url, { active: false }));
                }
            }
        }
    } catch (e) { console.error('Session restore failed:', e); }

    // If no session restored, create default tab
    if (!restored) {
        TM.createTab();
    }

    // Initial UI update
    UI.updateUI();
    UI.renderBookmarksBar();
}

init();
