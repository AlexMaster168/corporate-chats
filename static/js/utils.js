const SECRET_KEY = "corporate-secret-key";

export function encrypt(text) {
    if(!text) return "";
    return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
}

export function decrypt(ciphertext) {
    if(!ciphertext) return "";
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
        return bytes.toString(CryptoJS.enc.Utf8) || ciphertext;
    } catch (e) { return ciphertext; }
}

export function formatDate(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}