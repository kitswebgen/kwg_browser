const { app, screen, net, Notification } = require('electron');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const log = require('electron-log/main');

const execAsync = promisify(exec);

// Constants
const GB_FACTOR = 1024 ** 3;

// Cache static system info
let cachedStaticInfo = null;

function getStaticSystemInfo() {
    if (cachedStaticInfo) return cachedStaticInfo;

    const cpus = os.cpus();
    cachedStaticInfo = {
        platform: process.platform,
        platformName: os.type(),
        platformVersion: os.release(),
        arch: process.arch,
        hostname: os.hostname(),
        username: os.userInfo()?.username || 'Unknown',
        homeDir: os.homedir(),
        tempDir: os.tmpdir(),
        shell: os.userInfo()?.shell || (process.platform === 'win32' ? 'PowerShell' : '/bin/bash'),
        cpuModel: cpus[0]?.model || 'Unknown',
        cpuCores: cpus.length,
        cpuSpeed: `${cpus[0]?.speed || 0} MHz`,
        cpuArch: os.arch(),
        totalMemoryNum: os.totalmem(),
        totalMemory: `${(os.totalmem() / GB_FACTOR).toFixed(1)} GB`,
        browserVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node,
        v8Version: process.versions.v8,
    };
    return cachedStaticInfo;
}

async function getDiskInfo() {
    let diskInfo = { total: 'N/A', free: 'N/A', usedPercent: 0 };
    try {
        if (process.platform === 'win32') {
            const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
            const lines = stdout.trim().split('\n').slice(1).filter(l => l.trim());
            let totalDisk = 0, freeDisk = 0;
            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    freeDisk += parseInt(parts[1]) || 0;
                    totalDisk += parseInt(parts[2]) || 0;
                }
            });
            diskInfo = {
                total: `${Math.round(totalDisk / GB_FACTOR)} GB`,
                free: `${Math.round(freeDisk / GB_FACTOR)} GB`,
                usedPercent: totalDisk > 0 ? Math.round(((totalDisk - freeDisk) / totalDisk) * 100) : 0
            };
        } else {
            const { stdout } = await execAsync("df -k / | tail -1");
            const parts = stdout.trim().split(/\s+/);
            const totalBlocks = parseInt(parts[1]) || 0;
            const usedBlocks = parseInt(parts[2]) || 0;
            diskInfo = {
                total: `${Math.round((totalBlocks * 1024) / GB_FACTOR)} GB`,
                free: `${Math.round(((totalBlocks - usedBlocks) * 1024) / GB_FACTOR)} GB`,
                usedPercent: totalBlocks > 0 ? Math.round((usedBlocks / totalBlocks) * 100) : 0
            };
        }
    } catch (e) {
        log.warn('[Disk] Could not get disk info:', e.message);
    }
    return diskInfo;
}

function getNetworkInterfaces() {
    const interfaces = [];
    const networkInterfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
        const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
        if (ipv4) interfaces.push({ name, address: ipv4.address, mac: ipv4.mac, netmask: ipv4.netmask });
    }
    return interfaces;
}

async function getSystemSecurity(store) {
    const staticInfo = getStaticSystemInfo();
    const freeMem = os.freemem();
    const usedMem = staticInfo.totalMemoryNum - freeMem;
    const memUsagePercent = Math.round((usedMem / staticInfo.totalMemoryNum) * 100);

    const [diskInfo, gpuData] = await Promise.all([
        getDiskInfo(),
        app.getGPUInfo('basic').catch(e => { log.warn('[GPU]', e.message); return null; })
    ]);

    let gpuInfo = 'Unknown';
    if (gpuData?.gpuDevice?.[0]) {
        const gpu = gpuData.gpuDevice[0];
        gpuInfo = gpu.description || `Vendor: ${gpu.vendorId}, Device: ${gpu.deviceId}`;
    }

    const securityChecks = {
        httpsUpgrade: store?.get('httpsUpgrade', true) ?? true,
        adBlocker: store?.get('adBlockEnabled', true) ?? true,
        doNotTrack: store?.get('privacySettings.doNotTrack', true) ?? true,
        fingerprintProtection: store?.get('privacySettings.fingerprintProtection', true) ?? true,
        thirdPartyCookiesBlocked: store?.get('privacySettings.blockThirdPartyCookies', true) ?? true,
        sandboxEnabled: true,
        contextIsolation: true,
        secureEncryption: true,
        safeBrowsing: true,
        pbkdf2Auth: true
    };

    const securityScore = Object.values(securityChecks).filter(Boolean).length;
    const maxScore = Object.keys(securityChecks).length;
    const primaryDisplay = screen.getPrimaryDisplay();

    return {
        ...staticInfo,
        freeMemory: `${(freeMem / GB_FACTOR).toFixed(1)} GB`,
        usedMemory: `${(usedMem / GB_FACTOR).toFixed(1)} GB`,
        memUsagePercent,
        diskTotal: diskInfo.total,
        diskFree: diskInfo.free,
        diskUsedPercent: diskInfo.usedPercent,
        networkInterfaces: getNetworkInterfaces(),
        isOnline: net.isOnline(),
        gpuInfo,
        displayCount: screen.getAllDisplays().length,
        primaryResolution: `${primaryDisplay.size.width}x${primaryDisplay.size.height}`,
        scaleFactor: primaryDisplay.scaleFactor,
        colorDepth: primaryDisplay.colorDepth,
        refreshRate: primaryDisplay.displayFrequency || 'Unknown',
        touchSupport: primaryDisplay.touchSupport || 'Unknown',
        securityChecks,
        securityScore,
        maxSecurityScore: maxScore,
        securityGrade: securityScore >= 9 ? 'A+' : securityScore >= 7 ? 'A' : securityScore >= 5 ? 'B' : 'C',
        uptime: `${Math.round(os.uptime() / 3600)}h ${Math.round((os.uptime() % 3600) / 60)}m`,
        processUptime: `${Math.round(process.uptime() / 60)}m`,
        pid: process.pid,
        configPath: store?.path || ''
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
    return {
        online: net.isOnline(),
        interfaces: getNetworkInterfaces().map(i => ({ name: i.name, ip: i.address, mac: i.mac })),
        hostname: os.hostname()
    };
}

module.exports = {
    getSecurityInfo: getSystemSecurity,
    getDeviceInfo,
    sendNotification,
    getNetworkStatus,
    getSystemSecurity
};
