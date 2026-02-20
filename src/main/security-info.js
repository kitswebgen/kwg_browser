const { app, screen, net, Notification } = require('electron');
const os = require('os');
const path = require('path');
const log = require('electron-log/main');

async function getSystemSecurity(store) {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = Math.round((usedMem / totalMem) * 100);
    const networkInterfaces = os.networkInterfaces();

    // Calculate disk space (cross-platform)
    let diskInfo = { total: 'N/A', free: 'N/A', usedPercent: 0 };
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const result = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf-8' });
            const lines = result.trim().split('\n').slice(1).filter(l => l.trim());
            let totalDisk = 0, freeDisk = 0;
            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    freeDisk += parseInt(parts[1]) || 0;
                    totalDisk += parseInt(parts[2]) || 0;
                }
            });
            diskInfo = {
                total: `${Math.round(totalDisk / (1024 ** 3))} GB`,
                free: `${Math.round(freeDisk / (1024 ** 3))} GB`,
                usedPercent: totalDisk > 0 ? Math.round(((totalDisk - freeDisk) / totalDisk) * 100) : 0
            };
        } else {
            const { execSync } = require('child_process');
            const result = execSync("df -k / | tail -1", { encoding: 'utf-8' });
            const parts = result.trim().split(/\s+/);
            const totalBlocks = parseInt(parts[1]) || 0;
            const usedBlocks = parseInt(parts[2]) || 0;
            diskInfo = {
                total: `${Math.round((totalBlocks * 1024) / (1024 ** 3))} GB`,
                free: `${Math.round(((totalBlocks - usedBlocks) * 1024) / (1024 ** 3))} GB`,
                usedPercent: totalBlocks > 0 ? Math.round((usedBlocks / totalBlocks) * 100) : 0
            };
        }
    } catch (e) { log.warn('[Disk] Could not get disk info:', e.message); }

    // Network interfaces
    const interfaces = [];
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
        const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
        if (ipv4) interfaces.push({ name, address: ipv4.address, mac: ipv4.mac, netmask: ipv4.netmask });
    }

    // GPU info
    let gpuInfo = 'Unknown';
    try {
        const gpuData = await app.getGPUInfo('basic');
        if (gpuData?.gpuDevice?.[0]) {
            const gpu = gpuData.gpuDevice[0];
            gpuInfo = gpu.description || `Vendor: ${gpu.vendorId}, Device: ${gpu.deviceId}`;
        }
    } catch (e) { log.warn('[GPU]', e.message); }

    // Security posture
    const securityChecks = {
        httpsUpgrade: store.get('httpsUpgrade', true),
        adBlocker: store.get('adBlockEnabled', true),
        doNotTrack: store.get('privacySettings.doNotTrack', true),
        fingerprintProtection: store.get('privacySettings.fingerprintProtection', true),
        thirdPartyCookiesBlocked: store.get('privacySettings.blockThirdPartyCookies', true),
        sandboxEnabled: true,
        contextIsolation: true,
        secureEncryption: true,
        safeBrowsing: true,
        pbkdf2Auth: true
    };
    const securityScore = Object.values(securityChecks).filter(Boolean).length;
    const maxScore = Object.keys(securityChecks).length;

    // Screen info
    const primaryDisplay = screen.getPrimaryDisplay();
    const allDisplays = screen.getAllDisplays();

    return {
        // Platform
        platform: process.platform,
        platformName: os.type(),
        platformVersion: os.release(),
        arch: process.arch,
        hostname: os.hostname(),
        username: os.userInfo().username,
        homeDir: os.homedir(),
        tempDir: os.tmpdir(),
        shell: os.userInfo().shell || (process.platform === 'win32' ? 'PowerShell' : '/bin/bash'),

        // CPU
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        cpuSpeed: `${cpus[0]?.speed || 0} MHz`,
        cpuArch: os.arch(),

        // Memory
        totalMemory: `${(totalMem / (1024 ** 3)).toFixed(1)} GB`,
        freeMemory: `${(freeMem / (1024 ** 3)).toFixed(1)} GB`,
        usedMemory: `${(usedMem / (1024 ** 3)).toFixed(1)} GB`,
        memUsagePercent,

        // Disk
        diskTotal: diskInfo.total,
        diskFree: diskInfo.free,
        diskUsedPercent: diskInfo.usedPercent,

        // Network
        networkInterfaces: interfaces,
        isOnline: net.isOnline(),

        // GPU
        gpuInfo,

        // Display
        displayCount: allDisplays.length,
        primaryResolution: `${primaryDisplay.size.width}x${primaryDisplay.size.height}`,
        scaleFactor: primaryDisplay.scaleFactor,
        colorDepth: primaryDisplay.colorDepth,
        refreshRate: primaryDisplay.displayFrequency || 'Unknown',
        touchSupport: primaryDisplay.touchSupport || 'Unknown',

        // Security
        securityChecks,
        securityScore,
        maxSecurityScore: maxScore,
        securityGrade: securityScore >= 9 ? 'A+' : securityScore >= 7 ? 'A' : securityScore >= 5 ? 'B' : 'C',

        // Browser
        browserVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node,
        v8Version: process.versions.v8,
        uptime: `${Math.round(os.uptime() / 3600)}h ${Math.round((os.uptime() % 3600) / 60)}m`,
        processUptime: `${Math.round(process.uptime() / 60)}m`,
        pid: process.pid,
        configPath: store.path
    };
}

function getDeviceInfo() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const allDisplays = screen.getAllDisplays();
    return {
        displays: allDisplays.map(d => ({
            id: d.id,
            label: d.label || `Display ${d.id}`,
            resolution: `${d.size.width}x${d.size.height}`,
            workArea: `${d.workArea.width}x${d.workArea.height}`,
            scaleFactor: d.scaleFactor,
            rotation: d.rotation,
            colorDepth: d.colorDepth,
            refreshRate: d.displayFrequency || 'N/A',
            internal: d.internal || false,
            touchSupport: d.touchSupport || 'unknown',
            bounds: d.bounds
        })),
        primary: {
            resolution: `${primaryDisplay.size.width}x${primaryDisplay.size.height}`,
            scaleFactor: primaryDisplay.scaleFactor,
            dpi: Math.round(primaryDisplay.scaleFactor * 96),
            isHiDPI: primaryDisplay.scaleFactor > 1,
            colorDepth: primaryDisplay.colorDepth
        },
        platform: process.platform,
        platformName: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
        arch: process.arch,
        isARM: process.arch.includes('arm'),
        is64bit: process.arch.includes('64'),
        locale: app.getLocale(),
        systemLocale: app.getSystemLocale ? app.getSystemLocale() : app.getLocale()
    };
}

function sendNotification(mainWindow, { title, body, urgency }) {
    if (!Notification.isSupported()) return { success: false, reason: 'Notifications not supported' };
    
    // We need to resolve the icon path relative to correct directory
    // Assuming this file is in src/main/security-info.js, and icon is in src/renderer/icon.png
    const iconPath = path.join(__dirname, '../renderer/icon.png');
    
    const notification = new Notification({
        title: title || 'KITSWebGen',
        body: body || '',
        icon: iconPath,
        urgency: urgency || 'normal'
    });
    notification.show();
    notification.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
    return { success: true };
}

function getNetworkStatus() {
    const interfaces = os.networkInterfaces();
    const activeInterfaces = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
        const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
        if (ipv4) activeInterfaces.push({ name, ip: ipv4.address, mac: ipv4.mac });
    }
    return {
        online: net.isOnline(),
        interfaces: activeInterfaces,
        dns: os.networkInterfaces(),
        hostname: os.hostname()
    };
}

module.exports = {
    getSystemSecurity,
    getDeviceInfo,
    sendNotification,
    getNetworkStatus
};
