const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const adBlockList = [
    'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
    'doubleclick.net', 'adservice.google.com', 'pagead2.googlesyndication.com',
    'quantserve.com', 'pixel.quantserve.com', 'scorecardresearch.com',
    'adnxs.com', 'ib.adnxs.com', 'amazon-adsystem.com', 'aax.amazon-adsystem.com',
    'taboola.com', 'cdn.taboola.com', 'outbrain.com', 'widgets.outbrain.com',
    'openx.net', 'pubmatic.com', 'rubiconproject.com', 'criteo.com',
    'casalemedia.com', 'yieldmo.com', 'indexww.com', 'advertising.com',
    'ad.mail.ru', 'top-fwz1.mail.ru', 'counter.yadro.ru'
];

const dangerousProtocols = ['javascript:', 'vbscript:', 'data:text/html', 'file:'];

const unsafeUrlPatterns = [
    /phishing/i, /malware/i, /scam/i, /fake-login/i,
    /steal-password/i, /credential-harvest/i,
    /bit\.ly\/.*login/i, /tinyurl\.com\/.*account/i
];

const dangerousExtensions = ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.wsf', '.scr'];

module.exports = {
    userAgent,
    adBlockList,
    dangerousProtocols,
    unsafeUrlPatterns,
    dangerousExtensions
};
