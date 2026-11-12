/* =====================================================================
   La Casa De Los Trucos - Salary Calculator: EXTRAS
   ---------------------------------------------------------------------
   Loaded after script.js. Adds, without changing how your data is stored:
     1. Encrypted (password-protected) backups - safe to keep on GitHub
     2. "Load encrypted backup from website" - for the r1, which can't pick files
     3. First-time setup on a new device (create the admin password)
     4. r1 compact layout: one section at a time + bottom tab bar
     5. r1 speech to text: HOLD the side button, speak, let go
     6. r1 scroll wheel + short side-button press (= next field)
   ===================================================================== */

(function () {
'use strict';

const WEBSITE_BACKUP_FILE = 'backup.enc.json';
const LAYOUT_KEY = 'salaryLayout';            // 'auto' | 'desktop' | 'compact'
const COMPACT_MAX_WIDTH = 480;
const isR1 = () => typeof CreationVoiceHandler !== 'undefined' || typeof PluginMessageHandler !== 'undefined';

/* ---------------------------------------------------------------------
   Small UI helpers: a password / message window that works on the r1
   (the r1 may not show the browser's own alert / confirm / prompt boxes)
   --------------------------------------------------------------------- */
function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

function openDialog({ title, message = '', fields = [], okText = 'OK', cancelText = 'Cancel', danger = false }) {
    return new Promise(resolve => {
        const box = el(`
            <div class="x-modal" role="dialog" aria-modal="true">
                <div class="x-modal-content">
                    <h3>${esc(title)}</h3>
                    ${message ? `<div class="x-message">${message}</div>` : ''}
                    ${fields.map((f, i) => `
                        <label for="x-f${i}">${esc(f.label)}</label>
                        <input id="x-f${i}" type="${f.type || 'password'}" autocomplete="${f.type === 'password' || !f.type ? 'new-password' : 'off'}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`).join('')}
                    <p class="x-error" hidden></p>
                    <div class="x-actions">
                        ${cancelText ? `<button type="button" class="btn-secondary x-cancel">${esc(cancelText)}</button>` : ''}
                        <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'} x-ok">${esc(okText)}</button>
                    </div>
                </div>
            </div>`);
        document.body.appendChild(box);
        const inputs = [...box.querySelectorAll('input')];
        const err = box.querySelector('.x-error');
        const close = val => { box.remove(); resolve(val); };
        const submit = () => {
            const values = inputs.map(i => i.value);
            for (let i = 0; i < fields.length; i++) {
                const msg = fields[i].validate ? fields[i].validate(values[i], values) : '';
                if (msg) { err.textContent = msg; err.hidden = false; inputs[i].focus(); return; }
            }
            close(fields.length ? values : true);
        };
        box.querySelector('.x-ok').addEventListener('click', submit);
        const c = box.querySelector('.x-cancel');
        if (c) c.addEventListener('click', () => close(null));
        inputs.forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
        setTimeout(() => (inputs[0] || box.querySelector('.x-ok')).focus(), 50);
    });
}

/* ---------------------------------------------------------------------
   1. Encrypted backups (AES-256-GCM, key made from your password with PBKDF2)
   --------------------------------------------------------------------- */
const ENC_FORMAT = 'LaCasa-encrypted-backup-v1';
const PBKDF2_ROUNDS = 250000;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
function bytesToB64(bytes) {           // large files: convert in chunks
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

function cryptoAvailable() {
    return !!(window.crypto && crypto.subtle);
}

async function keyFromPassword(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptText(text, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFromPassword(password, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return JSON.stringify({
        format: ENC_FORMAT, app: APP_ID, encrypted: true,
        createdAt: new Date().toISOString(),
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ROUNDS, salt: b64(salt) },
        cipher: { name: 'AES-GCM', iv: b64(iv) },
        data: bytesToB64(new Uint8Array(data))
    });
}

async function decryptText(wrapper, password) {
    const salt = unb64(wrapper.kdf.salt);
    const iv = unb64(wrapper.cipher.iv);
    const key = await keyFromPassword(password, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, unb64(wrapper.data));
    return new TextDecoder().decode(plain);
}

function isEncryptedWrapper(obj) {
    return obj && obj.format === ENC_FORMAT && obj.encrypted === true && obj.data;
}

// Used by script.js "Restore": returns plain text, or null if cancelled
window.unlockIfEncrypted = async function (text) {
    let obj = null;
    try { obj = JSON.parse(text); } catch (e) { return text; }
    if (!isEncryptedWrapper(obj)) return text;
    return askPasswordAndDecrypt(obj);
};

async function askPasswordAndDecrypt(wrapper) {
    if (!cryptoAvailable()) throw new Error('This browser cannot open encrypted backups here. Open the program from its https:// website address.');
    const when = wrapper.createdAt ? new Date(wrapper.createdAt).toLocaleString() : '';
    for (let tries = 0; tries < 5; tries++) {
        const res = await openDialog({
            title: '🔒 Encrypted backup',
            message: `Enter the backup password${when ? ` (backup made ${esc(when)})` : ''}.`,
            fields: [{ label: 'Backup password', validate: v => v ? '' : 'Enter the password' }],
            okText: 'Unlock'
        });
        if (!res) return null;
        try {
            showGlobalLoading('Unlocking backup...');
            return await decryptText(wrapper, res[0]);
        } catch (e) {
            showToast('Wrong password. Try again.', 'error');
        } finally {
            hideGlobalLoading();
        }
    }
    return null;
}

async function exportEncryptedBackup() {
    if (!cryptoAvailable()) {
        alert('Encrypted backups need the program to be opened from its https:// website address, or in Chrome / Edge.');
        return;
    }
    const res = await openDialog({
        title: '🔒 Encrypted backup',
        message: 'Choose a password for this backup. You need it to open the backup on the r1 or another computer. <b>Write it down</b>: without it the backup cannot be opened by anyone, not even you.',
        fields: [
            { label: 'Backup password (at least 8 characters)', validate: v => v.length >= 8 ? '' : 'Use at least 8 characters' },
            { label: 'Type it again', validate: (v, all) => v === all[0] ? '' : 'The two passwords are not the same' }
        ],
        okText: 'Save encrypted backup'
    });
    if (!res) return;
    showGlobalLoading('Encrypting backup...');
    try {
        const backup = await buildBackupObject();
        const enc = await encryptText(JSON.stringify(backup), res[0]);
        downloadBlob(new Blob([enc], { type: 'application/json' }), WEBSITE_BACKUP_FILE);
        localStorage.setItem('lastBackupDate', new Date().toISOString());
        checkBackupReminder();
        const c = backup.counts;
        showToast(`🔒 Encrypted backup saved as ${WEBSITE_BACKUP_FILE}: ${c.employees} employees, ${c.payRecords} pay records.`, 'success');
    } catch (e) {
        console.error(e);
        showToast('Encrypted backup failed: ' + (e.message || e), 'error');
    } finally {
        hideGlobalLoading();
    }
}

/* ---------------------------------------------------------------------
   2. Load the encrypted backup from the website (no file picker needed)
   --------------------------------------------------------------------- */
async function loadBackupFromWebsite() {
    let wrapper;
    try {
        showGlobalLoading('Downloading backup...');
        const res = await fetch(WEBSITE_BACKUP_FILE + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error(`${WEBSITE_BACKUP_FILE} was not found next to this page.`);
        wrapper = await res.json();
    } catch (e) {
        hideGlobalLoading();
        showToast(e.message || 'Could not download the backup.', 'error');
        return;
    }
    hideGlobalLoading();
    if (!isEncryptedWrapper(wrapper)) {
        showToast('For safety, only encrypted backups can be loaded from the website.', 'error');
        return;
    }
    let backup;
    try {
        const text = await askPasswordAndDecrypt(wrapper);
        if (text === null) return;
        backup = parseBackup(text);
    } catch (e) {
        showToast(e.message || 'The backup could not be read.', 'error');
        return;
    }
    const when = backup.timestamp ? new Date(backup.timestamp).toLocaleString() : 'unknown date';
    const ok = await openDialog({
        title: 'Restore this backup?',
        message: `Backup from <b>${esc(when)}</b>:<br>
            • ${backup.names ? backup.names.length : 0} employees<br>
            • ${backup.payRecords.length} pay records<br>
            • ${backup.images.length} pictures<br>
            • ${backup.users.length} logins<br><br>
            ⚠️ This <b>replaces</b> all the data on this device.`,
        okText: 'Restore', danger: true
    });
    if (!ok) return;
    // Devices that can't download files (the r1) skip the safety copy
    await applyRestore(backup, { safetyCopy: !isR1() });
}

/* ---------------------------------------------------------------------
   3. First-time setup on a new device (no logins yet)
   --------------------------------------------------------------------- */
async function userCount() {
    try { return (await getAllFromStore('users')).length; } catch (e) { return 0; }
}

async function decorateLoginModal() {
    const modal = $('loginModal');
    if (!modal) return;
    const content = modal.querySelector('.modal-content');
    if (!content || content.querySelector('.x-login-extra')) return;

    const extra = el(`
        <div class="x-login-extra">
            <div class="x-divider"><span>or</span></div>
            <button type="button" class="btn-secondary x-wide" id="xLoadWebsiteLogin">🔒 Load encrypted backup from website</button>
        </div>`);
    content.appendChild(extra);
    $('xLoadWebsiteLogin').addEventListener('click', loadBackupFromWebsite);

    if (await userCount() === 0) {
        // Brand-new device: create the admin login instead of logging in
        content.querySelectorAll('label, #loginUserSelect, #loginPassword, #loginSubmit, #loginError').forEach(n => n.style.display = 'none');
        const h = content.querySelector('h3');
        if (h) h.textContent = 'Welcome! First-time setup';
        const setup = el(`
            <div class="x-setup">
                <p class="field-hint">This device has no logins yet. If you use the program on another computer, load your encrypted backup below. Otherwise create the admin password now.</p>
                <label for="xAdminPass">New admin password (at least 8 characters)</label>
                <input type="password" id="xAdminPass" autocomplete="new-password">
                <label for="xAdminPass2">Type it again</label>
                <input type="password" id="xAdminPass2" autocomplete="new-password">
                <p class="x-error" id="xSetupError" hidden></p>
                <button type="button" class="btn-primary x-wide" id="xCreateAdmin">Create admin and start</button>
            </div>`);
        content.insertBefore(setup, extra);
        $('xCreateAdmin').addEventListener('click', async () => {
            const p1 = $('xAdminPass').value, p2 = $('xAdminPass2').value, err = $('xSetupError');
            if (p1.length < 8) { err.textContent = 'Use at least 8 characters.'; err.hidden = false; return; }
            if (p1 !== p2) { err.textContent = 'The two passwords are not the same.'; err.hidden = false; return; }
            const tx = db.transaction(['users'], 'readwrite');
            tx.objectStore('users').put({ username: 'admin', password: p1, role: 'admin' });
            await transactionDone(tx);
            currentUser = { username: 'admin', role: 'admin' };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            showToast('Admin login created. Welcome!', 'success');
            setTimeout(() => location.reload(), 900);
        });
    }
}

/* ---------------------------------------------------------------------
   Extra buttons in the backup area (admins only, like Backup / Restore)
   --------------------------------------------------------------------- */
function addBackupButtons() {
    const area = document.querySelector('.backup-actions');
    if (!area || $('xEncBackupButton')) return;
    const encBtn = el(`<button type="button" id="xEncBackupButton" class="btn-secondary">🔒 Encrypted Backup</button>`);
    const webBtn = el(`<button type="button" id="xLoadWebsiteButton" class="btn-secondary">🌐 Load from Website</button>`);
    const status = $('backupStatus');
    area.insertBefore(encBtn, status);
    area.insertBefore(webBtn, status);
    encBtn.addEventListener('click', exportEncryptedBackup);
    webBtn.addEventListener('click', loadBackupFromWebsite);

    // Screen layout choice (desktop / r1)
    const layout = el(`
        <div class="x-layout">
            <label for="xLayoutSelect">Screen layout:</label>
            <select id="xLayoutSelect">
                <option value="auto">Automatic</option>
                <option value="desktop">Desktop</option>
                <option value="compact">r1 compact</option>
            </select>
        </div>`);
    area.appendChild(layout);
    const sel = $('xLayoutSelect');
    sel.value = localStorage.getItem(LAYOUT_KEY) || 'auto';
    sel.addEventListener('change', () => {
        localStorage.setItem(LAYOUT_KEY, sel.value);
        applyLayout();
        showToast(`Screen layout: ${sel.options[sel.selectedIndex].text}`, 'info');
    });
}

function syncAdminButtons() {
    const show = $('backupDataButton') ? $('backupDataButton').style.display !== 'none' : true;
    ['xEncBackupButton', 'xLoadWebsiteButton'].forEach(id => { const b = $(id); if (b) b.style.display = show ? '' : 'none'; });
}

/* ---------------------------------------------------------------------
   4. r1 compact layout
   --------------------------------------------------------------------- */
const VIEWS = [
    ['pay', 'Pay'],
    ['results', 'Results'],
    ['people', 'People'],
    ['reports', 'Reports'],
    ['more', 'More']
];
let currentView = 'pay';

function tagSections() {
    const tag = (sel, view) => document.querySelectorAll(sel).forEach(n => n.setAttribute('data-view', view));
    tag('.calculator-card', 'pay');
    tag('#results', 'results');
    tag('#weeklyInfoSection', 'people');
    tag('.employee-card', 'people');
    tag('.accounting-section', 'reports');
    tag('.ytd-section', 'reports');
    tag('footer', 'more');
}

function buildNav() {
    if ($('xNav')) return;
    const nav = el(`<nav id="xNav" aria-label="Sections">${VIEWS.map(([v, t]) =>
        `<button type="button" data-go="${v}">${t}</button>`).join('')}</nav>`);
    document.body.appendChild(nav);
    nav.addEventListener('click', e => {
        const b = e.target.closest('button[data-go]');
        if (b) setView(b.dataset.go);
    });
}

function wantCompact() {
    const mode = localStorage.getItem(LAYOUT_KEY) || 'auto';
    if (mode === 'compact') return true;
    if (mode === 'desktop') return false;
    return isR1() || window.innerWidth <= COMPACT_MAX_WIDTH;
}

function applyLayout() {
    const on = wantCompact();
    document.body.classList.toggle('compact', on);
    if (on) setView(currentView);
}

function scroller() {
    return document.querySelector('.container');
}

function setView(view) {
    currentView = view;
    document.body.dataset.cv = view;
    document.querySelectorAll('#xNav button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
    const s = scroller();
    if (s) s.scrollTop = 0;
}

window.addEventListener('resize', () => {
    if ((localStorage.getItem(LAYOUT_KEY) || 'auto') === 'auto') applyLayout();
});

/* ---------------------------------------------------------------------
   5. r1 speech to text
   HOLD the side button -> 'longPressStart' -> CreationVoiceHandler 'start'
   LET GO               -> 'longPressEnd'   -> CreationVoiceHandler 'stop'
   The words arrive in window.onPluginMessage as type 'sttEnded' with a transcript.
   The words go into the field you tapped last. On the Pay screen with nothing
   selected, saying a name picks that employee.
   --------------------------------------------------------------------- */
let voiceTarget = null;
let voiceWaiting = false;
let voiceTimer = null;
let lastPressEnd = 0;
let lastField = null;
let otherHandler = null;

document.addEventListener('focusin', e => {
    if (e.target.matches && e.target.matches('input, select, textarea')) lastField = e.target;
});

function statusPill() {
    let p = $('xVoice');
    if (!p) { p = el(`<div id="xVoice" class="x-voice" role="status" aria-live="polite"></div>`); document.body.appendChild(p); }
    return p;
}
function voiceStatus(text, kind = 'listening', hideAfter = 0) {
    const p = statusPill();
    p.textContent = text;
    p.className = 'x-voice show ' + kind;
    if (hideAfter) setTimeout(() => { if (!voiceWaiting) p.className = 'x-voice'; }, hideAfter);
}

function visible(node) {
    return node && node.offsetParent !== null && !node.disabled;
}

function chooseVoiceTarget() {
    const active = document.activeElement;
    const ok = n => n && n.matches && n.matches('input, select, textarea') && visible(n) && n.type !== 'file';
    if (ok(active)) return active;
    if (ok(lastField)) return lastField;
    if (currentView === 'pay' && ok($('name'))) return $('name');
    if (currentView === 'people' && ok($('employeeSelector'))) return $('employeeSelector');
    return null;
}

const NUMBER_WORDS = {
    zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
    // Spanish
    cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60
};

// "8.5", "eight and a half", "forty", "12 dollars 50" -> number (or NaN)
// money = true: "fifteen fifty" -> 15.50 (two numbers said together = dollars and cents)
function spokenNumber(text, money = false) {
    let t = String(text || '').toLowerCase().replace(/[$,]/g, '').replace(/-/g, ' ').trim();
    const digits = t.match(/-?\d+(?:\.\d+)?/g);
    if (digits && digits.length) {
        let n = parseFloat(digits[0]);
        if ((money || /\b(dollars?|d[oó]lares)\b/.test(t)) && digits[1] && !digits[0].includes('.') && parseFloat(digits[1]) < 100) n += parseFloat(digits[1]) / 100;
        if (/and a half|y media/.test(t)) n += 0.5;
        if (/and a quarter|y cuarto/.test(t)) n += 0.25;
        return n;
    }
    const words = t.split(/\s+/);
    let total = 0, current = 0, found = false, decimal = null;
    const groups = [];                       // separate numbers said one after another
    let lastWasSmall = false;
    for (const w of words) {
        if (w === 'point' || w === 'punto') { decimal = ''; continue; }
        if (w in NUMBER_WORDS) {
            found = true;
            const v = NUMBER_WORDS[w];
            if (decimal !== null) { decimal += String(v); continue; }
            // "fifteen fifty": a tens word after a finished number starts a new number
            const finished = current > 0 && (current % 10 !== 0 || current < 20 || v >= 10);
            const afterHundred = current >= 100 && current % 100 === 0 && v < 100;   // "one hundred twenty"
            const tensThenUnit = current >= 20 && current % 10 === 0 && current % 100 !== 0 && v < 10;   // "forty two"
            if (finished && !afterHundred && !tensThenUnit) {
                groups.push(total + current); total = 0; current = 0;
            }
            current += v;
        } else if (w === 'hundred' || w === 'cien' || w === 'cientos') { current = (current || 1) * 100; found = true; }
        else if (w === 'thousand' || w === 'mil') { total += (current || 1) * 1000; current = 0; found = true; }
    }
    if (!found) return NaN;
    groups.push(total + current);
    if (groups.length > 1) {
        // money: dollars and cents; otherwise read the digits in order ("one five" -> 15)
        if (money && groups.length === 2 && groups[1] < 100) return groups[0] + groups[1] / 100;
        return parseFloat(groups.join(''));
    }
    let n = groups[0];
    if (decimal) n = parseFloat(n + '.' + decimal);
    if (/and a half|y media/.test(t)) n += 0.5;
    return n;
}

// "november 10", "11/10/2026", "10 de noviembre" -> YYYY-MM-DD
function spokenDate(text) {
    const t = String(text || '').toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/[.,]/g, ' ').trim();
    const es = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    const en = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
    const now = new Date();
    let m = t.match(/^(\d{1,2})[\/\s-](\d{1,2})(?:[\/\s-](\d{2,4}))?$/);
    let y, mo, d;
    if (m) { mo = +m[1]; d = +m[2]; y = m[3] ? +m[3] : now.getFullYear(); }
    else {
        const parts = t.split(/\s+/);
        for (const p of parts) { if (en[p]) mo = en[p]; if (es[p]) mo = es[p]; }
        const nums = (t.match(/\d+/g) || []).map(Number);
        d = nums.find(n => n >= 1 && n <= 31);
        y = nums.find(n => n > 31) || now.getFullYear();
        if (/\btoday\b|\bhoy\b/.test(t)) { y = now.getFullYear(); mo = now.getMonth() + 1; d = now.getDate(); }
    }
    if (y < 100) y += 2000;
    if (!mo || !d) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${y}-${pad(mo)}-${pad(d)}`;
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function pickOption(select, spoken) {
    const said = norm(spoken).split(' ').filter(Boolean);
    if (!said.length) return false;
    let best = null, bestScore = 0;
    [...select.options].forEach(o => {
        if (!o.value) return;
        const words = norm(o.text).split(' ');
        let score = 0;
        said.forEach(w => { if (words.some(x => x === w)) score += 2; else if (words.some(x => x.startsWith(w) || w.startsWith(x))) score += 1; });
        if (score > bestScore) { bestScore = score; best = o; }
    });
    if (!best) return false;
    select.value = best.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return best.text;
}

function fire(node) {
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
}

function putWords(text) {
    voiceWaiting = false;
    clearTimeout(voiceTimer);
    let words = String(text || '').trim();
    const target = voiceTarget && document.body.contains(voiceTarget) ? voiceTarget : null;
    voiceTarget = null;
    if (!words) { voiceStatus("Didn't catch that. Try again.", 'error', 2500); return; }
    if (!target) { voiceStatus('Tap a box first, then hold the button and speak.', 'error', 3000); return; }

    const type = (target.type || '').toLowerCase();
    const plain = words.replace(/[.!?]+$/, '');

    if (target.tagName === 'SELECT') {
        const picked = pickOption(target, plain);
        voiceStatus(picked ? `Picked: ${picked}` : `No match for "${plain}"`, picked ? 'done' : 'error', 2500);
        return;
    }
    if (type === 'password') { voiceStatus('Passwords must be typed.', 'error', 2500); return; }
    if (type === 'checkbox') {
        const yes = /\b(yes|si|sí|on|check|true)\b/i.test(plain), no = /\b(no|off|uncheck|false)\b/i.test(plain);
        if (yes || no) { target.checked = yes; fire(target); voiceStatus(yes ? 'Checked' : 'Unchecked', 'done', 2000); }
        return;
    }
    if (type === 'number') {
        // "8 hours 30 minutes" in a Hours box fills Minutes too
        const hm = plain.toLowerCase().match(/(.+?)\s*(hours?|horas?)\s*(?:and|y)?\s*(.+?)\s*(minutes?|minutos?)/);
        if (hm && /^hours\d+$/.test(target.id)) {
            const h = spokenNumber(hm[1]), mi = spokenNumber(hm[3]);
            const minBox = $(target.id.replace('hours', 'minutes'));
            if (!isNaN(h)) { target.value = Math.floor(h); fire(target); }
            if (minBox && !isNaN(mi)) { minBox.value = Math.round(mi); fire(minBox); }
            voiceStatus(`${Math.floor(h)} h ${Math.round(mi)} min`, 'done', 2500);
            return;
        }
        const isMoney = /rate|bonus|deduction/i.test(target.id) || target.step === '0.01';
        const n = spokenNumber(plain, isMoney);
        if (isNaN(n)) { voiceStatus(`Not a number: "${plain}"`, 'error', 2500); return; }
        target.value = String(Math.round(n * 100) / 100);
        fire(target);
        voiceStatus(`Entered ${target.value}`, 'done', 2000);
        return;
    }
    if (type === 'date') {
        const d = spokenDate(plain);
        if (!d) { voiceStatus(`Not a date: "${plain}"`, 'error', 2500); return; }
        target.value = d;
        fire(target);
        voiceStatus(`Date: ${target.value}`, 'done', 2500);
        return;
    }
    if (type === 'email') {
        words = plain.toLowerCase().replace(/\s+at\s+|\s+arroba\s+/g, '@').replace(/\s+dot\s+|\s+punto\s+/g, '.').replace(/\s+/g, '');
    } else if (type === 'tel') {
        words = plain.replace(/[^\d]/g, '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
    } else if (target.tagName !== 'TEXTAREA') {
        words = plain;
    }
    const start = target.selectionStart != null ? target.selectionStart : target.value.length;
    const end = target.selectionEnd != null ? target.selectionEnd : target.value.length;
    const before = target.value.slice(0, start), after = target.value.slice(end);
    const space = before && !/\s$/.test(before) && type !== 'email' && type !== 'tel' ? ' ' : '';
    target.value = before + space + words + after;
    try { const pos = (before + space + words).length; target.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ }
    fire(target);
    voiceStatus(`Typed: "${words}"`, 'done', 2500);
}

function handlePluginMessage(data) {
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = { message: data }; } }
    if (!data) return;
    let type = data.type, transcript = data.transcript;
    if (!transcript && data.data) {
        let inner = data.data;
        if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch (e) { inner = null; } }
        if (inner && typeof inner === 'object') { transcript = inner.transcript || transcript; type = type || inner.type; }
    }
    if (type === 'sttEnded' && voiceWaiting) putWords(transcript);
}
function combined(data) {
    try { handlePluginMessage(data); } catch (e) { console.warn('Voice error', e); }
    if (otherHandler) { try { otherHandler(data); } catch (e) { /* ignore */ } }
}
function ensureHandler() {
    if (window.onPluginMessage === combined) return;
    otherHandler = typeof window.onPluginMessage === 'function' ? window.onPluginMessage : null;
    window.onPluginMessage = combined;
}
ensureHandler();

function r1Send(cmd) {
    if (typeof CreationVoiceHandler === 'undefined') return false;
    try { CreationVoiceHandler.postMessage(cmd); return true; } catch (e) { return false; }
}

window.addEventListener('longPressStart', () => {
    ensureHandler();
    voiceTarget = chooseVoiceTarget();
    if (!voiceTarget) { voiceStatus('Tap a box first, then hold the button and speak.', 'error', 3000); return; }
    if (!r1Send('start')) return;
    voiceWaiting = true;
    const label = voiceTarget.id === 'name' ? 'say the employee name' : 'speak now';
    voiceStatus(`Listening… ${label}`);
});
window.addEventListener('longPressEnd', () => {
    lastPressEnd = Date.now();
    if (!voiceWaiting) return;
    r1Send('stop');
    voiceStatus('Getting your words…', 'working');
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(() => {
        if (!voiceWaiting) return;
        voiceWaiting = false;
        voiceStatus("Didn't hear anything. Try again.", 'error', 2500);
    }, 12000);
});

/* ---------------------------------------------------------------------
   6. r1 scroll wheel and short side-button press
   --------------------------------------------------------------------- */
function openModalScroller() {
    const xs = document.querySelector('.x-modal .x-modal-content');
    if (xs) return xs;
    const stub = $('payStubModal');
    if (stub && stub.style.display !== 'none' && getComputedStyle(stub).display !== 'none') return stub.querySelector('.paystub-modal-content');
    const login = $('loginModal');
    if (login && getComputedStyle(login).display !== 'none') return login;
    return null;
}
function wheel(amount) {
    const box = openModalScroller() || (document.body.classList.contains('compact') ? scroller() : null);
    if (box) box.scrollTop += amount; else window.scrollBy(0, amount);
}
window.addEventListener('scrollUp', () => wheel(-60));
window.addEventListener('scrollDown', () => wheel(60));

// Short press = go to the next box on this screen (handy after speaking into one)
let lastSide = 0;
window.addEventListener('sideClick', () => {
    const now = Date.now();
    if (now - lastSide < 350 || now - lastPressEnd < 900) return;     // ignore repeats and the end of a hold
    lastSide = now;
    const root = openModalScroller() || document.querySelector(`[data-view="${currentView}"]`) || document;
    const fields = [...root.querySelectorAll('input, select, textarea')].filter(n => visible(n) && n.type !== 'file' && n.type !== 'hidden');
    if (!fields.length) return;
    const i = fields.indexOf(document.activeElement);
    const next = fields[(i + 1) % fields.length];
    next.focus();
    lastField = next;
    next.scrollIntoView({ block: 'center' });
    voiceStatus(`Next: ${(next.labels && next.labels[0] ? next.labels[0].textContent : next.placeholder || next.id).replace(/\s+/g, ' ').trim()}`, 'working', 1500);
});

/* ---------------------------------------------------------------------
   On the r1 the browser's own pop-up messages may not appear:
   show alerts as on-screen messages instead
   --------------------------------------------------------------------- */
function useOnScreenAlerts() {
    if (!isR1()) return;
    window.alert = msg => showToast(String(msg), /❌|fail|error|invalid|please/i.test(String(msg)) ? 'error' : 'info');
}

/* ---------------------------------------------------------------------
   Hook into script.js
   --------------------------------------------------------------------- */
function hook(name, after) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function () {
        const r = original.apply(this, arguments);
        try { after.apply(this, arguments); } catch (e) { console.warn(e); }
        return r;
    };
}

document.addEventListener('DOMContentLoaded', () => {
    useOnScreenAlerts();
    tagSections();
    buildNav();
    addBackupButtons();
    applyLayout();
    // After Calculate, show the result on the r1
    hook('displayResults', () => { if (document.body.classList.contains('compact')) setView('results'); });
    hook('initializeRoleBasedUI', () => { syncAdminButtons(); decorateLoginModal(); });
    // script.js finishes starting up asynchronously; decorate the login window once it's ready
    const wait = setInterval(() => {
        if (db) { clearInterval(wait); decorateLoginModal(); syncAdminButtons(); }
    }, 200);
    setTimeout(() => clearInterval(wait), 15000);
});

// For tests and other scripts
window.salaryExtras = { setView, applyLayout, spokenNumber, spokenDate, exportEncryptedBackup, loadBackupFromWebsite, encryptText, decryptText };
})();
