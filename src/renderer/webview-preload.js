const { ipcRenderer } = require('electron');

// =========================================================
//  AD AUTOMATION & SKIPPING
// =========================================================
function attemptSkipAds() {
    try {
        // YouTube Skip Button
        const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .videoAdUiSkipButton');
        if (skipBtn) {
            console.log('[AdSkipper] Clicking skip button');
            skipBtn.click();
        }

        // YouTube Overlay Ads (Close button)
        const overlayClose = document.querySelector('.ytp-ad-overlay-close-button');
        if (overlayClose) {
            console.log('[AdSkipper] Closing overlay ad');
            overlayClose.click();
        }

        // Twitch specific (if any)
        // ...
    } catch (e) {
        // Silent fail
    }
}

// Use MutationObserver for performance instead of setInterval
// Use MutationObserver for performance instead of setInterval
let timeout = null;
const observer = new MutationObserver((mutations) => {
    // Debounce to prevent rapid firing on every DOM change
    if (timeout) return;

    timeout = setTimeout(() => {
        timeout = null;
        attemptSkipAds();
    }, 100);
});

// Start observing
if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
    });
}


// =========================================================
//  AI CONTENT EXTRACTION
// =========================================================
function getPageContent() {
    // Get visible text, somewhat cleaned
    const body = document.body.innerText;
    // Limit to reasonable length
    return body.substring(0, 5000)
        .replace(/\s+/g, ' ')
        .trim();
}

function getPageMetadata() {
    return {
        title: document.title,
        url: window.location.href,
        description: document.querySelector('meta[name="description"]')?.content || ''
    };
}

// Listen for requests from Host (Renderer)
ipcRenderer.on('get-page-content', () => {
    const content = getPageContent();
    const meta = getPageMetadata();
    ipcRenderer.sendToHost('page-content-result', { content, meta });
});

// Auto-notify host on significant changes (optional, maybe too noisy)
// document.addEventListener('DOMContentLoaded', () => {
//     ipcRenderer.sendToHost('page-loaded', getPageMetadata());
// });
