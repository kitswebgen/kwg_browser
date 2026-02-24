const { session } = require('electron');
const fs = require('fs');
const { promises: fsPromises } = fs;

let totalBytesReceived = 0;
let totalBytesSent = 0;
let lastCheckTime = Date.now();
let monitorInterval = null;

/**
 * Format bits per second to human readable string
 * @param {number} bits 
 * @returns {string}
 */
const formatSpeed = (bits) => {
    if (bits >= 1e9) return (bits / 1e9).toFixed(2) + ' Gbps';
    if (bits >= 1e6) return (bits / 1e6).toFixed(2) + ' Mbps';
    if (bits >= 1e3) return (bits / 1e3).toFixed(2) + ' Kbps';
    return bits.toFixed(0) + ' bps';
};

function monitorNetwork(mainWindow) {
    const ses = session.fromPartition('persist:kits-browser');
    if (!ses) return;

    // Track downloads
    ses.webRequest.onHeadersReceived((details, callback) => {
        const len = details.responseHeaders['content-length'] || details.responseHeaders['Content-Length'];
        if (len) {
            const size = parseInt(Array.isArray(len) ? len[0] : len, 10);
            if (!isNaN(size)) totalBytesReceived += size;
        }
        callback({ cancel: false });
    });

    // Track uploads (approximate via body size)
    ses.webRequest.onBeforeRequest(async (details, callback) => {
        if (details.uploadData) {
            for (const blob of details.uploadData) {
                if (blob.bytes) {
                    totalBytesSent += blob.bytes.length;
                } else if (blob.file) {
                    try {
                        const stats = await fsPromises.stat(blob.file);
                        totalBytesSent += stats.size;
                    } catch (e) {
                        // Silently ignore stat errors for deleted/missing files during upload
                    }
                }
            }
        }
        callback({ cancel: false });
    });

    // Broadcast speed updates every second
    if (monitorInterval) clearInterval(monitorInterval);

    monitorInterval = setInterval(() => {
        const now = Date.now();
        const duration = (now - lastCheckTime) / 1000; // seconds

        // Avoid division by zero or tiny intervals
        if (duration <= 0.1) return;

        // Calculate bits per second
        const downloadSpeed = (totalBytesReceived * 8) / duration;
        const uploadSpeed = (totalBytesSent * 8) / duration;

        const stats = {
            download: formatSpeed(downloadSpeed),
            upload: formatSpeed(uploadSpeed),
            downRaw: downloadSpeed,
            upRaw: uploadSpeed
        };

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('network-speed-update', stats);
        }

        // Reset counters
        totalBytesReceived = 0;
        totalBytesSent = 0;
        lastCheckTime = now;
    }, 1000);
}

module.exports = { monitorNetwork };
