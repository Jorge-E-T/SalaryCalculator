/* =====================================================================
   La Casa De Los Trucos - Salary Calculator: CLOUD SYNC (Firebase)
   ---------------------------------------------------------------------
   Loaded after script.js and extras.js. Nothing in script.js changes.

   How it works
   - Every device keeps working from its own copy of the data
     (IndexedDB + localStorage, exactly as before), so the program is
     fast and keeps working without internet.
   - This file copies every change up to your Firestore database and
     brings changes made on your other devices down, live.
   - It syncs: the employee list, pay records, pictures and logins.
     Per-device settings (screen layout, "show inactive") are not synced.
   - Deleting something leaves a small "deleted" marker in the cloud so
     the delete reaches your other devices too.

   Cloud layout (Firestore, one collection per kind of data):
     employees/{id}   payRecords/{uid}   images/{id}   appUsers/{id}
   Each document: { json, deleted, at, by, label }
   ===================================================================== */

(function () {
'use strict';

const CFG = window.FIREBASE_CONFIG || null;
const COLS = ['employees', 'payRecords', 'images', 'appUsers'];
const COL_LABEL = { employees: 'employees', payRecords: 'pay records', images: 'pictures', appUsers: 'logins' };
const STATE_KEY = 'cloudSync.state.v1';
const DEVICE_KEY = 'cloudSync.deviceId';
const MAX_IMAGE_CHARS = 700000;        // Firestore documents must stay under 1 MB
const MAX_DOC_CHARS = 1000000;
const BATCH_OPS = 400;                 // Firestore allows 500 writes per batch
const BATCH_CHARS = 3000000;
const PUSH_DELAY_MS = 1200;

const configured = !!(CFG && CFG.apiKey && CFG.projectId && !/PASTE|YOUR_/i.test(CFG.apiKey + CFG.projectId));

/* ---------------------------------------------------------------------
   Small helpers
   --------------------------------------------------------------------- */
const html = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const hashStr = s => cyrb53(s).toString(36) + '.' + s.length.toString(36);

// Same data -> same text, whatever order the fields were saved in
function stable(v) {
    if (v === undefined || typeof v === 'function') return undefined;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => { const y = stable(x); return y === undefined ? null : y; });
    const o = {};
    Object.keys(v).sort().forEach(k => { const y = stable(v[k]); if (y !== undefined) o[k] = y; });
    return o;
}
const canon = v => JSON.stringify(stable(v));

function slugId(prefix, text) {
    const s = String(text ?? '');
    const readable = s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return `${prefix}-${cyrb53(s).toString(36)}${readable ? '-' + readable : ''}`;
}
const employeeId = name => slugId('e', name);
const imageId = (name, type) => slugId('i', `${name}\u0000${type}`) + '-' + String(type).replace(/[^a-z0-9]/gi, '');
const userId = username => slugId('u', username);
const newUid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const legacyUid = rec => 'r' + cyrb53(canon(rec)).toString(36);   // same old record -> same id on every device

function deviceId() {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, d); }
    return d;
}

function waitForDb() {
    return new Promise(resolve => {
        const check = () => { try { if (db) return resolve(db); } catch (e) { /* not yet */ } setTimeout(check, 100); };
        check();
    });
}

function labelFor(col, item) {
    if (!item) return '';
    if (col === 'employees') return item.name || '';
    if (col === 'payRecords') return `${item.name || ''} ${item.weekStartDate || item.date || ''}`.trim();
    if (col === 'images') return `${item.employeeName || ''} ${item.imageType || ''}`.trim();
    if (col === 'appUsers') return item.username || '';
    return '';
}

/* ---------------------------------------------------------------------
   Sync state kept on this device (per cloud account)
   shadow[col][id] = fingerprint both this device and the cloud agreed on
   cursor[col]     = time of the newest cloud change already received
   --------------------------------------------------------------------- */
let state = null;
function emptyState(account) {
    return { account, shadow: { employees: {}, payRecords: {}, images: {}, appUsers: {} }, cursor: {}, initialized: false, lastSync: null };
}
function loadState(account) {
    try {
        const s = JSON.parse(localStorage.getItem(STATE_KEY));
        if (s && s.account === account && s.shadow) { COLS.forEach(c => { s.shadow[c] = s.shadow[c] || {}; }); s.cursor = s.cursor || {}; return s; }
    } catch (e) { /* start fresh */ }
    return emptyState(account);
}
function saveState() { if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function setShadow(col, id, h) { if (h == null) delete state.shadow[col][id]; else state.shadow[col][id] = h; }

/* ---------------------------------------------------------------------
   Reading and writing THIS device's data
   --------------------------------------------------------------------- */
let applying = 0;              // >0 while cloud changes are being written locally
let origSaveEmployees = null;

function entry(item) { const json = canon(item); return { item, json, hash: hashStr(json) }; }

async function readLocal(cols = COLS) {
    await waitForDb();
    const want = new Set(cols);
    const out = {};
    const stores = (want.has('payRecords') || want.has('images') || want.has('appUsers')) ? await readAllStores() : {};

    if (want.has('employees')) {
        const m = new Map();
        getEmployees().forEach(e => m.set(employeeId(e.name), entry(e)));
        out.employees = m;
    }
    if (want.has('payRecords')) {
        const m = new Map();
        const fixes = [];
        stores.employees.forEach(r => {
            if (!r.uid) { r.uid = legacyUid(r); fixes.push(r); }
            const { id, ...item } = r;
            m.set(r.uid, entry(item));
        });
        if (fixes.length) {
            applying++;
            try {
                const tx = db.transaction(['employees'], 'readwrite');
                fixes.forEach(r => tx.objectStore('employees').put(r));
                await transactionDone(tx);
            } finally { applying--; }
        }
        out.payRecords = m;
    }
    if (want.has('images')) {
        const newest = new Map();
        stores.images.forEach(img => {
            if (!img || !img.employeeName || !img.imageType) return;
            const id = imageId(img.employeeName, img.imageType);
            const prev = newest.get(id);
            if (!prev || String(img.timestamp || '') >= String(prev.timestamp || '')) newest.set(id, img);
        });
        const m = new Map();
        newest.forEach((img, id) => { const { id: _local, ...item } = img; m.set(id, entry(item)); });
        out.images = m;
    }
    if (want.has('appUsers')) {
        const m = new Map();
        stores.users.forEach(u => { if (u && u.username) m.set(userId(u.username), entry(u)); });
        out.appUsers = m;
    }
    return out;
}

// changes: [{ id, item }]  (item null = delete)
async function applyToLocal(col, changes) {
    if (!changes.length) return;
    await waitForDb();
    applying++;
    try {
        if (col === 'employees') {
            const list = getEmployees();
            changes.forEach(({ id, item }) => {
                const i = list.findIndex(e => employeeId(e.name) === id);
                if (item) { if (i > -1) list[i] = item; else list.push(item); }
                else if (i > -1) list.splice(i, 1);
            });
            (origSaveEmployees || saveEmployees)(list);
            return;
        }
        if (col === 'payRecords') {
            const all = await getAllFromStore('employees');
            const byUid = new Map();
            all.forEach(r => { if (r.uid) { if (!byUid.has(r.uid)) byUid.set(r.uid, []); byUid.get(r.uid).push(r.id); } });
            const tx = db.transaction(['employees'], 'readwrite');
            const store = tx.objectStore('employees');
            changes.forEach(({ id, item }) => {
                const ids = byUid.get(id) || [];
                if (item) {
                    const { id: _ignore, ...clean } = item;
                    clean.uid = id;
                    if (ids.length) { store.put({ ...clean, id: ids[0] }); ids.slice(1).forEach(x => store.delete(x)); }
                    else store.add(clean);
                } else ids.forEach(x => store.delete(x));
            });
            await transactionDone(tx);
            return;
        }
        if (col === 'images') {
            const all = await getAllFromStore('images');
            const tx = db.transaction(['images'], 'readwrite');
            const store = tx.objectStore('images');
            changes.forEach(({ id, item }) => {
                all.filter(img => img.employeeName && img.imageType && imageId(img.employeeName, img.imageType) === id)
                    .forEach(img => store.delete(img.id));
                if (item) { const { id: _ignore, ...clean } = item; store.add(clean); }
            });
            await transactionDone(tx);
            return;
        }
        if (col === 'appUsers') {
            const all = await getAllFromStore('users');
            const tx = db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');
            changes.forEach(({ id, item }) => {
                if (item && item.username) store.put(item);
                else all.filter(u => userId(u.username) === id).forEach(u => store.delete(u.username));
            });
            await transactionDone(tx);
        }
    } finally {
        applying--;
    }
}

// Big photos are shrunk (here, once) so they fit in the cloud
function shrinkDataUrl(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) return resolve(null);
            let scale = Math.min(1, 1200 / Math.max(w, h)), q = 0.85, out = null;
            for (let i = 0; i < 8; i++) {
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(w * scale));
                c.height = Math.max(1, Math.round(h * scale));
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                out = c.toDataURL('image/jpeg', q);
                if (out.length <= MAX_IMAGE_CHARS) break;
                scale *= 0.8; q = Math.max(0.5, q - 0.1);
            }
            resolve(out && out.length <= MAX_IMAGE_CHARS ? out : null);
        };
        img.onerror = () => resolve(null);
        img.src = url;
    });
}
async function shrinkBigImages() {
    const big = (await getAllFromStore('images')).filter(i => typeof i.imageData === 'string' && i.imageData.length > MAX_IMAGE_CHARS);
    for (const img of big) {
        const small = await shrinkDataUrl(img.imageData);
        if (!small) continue;
        img.imageData = small;
        applying++;
        try {
            const tx = db.transaction(['images'], 'readwrite');
            tx.objectStore('images').put(img);
            await transactionDone(tx);
        } finally { applying--; }
    }
}

/* ---------------------------------------------------------------------
   The cloud (Firebase / Firestore)
   --------------------------------------------------------------------- */
let auth = null, fs = null, cloudUser = null;
const remote = {
    listen(col, sinceMillis, onDocs, onError) {
        let q = fs.collection(col);
        if (sinceMillis) q = q.where('at', '>=', firebase.firestore.Timestamp.fromMillis(sinceMillis));
        return q.onSnapshot(snap => {
            const docs = [];
            snap.docChanges().forEach(ch => {
                if (ch.type === 'removed') return;
                const d = ch.doc;
                if (d.metadata.hasPendingWrites) return;     // our own write, not confirmed yet
                const v = d.data() || {};
                docs.push({ id: d.id, deleted: !!v.deleted, json: typeof v.json === 'string' ? v.json : null, at: v.at && v.at.toMillis ? v.at.toMillis() : 0 });
            });
            onDocs(docs, !snap.metadata.fromCache);
        }, onError);
    },
    async get(col, id) {
        const d = await fs.collection(col).doc(id).get();
        if (!d.exists) return null;
        const v = d.data() || {};
        return { id, deleted: !!v.deleted, json: typeof v.json === 'string' ? v.json : null };
    },
    async write(ops, onCommitted) {
        const by = deviceId();
        const TS = () => firebase.firestore.FieldValue.serverTimestamp();
        let chunk = [], chars = 0;
        const flush = async () => {
            if (!chunk.length) return;
            const b = fs.batch();
            chunk.forEach(op => {
                const ref = fs.collection(op.col).doc(op.id);
                b.set(ref, op.json == null
                    ? { deleted: true, json: null, at: TS(), by, label: op.label || '' }
                    : { deleted: false, json: op.json, at: TS(), by, label: op.label || '' });
            });
            const done = chunk;
            chunk = []; chars = 0;
            await b.commit();
            onCommitted(done);
        };
        for (const op of ops) {
            const size = op.json ? op.json.length : 50;
            if (chunk.length && (chunk.length >= BATCH_OPS || chars + size > BATCH_CHARS)) await flush();
            chunk.push(op); chars += size;
        }
        await flush();
    }
};

/* ---------------------------------------------------------------------
   Sync engine
   --------------------------------------------------------------------- */
let listeners = [];
let ready = {};
let buffered = {};
let queue = Promise.resolve();
let pushTimer = null;
let session = 0;            // changes when the cloud account changes; stale work is dropped

function enqueue(fn) {
    const my = session;
    queue = queue.then(() => (my === session ? fn() : null)).catch(err => {
        console.error('Cloud sync error:', err);
        setStatus('error', friendlyError(err));
    });
    return queue;
}
const allReady = () => COLS.every(c => ready[c]);

function onDocs(col, docs, fromServer) {
    enqueue(async () => {
        if (!state) return;
        if (!state.initialized) {
            (buffered[col] = buffered[col] || []).push(...docs);
            if (fromServer) ready[col] = true;
            if (allReady()) await firstSync();
            return;
        }
        if (docs.length) await processIncoming(col, docs);
        if (fromServer && !ready[col]) {
            ready[col] = true;
            if (allReady()) { await pushLocal(); }
        } else if (allReady() && status !== 'syncing') {
            setStatus(navigator.onLine === false ? 'offline' : 'synced');
        }
    });
}

async function processIncoming(col, docs) {
    // newest version of each document only
    const latest = new Map();
    docs.forEach(d => { const p = latest.get(d.id); if (!p || d.at >= p.at) latest.set(d.id, d); });

    const local = (await readLocal([col]))[col];
    const changes = [];
    let maxAt = state.cursor[col] || 0;
    latest.forEach(d => {
        if (d.at > maxAt) maxAt = d.at;
        const hC = d.deleted || d.json == null ? null : hashStr(d.json);
        const L = local.get(d.id);
        const hL = L ? L.hash : null;
        const S = state.shadow[col][d.id] ?? null;
        if (hC === hL) { setShadow(col, d.id, hC); return; }
        // Cloud has nothing new (e.g. the echo of our own upload): newer local edits win, they get uploaded
        if (hC === S) return;
        // Edited here (after the last sync) but deleted elsewhere: keep the edit, it gets uploaded again
        const keepLocalEdit = hC === null && S !== null && hL !== S;
        if (keepLocalEdit) return;
        // Otherwise: unchanged here -> take the cloud version; changed on both -> the cloud wins
        let item = null;
        if (hC !== null) { try { item = JSON.parse(d.json); } catch (e) { console.warn('Bad cloud record', col, d.id); return; } }
        changes.push({ id: d.id, item });
        setShadow(col, d.id, hC);
    });
    if (changes.length) await applyToLocal(col, changes);
    state.cursor[col] = maxAt;
    saveState();
    if (changes.length) refreshUI([col], changes.length);
}

async function firstSync() {
    const local = await readLocal();
    const localCount = COLS.reduce((n, c) => n + local[c].size, 0);
    const cloudLive = {};
    COLS.forEach(c => {
        const live = new Map();
        (buffered[c] || []).forEach(d => { if (!d.deleted && d.json != null) live.set(d.id, true); else live.delete(d.id); });
        cloudLive[c] = live;
    });
    const cloudCount = COLS.reduce((n, c) => n + cloudLive[c].size, 0);
    const usersBefore = local.appUsers.size;

    let mode = 'merge';
    if (localCount && cloudCount) mode = await askFirstSync(local, cloudLive);

    if (mode === 'cloud') COLS.forEach(c => local[c].forEach((e, id) => setShadow(c, id, e.hash)));
    for (const c of COLS) if ((buffered[c] || []).length) await processIncoming(c, buffered[c]);
    if (mode === 'cloud') {
        for (const c of COLS) {
            const gone = [...local[c].keys()].filter(id => !cloudLive[c].has(id));
            gone.forEach(id => setShadow(c, id, null));
            await applyToLocal(c, gone.map(id => ({ id, item: null })));
        }
    }
    buffered = {};
    state.initialized = true;
    saveState();
    await pushLocal({ skipGuard: true });
    refreshUI(COLS);

    // New device that just received its logins: show the normal login window
    const usersAfter = (await getAllFromStore('users')).length;
    if (!usersBefore && usersAfter && !currentUser) {
        toast('☁️ Your data is here. Reloading so you can log in…', 'success');
        setTimeout(() => location.reload(), 1500);
    }
}

async function pushLocal({ skipGuard = false } = {}) {
    if (!state || !state.initialized || !allReady() || !cloudUser) return;
    await shrinkBigImages();
    const local = await readLocal();
    const ops = [];
    const deletes = {};
    COLS.forEach(col => {
        const sh = state.shadow[col];
        const ids = new Set([...local[col].keys(), ...Object.keys(sh)]);
        ids.forEach(id => {
            const L = local[col].get(id);
            const hL = L ? L.hash : null;
            if (hL === (sh[id] ?? null)) return;
            if (L && L.json.length > MAX_DOC_CHARS) { console.warn('Too big for the cloud, skipped:', col, id); return; }
            ops.push({ col, id, json: L ? L.json : null, hash: hL, label: L ? labelFor(col, L.item) : '' });
            if (!L) deletes[col] = (deletes[col] || 0) + 1;
        });
    });

    // Safety: many deletes at once (usually after a Restore) must be confirmed
    if (!skipGuard) {
        const risky = COLS.filter(c => (deletes[c] || 0) >= 5 && deletes[c] > Object.keys(state.shadow[c]).length * 0.2);
        if (risky.length) {
            const what = risky.map(c => `<b>${deletes[c]}</b> ${COL_LABEL[c]}`).join(', ');
            const yes = await choice({
                title: '⚠️ Delete from the cloud too?',
                message: `This device no longer has ${what} that are saved in the cloud. This usually happens after a <b>Restore</b> or deleting an employee with their pay records.<br><br>
                    Delete them from the cloud <b>and from all your other devices</b>?`,
                options: [['no', 'No, bring them back'], ['yes', 'Yes, delete everywhere']]
            });
            if (yes !== 'yes') {
                const back = ops.filter(op => op.json == null && risky.includes(op.col));
                await restoreFromCloud(back);
                const skip = new Set(back);
                for (let i = ops.length - 1; i >= 0; i--) if (skip.has(ops[i])) ops.splice(i, 1);
            }
        }
    }

    if (!ops.length) { markSynced(); return; }
    setStatus('syncing', `Uploading ${ops.length} change${ops.length === 1 ? '' : 's'}…`);
    await remote.write(ops, done => {
        done.forEach(op => setShadow(op.col, op.id, op.hash));
        saveState();
    });
    markSynced();
}

async function restoreFromCloud(ops) {
    const byCol = {};
    for (const op of ops) {
        const d = await remote.get(op.col, op.id);
        if (d && !d.deleted && d.json) {
            (byCol[op.col] = byCol[op.col] || []).push({ id: op.id, item: JSON.parse(d.json) });
            setShadow(op.col, op.id, hashStr(d.json));
        } else setShadow(op.col, op.id, null);
    }
    for (const c of Object.keys(byCol)) await applyToLocal(c, byCol[c]);
    saveState();
    refreshUI(Object.keys(byCol));
    if (ops.length) toast(`☁️ Brought back ${ops.length} item(s) from the cloud.`, 'info');
}

function markSynced() {
    state.lastSync = Date.now();
    saveState();
    setStatus(navigator.onLine === false ? 'offline' : 'synced');
}

function schedulePush(delay = PUSH_DELAY_MS) {
    if (!cloudUser || applying) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => enqueue(() => pushLocal()), delay);
}

function stopListeners() {
    listeners.forEach(u => { try { u(); } catch (e) { /* ignore */ } });
    listeners = [];
    ready = {};
    buffered = {};
    clearTimeout(pushTimer);
}

function startListeners() {
    stopListeners();
    session++;
    setStatus('connecting');
    COLS.forEach(col => {
        const since = state.initialized ? (state.cursor[col] || 0) : 0;
        listeners.push(remote.listen(col, since, (docs, fromServer) => onDocs(col, docs, fromServer), err => {
            console.error('Cloud listener error', col, err);
            setStatus('error', friendlyError(err));
        }));
    });
}

/* ---------------------------------------------------------------------
   Watching this device for changes
   --------------------------------------------------------------------- */
function watchLocalChanges() {
    // Any saved change to the database (pay entry, picture, login, delete, restore)
    if (window.IDBDatabase && !IDBDatabase.prototype.__cloudWrapped) {
        const orig = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
            const tx = orig.call(this, stores, mode, ...rest);
            if (mode === 'readwrite' && !applying) tx.addEventListener('complete', () => schedulePush());
            return tx;
        };
        IDBDatabase.prototype.__cloudWrapped = true;
    }
    // Employee list changes
    if (typeof window.saveEmployees === 'function' && !origSaveEmployees) {
        origSaveEmployees = window.saveEmployees;
        window.saveEmployees = function (list) {
            const r = origSaveEmployees.apply(this, arguments);
            if (!applying) schedulePush();
            return r;
        };
    }
    // New pay entries get a permanent id that is the same on every device
    if (typeof window.storeData === 'function' && !window.storeData.__cloud) {
        const origStore = window.storeData;
        window.storeData = function (data) {
            if (data && typeof data === 'object' && !data.uid) data.uid = newUid();
            return origStore.apply(this, arguments);
        };
        window.storeData.__cloud = true;
    }
    window.addEventListener('storage', e => { if (e.key === 'names') schedulePush(); });
    window.addEventListener('online', () => { setStatus('connecting'); schedulePush(500); });
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedulePush(300); });
}

function refreshUI(cols, count) {
    try {
        if (typeof refreshEmployeeDropdowns === 'function') refreshEmployeeDropdowns();
        if (typeof displayWeeklyInfo === 'function' && $('employeeSelector')) displayWeeklyInfo();
        if (cols.includes('appUsers')) {
            if (typeof loadLoginDropdown === 'function') loadLoginDropdown();
            if (currentUser && currentUser.role === 'admin' && typeof loadUsers === 'function') loadUsers();
        }
    } catch (e) { console.warn('Refresh after sync failed', e); }
    if (count) toast(`☁️ ${count} update${count === 1 ? '' : 's'} from your other devices`, 'info');
}

/* ---------------------------------------------------------------------
   Status, messages and windows
   --------------------------------------------------------------------- */
let status = configured ? 'starting' : 'off';
let statusDetail = '';
let lastToast = 0;

function toast(msg, type) {
    if (typeof showToast !== 'function') return;
    if (type === 'info' && Date.now() - lastToast < 4000) return;   // don't flood the screen
    lastToast = Date.now();
    showToast(msg, type);
}

function friendlyError(err) {
    const code = (err && (err.code || err.name)) || '';
    if (/permission-denied/.test(code)) return 'This cloud account is not allowed. Check the e-mail list in your Firestore rules.';
    if (/unavailable|network/.test(code)) return 'No connection to the cloud right now. Changes are kept on this device.';
    if (/resource-exhausted/.test(code)) return 'The free daily cloud limit was reached. Sync resumes tomorrow.';
    return (err && err.message) || String(err);
}

const STATUS_TEXT = {
    off: ['Cloud sync is not set up', 'off'],
    unavailable: ['Cloud unavailable', 'warn'],
    signedout: ['Cloud: not signed in', 'off'],
    starting: ['Cloud: starting…', 'busy'],
    connecting: ['Cloud: connecting…', 'busy'],
    syncing: ['Cloud: syncing…', 'busy'],
    synced: ['Cloud: up to date', 'ok'],
    offline: ['Offline: saving on this device', 'warn'],
    error: ['Cloud sync problem', 'bad']
};

function setStatus(s, detail = '') {
    if (navigator.onLine === false && (s === 'syncing' || s === 'connecting' || s === 'synced')) { s = 'offline'; detail = detail ? 'Waiting for internet. ' + detail : ''; }
    status = s;
    statusDetail = detail;
    const [text, kind] = STATUS_TEXT[s] || [s, 'off'];
    const pill = $('cloudPill');
    if (pill) {
        pill.hidden = s === 'off';
        pill.className = 'cloud-pill ' + kind;
        pill.textContent = (kind === 'ok' ? '☁️ ' : kind === 'bad' || kind === 'warn' ? '⚠️ ' : '☁️ ') + text.replace(/^Cloud: /, '');
        pill.title = detail || text;
    }
    renderCard();
    renderLoginExtra();
}

function canManageCloud() {
    return !currentUser || currentUser.role === 'admin';
}

function renderCard() {
    const card = $('cloudCard');
    if (!card) return;
    const [text, kind] = STATUS_TEXT[status] || [status, 'off'];
    const last = state && state.lastSync ? new Date(state.lastSync).toLocaleString() : 'never';
    let body = `<p class="cloud-status ${kind}"><b>${html(text)}</b>${statusDetail ? `<br><span>${html(statusDetail)}</span>` : ''}</p>`;
    if (status === 'off') {
        body += `<p class="field-hint">Add your Firebase settings to <code>firebase-config.js</code> (see README, "Cloud sync setup"). Until then everything stays on this device, as before.</p>`;
    } else if (status === 'unavailable') {
        body += `<p class="field-hint">The cloud program could not be downloaded (no internet?). Everything still works on this device. Reload when you're online.</p>`;
    } else if (!cloudUser) {
        body += `<p class="field-hint">Sign in with your cloud e-mail and password to keep this device in sync with your others.</p>`;
        if (canManageCloud()) body += `<button type="button" class="btn-primary" id="cloudSignInBtn">☁️ Sign in to cloud</button>`;
    } else {
        body += `<p class="field-hint">Signed in as <b>${html(cloudUser.email || '')}</b><br>Last sync: ${html(last)}</p>`;
        if (canManageCloud()) body += `<div class="form-actions cloud-actions">
            <button type="button" class="btn-secondary" id="cloudSyncNowBtn">⟳ Sync now</button>
            <button type="button" class="btn-secondary" id="cloudSignOutBtn">Sign out of cloud</button></div>`;
    }
    card.innerHTML = `<h3>☁️ Cloud Sync</h3>${body}`;
    const on = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    on('cloudSignInBtn', signInDialog);
    on('cloudSyncNowBtn', syncNow);
    on('cloudSignOutBtn', signOutDialog);
}

function renderLoginExtra() {
    const modal = $('loginModal');
    const content = modal && modal.querySelector('.modal-content');
    if (!content) return;
    let box = $('cloudLoginExtra');
    if (!configured) { if (box) box.remove(); return; }
    if (!box) {
        box = document.createElement('div');
        box.id = 'cloudLoginExtra';
        box.className = 'cloud-login-extra';
        content.appendChild(box);
    }
    if (!cloudUser) {
        box.innerHTML = `<div class="x-divider"><span>or</span></div>
            <button type="button" class="btn-primary x-wide" id="cloudLoginSignIn">☁️ Sign in to cloud sync</button>
            <p class="field-hint">On a new phone or computer: sign in to bring in your employees, pay history and logins.</p>`;
        $('cloudLoginSignIn').addEventListener('click', signInDialog);
    } else {
        const busy = !state || !state.initialized;
        box.innerHTML = `<p class="field-hint cloud-login-note">☁️ ${busy ? 'Getting your data from the cloud…' : `Cloud sync is on (${html(cloudUser.email || '')}).`}</p>`;
    }
}

function dialog({ title, message = '', fields = [], options }) {
    return new Promise(resolve => {
        const box = document.createElement('div');
        box.className = 'x-modal cloud-modal';
        box.setAttribute('role', 'dialog');
        box.innerHTML = `<div class="x-modal-content">
            <h3>${html(title)}</h3>
            ${message ? `<div class="x-message">${message}</div>` : ''}
            ${fields.map((f, i) => `<label for="cloud-f${i}">${html(f.label)}</label>
                <input id="cloud-f${i}" type="${f.type || 'text'}" autocomplete="${f.autocomplete || 'off'}" value="${html(f.value || '')}">`).join('')}
            <p class="x-error" hidden></p>
            <div class="x-actions">${options.map(([v, t], i) =>
                `<button type="button" data-v="${html(v)}" class="${i === options.length - 1 ? 'btn-primary' : 'btn-secondary'}">${html(t)}</button>`).join('')}</div>
        </div>`;
        document.body.appendChild(box);
        const inputs = [...box.querySelectorAll('input')];
        const err = box.querySelector('.x-error');
        const api = {
            error(msg) { err.textContent = msg; err.hidden = !msg; },
            close(v) { box.remove(); resolve(v); },
            values: () => inputs.map(i => i.value),
            busy(on) { box.querySelectorAll('button').forEach(b => { b.disabled = on; }); }
        };
        box.addEventListener('click', e => {
            const b = e.target.closest('button[data-v]');
            if (!b) return;
            const v = b.dataset.v;
            if (fields.length && typeof fields.onSubmit === 'function' && v === options[options.length - 1][0]) fields.onSubmit(api);
            else if (fields.length && typeof fields.onOther === 'function' && v !== 'cancel') fields.onOther(v, api);
            else api.close(fields.length ? (v === 'cancel' ? null : api.values()) : v);
        });
        inputs.forEach(i => i.addEventListener('keydown', e => {
            if (e.key === 'Enter') box.querySelector('.x-actions button:last-child').click();
        }));
        setTimeout(() => (inputs[0] || box.querySelector('.x-actions button:last-child')).focus(), 50);
    });
}
const choice = opts => dialog(opts);

function askFirstSync(local, cloudLive) {
    const cnt = (m, c) => m[c].size;
    const here = `${cnt(local, 'employees')} employees, ${cnt(local, 'payRecords')} pay records, ${cnt(local, 'appUsers')} logins`;
    const there = `${cnt(cloudLive, 'employees')} employees, ${cnt(cloudLive, 'payRecords')} pay records, ${cnt(cloudLive, 'appUsers')} logins`;
    return choice({
        title: '☁️ This device already has data',
        message: `<b>In the cloud:</b> ${html(there)}<br><b>On this device:</b> ${html(here)}<br><br>
            <b>Use the cloud data</b> (recommended if the cloud is up to date): this device is replaced with the cloud copy.<br><br>
            <b>Combine both</b>: anything only on this device is added to the cloud. Records that exist in both keep the cloud version.`,
        options: [['merge', 'Combine both'], ['cloud', 'Use the cloud data']]
    });
}

function authError(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return 'Wrong e-mail or password.';
    if (/too-many-requests/.test(c)) return 'Too many tries. Wait a few minutes and try again.';
    if (/network/.test(c)) return 'No internet connection.';
    return (e && e.message) || 'Sign-in failed.';
}

function signInDialog() {
    if (!auth) return;
    const fields = [
        { label: 'Cloud e-mail', type: 'email', autocomplete: 'username', value: localStorage.getItem('cloudSync.lastEmail') || '' },
        { label: 'Cloud password', type: 'password', autocomplete: 'current-password' }
    ];
    fields.onSubmit = async api => {
        const [email, password] = api.values().map(v => v.trim());
        if (!email || !password) return api.error('Enter the e-mail and the password.');
        api.busy(true); api.error('');
        try {
            await auth.signInWithEmailAndPassword(email, password);
            localStorage.setItem('cloudSync.lastEmail', email);
            api.close(true);
            toast('☁️ Signed in. Syncing…', 'success');
        } catch (e) { api.error(authError(e)); api.busy(false); }
    };
    fields.onOther = async (v, api) => {
        if (v !== 'reset') return;
        const email = api.values()[0].trim();
        if (!email) return api.error('Type your e-mail first, then press "Forgot password".');
        try { await auth.sendPasswordResetEmail(email); api.error(''); toast('Password reset e-mail sent to ' + email, 'info'); }
        catch (e) { api.error(authError(e)); }
    };
    dialog({
        title: '☁️ Sign in to cloud sync',
        message: 'Use the e-mail and password of the cloud account you created in Firebase (not the program login).',
        fields,
        options: [['cancel', 'Cancel'], ['reset', 'Forgot password'], ['signin', 'Sign in']]
    });
}

async function signOutDialog() {
    const v = await choice({
        title: 'Sign out of cloud sync?',
        message: 'This device stops syncing. The data already on this device stays here. You can sign in again any time.',
        options: [['cancel', 'Cancel'], ['out', 'Sign out']]
    });
    if (v !== 'out') return;
    stopListeners();
    session++;
    await auth.signOut();
}

function syncNow() {
    if (!cloudUser) return;
    if (!allReady()) { startListeners(); return; }
    setStatus('syncing');
    enqueue(() => pushLocal());
}

/* ---------------------------------------------------------------------
   Page elements
   --------------------------------------------------------------------- */
function buildUI() {
    if (!$('cloudPill')) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.id = 'cloudPill';
        pill.className = 'cloud-pill off';
        pill.hidden = true;
        pill.addEventListener('click', () => {
            if (window.salaryExtras && document.body.classList.contains('compact')) window.salaryExtras.setView('more');
            const card = $('cloudCard');
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        document.body.appendChild(pill);
    }
    if (!$('cloudCard')) {
        const card = document.createElement('div');
        card.id = 'cloudCard';
        card.className = 'card cloud-card single-spaced';
        card.setAttribute('data-view', 'more');
        const footer = document.querySelector('footer');
        if (footer) footer.parentNode.insertBefore(card, footer.nextSibling);
        else document.body.appendChild(card);
    }
    setStatus(status);
}

/* ---------------------------------------------------------------------
   Start
   --------------------------------------------------------------------- */
function start() {
    watchLocalChanges();
    buildUI();
    if (typeof window.initializeRoleBasedUI === 'function') {
        const orig = window.initializeRoleBasedUI;
        window.initializeRoleBasedUI = function () { const r = orig.apply(this, arguments); try { renderCard(); renderLoginExtra(); } catch (e) { /* ignore */ } return r; };
    }
    if (!configured) { setStatus('off'); return; }
    if (typeof firebase === 'undefined' || !firebase.initializeApp) { setStatus('unavailable'); return; }

    try {
        const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(CFG);
        auth = app.auth ? app.auth() : firebase.auth();
        fs = firebase.firestore();
        try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) { /* already set */ }
        try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) { /* default is local */ }
    } catch (e) {
        console.error(e);
        setStatus('error', 'Firebase settings look wrong: ' + (e.message || e));
        return;
    }

    auth.onAuthStateChanged(async user => {
        stopListeners();
        session++;
        cloudUser = user;
        if (!user) { state = null; setStatus('signedout'); return; }
        await waitForDb();
        state = loadState(`${CFG.projectId}/${user.uid}`);
        startListeners();
    });
}

document.addEventListener('DOMContentLoaded', start);

// For tests and troubleshooting
window.cloudSync = {
    get status() { return status; },
    get state() { return state; },
    syncNow,
    whenIdle: () => queue,
    _internals: { canon, hashStr, employeeId, imageId, userId, legacyUid }
};
})();
