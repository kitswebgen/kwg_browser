
export class AIPanel {
    constructor(tm) {
        this.TM = tm;
        this.panel = document.getElementById('ai-panel');
        this.messages = document.getElementById('ai-messages');
        this.input = document.getElementById('ai-input');
        this.sendBtn = document.getElementById('ai-send-btn');
        this.closeBtn = document.getElementById('close-ai-panel');

        this.isOpen = false;

        this.init();
    }

    init() {
        if (!this.panel) return;

        this.closeBtn.onclick = () => this.toggle(false);
        this.sendBtn.onclick = () => this.handleSend();
        this.input.onkeydown = (e) => {
            if (e.key === 'Enter') this.handleSend();
        };

        // Expose global for suggestion cards
        window.askAI = (prompt) => {
            this.input.value = prompt;
            this.handleSend();
        };
        window.toggleAI = () => this.toggle();

        // Command Palette integration
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
                e.preventDefault();
                this.toggle();
                if (this.isOpen) setTimeout(() => this.input.focus(), 100);
            }
        });
    }

    toggle(forceState) {
        if (typeof forceState === 'boolean') {
            this.isOpen = forceState;
        } else {
            this.isOpen = !this.isOpen;
        }

        if (this.isOpen) {
            this.panel.classList.remove('hidden');
        } else {
            this.panel.classList.add('hidden');
        }
    }

    async handleSend() {
        const text = this.input.value.trim();
        if (!text) return;

        this.addMessage(text, 'user');
        this.input.value = '';

        // Show loading
        const loadingId = this.addMessage('Thinking...', 'bot', true);

        try {
            // Get context from active tab
            const activeTab = this.TM.getActive();
            let context = null;

            if (activeTab && activeTab.webviewEl) {
                // Request content
                // We need to wait for the response. Since ipc-message is async, we can wrap it in a promise
                // OR just use the cached content if we had one?
                // Better: send message, wait a bit.

                // For now, let's try to get what we can. 
                // The preload script responds to 'get-page-content' with 'page-content-result'

                context = await this.fetchPageContext(activeTab);
            }

            // Call Main Process AI
            const response = await window.electronAPI.aiChat(text, context);

            this.updateMessage(loadingId, response);

        } catch (e) {
            this.updateMessage(loadingId, "Error: " + e.message);
        }
    }

    fetchPageContext(tab) {
        return new Promise((resolve) => {
            let handler;

            // Timeout in case webview doesn't respond
            const timeout = setTimeout(() => {
                tab.webviewEl.removeEventListener('ipc-message', handler);
                resolve({ title: tab.webviewEl.getTitle(), url: tab.webviewEl.getURL() });
            }, 2000);

            handler = (e) => {
                if (e.channel === 'page-content-result') {
                    clearTimeout(timeout);
                    tab.webviewEl.removeEventListener('ipc-message', handler);
                    resolve(e.args[0]); // { content, meta }
                }
            };

            tab.webviewEl.addEventListener('ipc-message', handler);
            try {
                tab.webviewEl.send('get-page-content');
            } catch (e) {
                clearTimeout(timeout);
                tab.webviewEl.removeEventListener('ipc-message', handler);
                resolve(null);
            }
        });
    }

    addMessage(text, type, isLoading = false) {
        const div = document.createElement('div');
        div.className = `ai-msg ai-${type}`;
        div.textContent = text;
        if (isLoading) div.id = 'ai-loading-' + Date.now();
        this.messages.appendChild(div);
        this.scrollToBottom();
        return div.id;
    }

    updateMessage(id, newText) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = newText;
            // Markdown parsing could go here (e.g. marked library)
            // For now requesting plain text or assuming basic text
        }
    }

    scrollToBottom() {
        this.messages.scrollTop = this.messages.scrollHeight;
    }
    handlePageContent(data) {
        // Optional: Could proactively update context in a real implementation
        console.log('[AI] Page context updated');
    }
}
