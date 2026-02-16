
export class ProfileManager {
    constructor(callbacks = {}) {
        this.profile = null;
        this.callbacks = callbacks; // onProfileUpdate
    }

    async init() {
        if (window.electronAPI) {
            this.profile = await window.electronAPI.accountGetProfile();
            this.renderProfile();
        }
    }

    isLoggedIn() { return this.profile !== null; }

    async login(email, password) {
        if (!window.electronAPI) return { ok: false, msg: 'API unavailable' };
        const result = await window.electronAPI.accountLogin({ email, password });
        if (result.ok) { this.profile = result.profile; this.renderProfile(); }
        return result;
    }

    async signup(name, email, password) {
        if (!window.electronAPI) return { ok: false, msg: 'API unavailable' };
        const result = await window.electronAPI.accountSignup({ name, email, password });
        if (result.ok) { this.profile = result.profile; this.renderProfile(); }
        return result;
    }

    async logout() {
        if (window.electronAPI) {
            await window.electronAPI.accountLogout();
            this.profile = null;
            this.renderProfile();
        }
    }

    renderProfile() {
        if (this.callbacks.onProfileUpdate) {
            this.callbacks.onProfileUpdate(this.profile);
        }
    }
}
