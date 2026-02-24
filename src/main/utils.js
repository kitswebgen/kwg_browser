const crypto = require('crypto');

function hashPassword(password, salt = null) {
    const s = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, s, 1000, 64, 'sha512').toString('hex');
    return { hash, salt: s };
}

function verifyPassword(password, storedHash, storedSalt) {
    const { hash } = hashPassword(password, storedSalt);
    return hash === storedHash;
}

function sanitize(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[<>]/g, '').trim();
}

module.exports = {
    hashPassword,
    verifyPassword,
    sanitize
};
