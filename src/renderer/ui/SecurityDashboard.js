
export function openSystemSecurityDashboard() {
    const modal = document.getElementById('security-dashboard-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (!window.electronAPI) return;

    const gradeEl = document.getElementById('security-grade-badge');
    const scoreTextEl = document.getElementById('security-score-text');
    const scoreFillEl = document.getElementById('security-score-fill');

    const tabButtons = [...modal.querySelectorAll('.sec-tab')];
    const panels = {
        security: document.getElementById('sec-panel-security'),
        hardware: document.getElementById('sec-panel-hardware'),
        network: document.getElementById('sec-panel-network'),
        storage: document.getElementById('sec-panel-storage'),
        browser: document.getElementById('sec-panel-browser')
    };

    const activateTab = (key) => {
        tabButtons.forEach((btn) => {
            const active = btn.getAttribute('data-sec-tab') === key;
            btn.classList.toggle('active', active);
            // Make the active tab feel "selected" even with inline styles in HTML.
            btn.style.background = active
                ? 'color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent)'
                : 'var(--sys-glass-highlight)';
        });
        Object.entries(panels).forEach(([k, el]) => {
            if (!el) return;
            el.style.display = (k === key) ? '' : 'none';
        });
    };

    if (!modal.dataset.secTabsInit) {
        modal.dataset.secTabsInit = '1';
        tabButtons.forEach((btn) => {
            btn.addEventListener('click', () => activateTab(btn.getAttribute('data-sec-tab') || 'security'));
        });
    }

    activateTab('security');

    const setLoading = (msg = 'Loading…') => {
        Object.values(panels).forEach((el) => {
            if (!el) return;
            el.innerHTML = `<div style="padding:16px; opacity:0.75;">${msg}</div>`;
        });
    };

    const svg = {
        ok: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
        bad: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`
    };

    const renderChecks = (checksObj) => {
        const checks = (checksObj && typeof checksObj === 'object') ? checksObj : {};
        const meta = [
            { key: 'httpsUpgrade', label: 'HTTPS Upgrade', desc: 'Upgrades HTTP to HTTPS when possible.' },
            { key: 'adBlocker', label: 'Ad & Tracker Blocking', desc: 'Blocks common ad/tracker endpoints.' },
            { key: 'doNotTrack', label: 'Do Not Track', desc: 'Sends the DNT header.' },
            { key: 'fingerprintProtection', label: 'Fingerprint Protection', desc: 'Sends GPC and reduces tracking surface.' },
            { key: 'thirdPartyCookiesBlocked', label: '3rd‑party cookies', desc: 'Configured to block third‑party cookies.' },
            { key: 'safeBrowsing', label: 'Safe Browsing', desc: 'Blocks suspicious/phishing URL patterns.' },
            { key: 'pbkdf2Auth', label: 'Secure Auth', desc: 'Uses PBKDF2 hashing for local accounts.' },
            { key: 'contextIsolation', label: 'Context Isolation', desc: 'Isolates renderer context from preload APIs.' },
            { key: 'sandboxEnabled', label: 'Sandboxing', desc: 'Uses Chromium sandboxing where supported.' },
            { key: 'secureEncryption', label: 'Encrypted Config', desc: 'Encrypts local configuration storage.' }
        ];

        const known = new Set(meta.map(m => m.key));
        const extra = Object.keys(checks).filter(k => !known.has(k)).sort();
        extra.forEach((k) => meta.push({ key: k, label: k, desc: '' }));

        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gap = '10px';

        meta.forEach((m) => {
            const ok = !!checks[m.key];
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'flex-start';
            row.style.gap = '12px';
            row.style.padding = '12px';
            row.style.borderRadius = '14px';
            row.style.border = '1px solid var(--sys-glass-border)';
            row.style.background = 'var(--sys-glass-highlight)';

            const icon = document.createElement('div');
            icon.style.width = '28px';
            icon.style.height = '28px';
            icon.style.borderRadius = '9999px';
            icon.style.display = 'inline-flex';
            icon.style.alignItems = 'center';
            icon.style.justifyContent = 'center';
            icon.style.color = ok ? '#1e8e3e' : '#d93025';
            icon.style.background = ok ? 'rgba(52,168,83,0.14)' : 'rgba(217,48,37,0.12)';
            icon.innerHTML = ok ? svg.ok : svg.bad;

            const content = document.createElement('div');
            content.style.flex = '1';

            const title = document.createElement('div');
            title.textContent = m.label;
            title.style.fontWeight = '700';
            title.style.fontSize = '13px';

            const desc = document.createElement('div');
            desc.textContent = m.desc || (ok ? 'Enabled' : 'Disabled');
            desc.style.opacity = '0.72';
            desc.style.fontSize = '12px';
            desc.style.marginTop = '2px';

            const status = document.createElement('div');
            status.textContent = ok ? 'On' : 'Off';
            status.style.fontWeight = '700';
            status.style.fontSize = '12px';
            status.style.marginLeft = '8px';
            status.style.marginTop = '2px';
            status.style.opacity = '0.9';

            content.appendChild(title);
            content.appendChild(desc);
            row.appendChild(icon);
            row.appendChild(content);
            row.appendChild(status);
            wrap.appendChild(row);
        });

        return wrap;
    };

    const renderKeyValueGrid = (rows) => {
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = '1fr 1fr';
        grid.style.gap = '8px 16px';
        grid.style.fontSize = '12px';
        grid.style.lineHeight = '1.7';

        rows.forEach(([k, v]) => {
            const key = document.createElement('div');
            key.textContent = k;
            key.style.opacity = '0.75';

            const val = document.createElement('div');
            val.textContent = v ?? '';
            val.style.fontWeight = '700';

            grid.appendChild(key);
            grid.appendChild(val);
        });
        return grid;
    };

    const renderListCards = (items, renderItem) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gap = '10px';
        items.forEach((it) => wrap.appendChild(renderItem(it)));
        return wrap;
    };

    setLoading();

    // Use async internally but no need to await it here
    (async () => {
        try {
            const data = await window.electronAPI.getSystemSecurity();

            const score = Number(data?.securityScore || 0);
            const max = Math.max(1, Number(data?.maxSecurityScore || 10));
            const ratio = Math.max(0, Math.min(1, score / max));

            if (gradeEl) gradeEl.textContent = String(data?.securityGrade || '—');
            if (scoreTextEl) scoreTextEl.textContent = `${score}/${max}`;
            if (scoreFillEl) scoreFillEl.style.width = `${Math.round(ratio * 100)}%`;

            // Color grade badge based on score ratio.
            if (gradeEl) {
                const palette = ratio >= 0.9 ? { a: '#34A853', b: '#4CAF50', glow: 'rgba(52,168,83,0.38)' }
                    : ratio >= 0.7 ? { a: '#1a73e8', b: '#4c8bf5', glow: 'rgba(26,115,232,0.35)' }
                        : ratio >= 0.5 ? { a: '#f29900', b: '#fbbc04', glow: 'rgba(251,188,4,0.32)' }
                            : { a: '#d93025', b: '#ea4335', glow: 'rgba(217,48,37,0.35)' };
                gradeEl.style.background = `linear-gradient(135deg, ${palette.a}, ${palette.b})`;
                gradeEl.style.boxShadow = `0 4px 20px ${palette.glow}`;
            }
            if (scoreFillEl) {
                const fill = ratio >= 0.9 ? '#34A853' : ratio >= 0.7 ? '#1a73e8' : ratio >= 0.5 ? '#fbbc04' : '#d93025';
                scoreFillEl.style.background = `linear-gradient(90deg, ${fill}, color-mix(in srgb, ${fill} 70%, #ffffff))`;
            }

            // Security panel
            if (panels.security) {
                panels.security.replaceChildren(renderChecks(data?.securityChecks));
            }

            // Hardware panel
            if (panels.hardware) {
                const rows = [
                    ['CPU', data?.cpuModel],
                    ['Cores', String(data?.cpuCores ?? '')],
                    ['CPU Speed', data?.cpuSpeed],
                    ['Memory', `${data?.usedMemory || ''} / ${data?.totalMemory || ''} (${data?.memUsagePercent ?? 0}%)`],
                    ['GPU', data?.gpuInfo],
                    ['Displays', String(data?.displayCount ?? '')],
                    ['Primary', data?.primaryResolution],
                    ['Scale', `x${data?.scaleFactor ?? 1}`]
                ];
                panels.hardware.replaceChildren(renderKeyValueGrid(rows));
            }

            // Network panel (no Online/Offline indicator per UI request)
            if (panels.network) {
                const ifaces = Array.isArray(data?.networkInterfaces) ? data.networkInterfaces : [];
                const hostname = String(data?.hostname || '');
                const top = renderKeyValueGrid([
                    ['Hostname', hostname],
                    ['Interfaces', String(ifaces.length)]
                ]);

                const cards = renderListCards(ifaces, (it) => {
                    const card = document.createElement('div');
                    card.style.padding = '12px';
                    card.style.borderRadius = '14px';
                    card.style.border = '1px solid var(--sys-glass-border)';
                    card.style.background = 'var(--sys-glass-highlight)';

                    const title = document.createElement('div');
                    title.textContent = it?.name || 'Interface';
                    title.style.fontWeight = '800';
                    title.style.fontSize = '13px';
                    title.style.marginBottom = '6px';

                    const grid = renderKeyValueGrid([
                        ['IP', it?.address || '—'],
                        ['Netmask', it?.netmask || '—'],
                        ['MAC', it?.mac || '—']
                    ]);

                    card.appendChild(title);
                    card.appendChild(grid);
                    return card;
                });

                const wrap = document.createElement('div');
                wrap.style.display = 'grid';
                wrap.style.gap = '12px';
                wrap.appendChild(top);
                if (ifaces.length > 0) wrap.appendChild(cards);
                else {
                    const empty = document.createElement('div');
                    empty.style.padding = '16px';
                    empty.style.opacity = '0.7';
                    empty.textContent = 'No active network interfaces detected.';
                    wrap.appendChild(empty);
                }
                panels.network.replaceChildren(wrap);
            }

            // Storage panel
            if (panels.storage) {
                const rows = [
                    ['Disk Total', data?.diskTotal],
                    ['Disk Free', data?.diskFree],
                    ['Disk Used', `${data?.diskUsedPercent ?? 0}%`],
                    ['Config Path', data?.configPath],
                    ['Temp Dir', data?.tempDir],
                    ['Home Dir', data?.homeDir]
                ];
                panels.storage.replaceChildren(renderKeyValueGrid(rows));
            }

            // Browser panel
            if (panels.browser) {
                const rows = [
                    ['App Version', data?.browserVersion],
                    ['Electron', data?.electronVersion],
                    ['Chromium', data?.chromeVersion],
                    ['Node.js', data?.nodeVersion],
                    ['V8', data?.v8Version],
                    ['Uptime', data?.uptime],
                    ['Process Uptime', data?.processUptime],
                    ['PID', String(data?.pid ?? '')]
                ];
                panels.browser.replaceChildren(renderKeyValueGrid(rows));
            }
        } catch (e) {
            setLoading('Security dashboard unavailable in this build.');
        }
    })();
}
