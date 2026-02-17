
export class GoogleAppsManager {
    constructor(tabManager, uiManager) {
        this.TM = tabManager;
        this.UI = uiManager;
        this.menu = null;
        this.isOpen = false;

        this.init();
    }

    init() {
        this.createMenu();

        const btn = document.getElementById('google-apps-btn');
        if (btn) {
            btn.onclick = (e) => {
                e.stopPropagation();
                this.toggle();
            };
        }

        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.menu.contains(e.target) && e.target.id !== 'google-apps-btn') {
                this.close();
            }
        });
    }

    createMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'google-apps-menu hidden';

        // Define app items for cleaner generation
        const apps = [
            { name: 'Gmail', url: 'https://mail.google.com/mail/u/0/', icon: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg' },
            { name: 'Drive', url: 'https://drive.google.com/drive/', icon: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg' },
            { name: 'YouTube', url: 'https://www.youtube.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg' },
            { name: 'Calendar', url: 'https://calendar.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg' },
            { name: 'Photos', url: 'https://photos.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Google_Photos_icon_%282020%29.svg' },
            { name: 'Maps', url: 'https://maps.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg' }
        ];

        const appsHtml = apps.map(app => `
            <div class="g-app-item" data-url="${app.url}">
                <img src="${app.icon}" class="g-app-icon" alt="${app.name}">
                <span class="g-app-name">${app.name}</span>
            </div>
        `).join('');

        this.menu.innerHTML = `
            <div class="g-apps-header">
                <span>Google Apps</span>
                <span class="close-btn" style="width:24px; height:24px; font-size:16px;">&times;</span>
            </div>
            
            <div class="g-apps-grid">
                ${appsHtml}
            </div>
            
            <div class="g-account-section">
                <div class="g-account-btn" id="g-add-account">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="16"></line>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                    <span>Add another account</span>
                </div>
                <div class="g-account-btn" id="g-manage-account">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    <span>Manage accounts</span>
                </div>
            </div>
        `;

        document.body.appendChild(this.menu);

        // Event Listeners
        this.menu.querySelector('.close-btn').onclick = () => this.close();

        this.menu.querySelectorAll('.g-app-item').forEach(item => {
            item.onclick = () => {
                const url = item.getAttribute('data-url');
                this.TM.createTab(url);
                this.close();
            };
        });

        this.menu.querySelector('#g-add-account').onclick = () => {
            // Standard URL for adding a Google session
            this.TM.createTab('https://accounts.google.com/AddSession');
            this.close();
        };

        this.menu.querySelector('#g-manage-account').onclick = () => {
            this.TM.createTab('https://myaccount.google.com/');
            this.close();
        };
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    open() {
        const btn = document.getElementById('google-apps-btn');
        if (!btn) return;

        const rect = btn.getBoundingClientRect();
        this.menu.style.top = (rect.bottom + 10) + 'px';
        this.menu.style.left = (rect.right - 320) + 'px'; // Align right

        this.menu.classList.remove('hidden');
        this.isOpen = true;
    }

    close() {
        this.menu.classList.add('hidden');
        this.isOpen = false;
    }
}
