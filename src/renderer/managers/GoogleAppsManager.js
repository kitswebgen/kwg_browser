
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

        window.addEventListener('resize', () => {
            if (this.isOpen) this.close();
        });
    }

    createMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'google-apps-menu hidden';
        this.menu.innerHTML = ''; // Clear

        // 1. Header
        const header = document.createElement('div');
        header.className = 'g-apps-header';

        const title = document.createElement('span');
        title.textContent = 'Google Apps';
        title.style.marginLeft = '4px';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = (e) => { e.stopPropagation(); this.close(); };

        header.append(title, closeBtn);

        // 2. Apps Grid
        const grid = document.createElement('div');
        grid.className = 'g-apps-grid';

        const apps = [
            { name: 'Search', url: 'https://www.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_2015_logo.svg' }, // Fixed logo
            { name: 'Gmail', url: 'https://mail.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg' },
            { name: 'Drive', url: 'https://drive.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg' },
            { name: 'YouTube', url: 'https://www.youtube.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg' },
            { name: 'Calendar', url: 'https://calendar.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg' },
            { name: 'Photos', url: 'https://photos.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Google_Photos_icon_%282020%29.svg' },
            { name: 'Maps', url: 'https://maps.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg' },
            { name: 'Meet', url: 'https://meet.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Google_Meet_icon_%282020%29.svg' },
            { name: 'News', url: 'https://news.google.com/', icon: 'https://upload.wikimedia.org/wikipedia/commons/d/da/Google_News_icon.svg' }
        ];

        apps.forEach(app => {
            const item = document.createElement('div');
            item.className = 'g-app-item';
            item.title = app.name;

            const img = document.createElement('img');
            img.src = app.icon;
            img.className = 'g-app-icon';
            img.alt = app.name;
            // Fallback for broken icons
            img.onerror = () => { img.src = 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg'; };

            const name = document.createElement('span');
            name.className = 'g-app-name';
            name.textContent = app.name;

            item.append(img, name);
            item.onclick = () => {
                this.TM.createTab(app.url);
                this.close();
            };
            grid.appendChild(item);
        });

        // 3. Footer / Account
        const footer = document.createElement('div');
        footer.className = 'g-account-section';

        const addAcct = document.createElement('div');
        addAcct.className = 'g-account-btn';
        addAcct.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            <span>Add another account</span>`;
        addAcct.onclick = () => { this.TM.createTab('https://accounts.google.com/AddSession'); this.close(); };

        const manageAcct = document.createElement('div');
        manageAcct.className = 'g-account-btn';
        manageAcct.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>Manage accounts</span>`;
        manageAcct.onclick = () => { this.TM.createTab('https://myaccount.google.com/'); this.close(); };

        footer.append(addAcct, manageAcct);

        this.menu.append(header, grid, footer);
        document.body.appendChild(this.menu);
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
