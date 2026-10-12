/* ============================================================
   cloud.js — email/password login + Firestore sync

   The local IndexedDB stays the main store (instant, works offline).
   Every local write is also queued for the cloud; changes made on
   other devices are pulled in and applied locally. Newest edit wins
   (per note / task / folder ...), deletes travel as small tombstones.

   If firebase-config.js is not filled in, everything here stays
   switched off and the app runs exactly as before (local only).
   ============================================================ */
window.Cloud = (function(){
  const SYNC_STORES = ['notes','folders','tasks','slots','activity','checklist','settings'];
  const META_KEY    = '__cloud_meta';   // lives in the local settings store, never synced
  const MAX_JSON    = 900000;           // Firestore document limit is 1 MiB
  const SLACK_MS    = 120000;           // re-read a little before the last cursor, to be safe
  const CHUNK       = 200;

  const cfg = window.FIREBASE_CONFIG || {};
  const filled = !!(cfg.apiKey && !/^PASTE/i.test(cfg.apiKey) && cfg.projectId && !/^PASTE/i.test(cfg.projectId));
  const libOk  = !!(window.firebase && firebase.auth && firebase.firestore);
  const enabled = filled && libOk;

  let auth = null, fs = null, col = null, user = null, unsub = null;
  let meta = { uid:null, lastSync:0, init:false };
  let dirty = {};              // "store|id" -> { op:'p'|'d', u:timestamp }
  let remoteU = {};            // "store|id" -> newest _u seen from the cloud
  let oversize = {};           // "store|id" -> title of a record too big to sync
  let serverSynced = false;
  let flushing = false, flushTimer = null, persistTimer = null, lastU = 0;
  let lastError = '';
  let chain = Promise.resolve();
  let firstSyncResolve = null;
  let remoteCb = () => {};
  const statusCbs = [];

  const keyOf  = (s, id) => s + '|' + id;
  const splitK = (k) => { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; };
  const docId  = (s, id) => s + '~' + encodeURIComponent(String(id));
  const idOf   = (s, rec) => (s === 'settings' ? rec.key : rec.id);
  const delay  = (ms) => new Promise(r => setTimeout(r, ms));
  const syncable = (s, rec) => !(s === 'settings' && String(rec.key).startsWith('__'));

  /* ---------- small helpers used by the DB layer ---------- */
  function stamp(rec){
    if(!enabled || !rec) return rec;
    lastU = Math.max(Date.now(), lastU + 1);
    rec._u = lastU;
    return rec;
  }
  function wrote(store, rec){
    if(!enabled || !user || !rec || !syncable(store, rec)) return;
    const id = idOf(store, rec); if(id == null) return;
    dirty[keyOf(store, id)] = { op:'p', u: rec._u || Date.now() };
    persistSoon(); scheduleFlush(2000); emit();
  }
  function deleted(store, id){
    if(!enabled || !user) return;
    lastU = Math.max(Date.now(), lastU + 1);
    dirty[keyOf(store, id)] = { op:'d', u: lastU };
    persistSoon(); scheduleFlush(2000); emit();
  }

  /* ---------- status ---------- */
  function status(){
    const pending = Object.keys(dirty).length;
    let state;
    if(!filled) state = 'local';
    else if(!libOk) state = 'error';
    else if(lastError) state = 'error';
    else if(navigator.onLine === false) state = 'offline';
    else if(!serverSynced) state = 'connecting';
    else if(flushing || pending) state = 'syncing';
    else state = 'synced';
    return {
      state, pending,
      email: user ? user.email : '',
      error: !libOk && filled ? 'Firebase library did not load' : lastError,
      oversize: Object.values(oversize)
    };
  }
  function emit(){ const s = status(); statusCbs.forEach(f => { try{ f(s); }catch(e){} }); }

  /* ---------- local meta (cursor + unsent changes) ---------- */
  async function loadMeta(){
    const row = await DB.rawGet('settings', META_KEY);
    if(row && row.value){
      meta  = Object.assign({ uid:null, lastSync:0, init:false }, row.value.meta || {});
      dirty = row.value.dirty || {};
    }
  }
  function persistSoon(){
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 60);
  }
  function persistNow(){
    clearTimeout(persistTimer);
    return DB.rawPut('settings', { key:META_KEY, value:{ meta, dirty } }).catch(() => {});
  }

  /* ---------- applying changes that arrive from the cloud ---------- */
  async function applyRemote(v){
    const store = v.store, id = v.id, k = keyOf(store, id), ru = v._u || 0;
    if(SYNC_STORES.indexOf(store) < 0) return null;
    remoteU[k] = Math.max(remoteU[k] || 0, ru);
    const local = await DB.rawGet(store, id);
    const dk = dirty[k];
    const lu = local ? (local._u || 0) : (dk && dk.op === 'd' ? dk.u : 0);
    if(ru <= lu) return null;                       // ours is as new or newer
    if(v._deleted){
      if(local) await DB.rawDelete(store, id);
    } else {
      let rec; try{ rec = JSON.parse(v.json); }catch(e){ return null; }
      await DB.rawPut(store, rec);
    }
    delete dirty[k];
    return { store, id };
  }

  async function markEverythingDirtyOnce(){
    if(meta.init) return;
    for(const store of SYNC_STORES){
      const rows = await DB.rawAll(store);
      for(const rec of rows){
        if(!syncable(store, rec)) continue;
        if(rec._u == null){ rec._u = rec.updatedAt || rec.createdAt || 1; await DB.rawPut(store, rec); }
        const k = keyOf(store, idOf(store, rec));
        if((remoteU[k] || 0) >= rec._u) continue;   // the cloud already has this or newer
        dirty[k] = { op:'p', u: rec._u };
      }
    }
    meta.init = true;
    await persistNow();
  }

  function processSnapshot(snap){
    return (async () => {
      const touched = [];
      let maxS = meta.lastSync;
      for(const ch of snap.docChanges()){
        if(ch.type === 'removed') continue;
        const d = ch.doc;
        if(d.metadata.hasPendingWrites) continue;   // our own write, not acknowledged yet
        const v = d.data(); if(!v || !v.store) continue;
        const s = v._s && v._s.toMillis ? v._s.toMillis() : 0;
        if(s > maxS) maxS = s;
        const t = await applyRemote(v);
        if(t) touched.push(t);
      }
      if(maxS > meta.lastSync){ meta.lastSync = maxS; persistSoon(); }
      if(!snap.metadata.fromCache){
        lastError = '';
        if(!serverSynced){
          serverSynced = true;
          await markEverythingDirtyOnce();
        }
        scheduleFlush(300);
        if(firstSyncResolve){ firstSyncResolve(); firstSyncResolve = null; }
      }
      if(touched.length) remoteCb(touched);
      emit();
    })().catch(e => { console.error('cloud snapshot', e); });
  }

  function startListener(){
    if(unsub){ try{ unsub(); }catch(e){} unsub = null; }
    const since = Math.max(0, meta.lastSync - SLACK_MS);
    let q = col;
    if(since > 0) q = q.where('_s', '>', firebase.firestore.Timestamp.fromMillis(since));
    q = q.orderBy('_s');
    unsub = q.onSnapshot({ includeMetadataChanges:true },
      snap => { chain = chain.then(() => processSnapshot(snap)); },
      err  => {
        lastError = (err && (err.code || err.message)) || 'sync error';
        if(firstSyncResolve){ firstSyncResolve(); firstSyncResolve = null; }
        emit();
      });
  }

  /* ---------- sending local changes ---------- */
  function scheduleFlush(ms){
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms == null ? 400 : ms);
  }
  async function flush(){
    if(!enabled || !user || !serverSynced || flushing) return;
    if(navigator.onLine === false){ emit(); return; }
    const keys = Object.keys(dirty);
    if(!keys.length){ emit(); return; }
    flushing = true; emit();
    let more = false;
    try{
      const batch = fs.batch();
      const sent = [];
      for(const k of keys.slice(0, CHUNK)){
        const [store, id] = splitK(k);
        const dk = dirty[k];
        let data;
        if(dk.op === 'd'){
          data = { store, id, json:null, _deleted:true, _u:dk.u };
        } else {
          const rec = await DB.rawGet(store, id);
          if(!rec){ delete dirty[k]; continue; }
          const json = JSON.stringify(rec);
          if(json.length > MAX_JSON){
            oversize[k] = (rec.title || rec.name || rec.key || 'Untitled') + '';
            delete dirty[k]; continue;
          }
          delete oversize[k];
          data = { store, id, json, _deleted:false, _u: rec._u || dk.u };
        }
        data._s = firebase.firestore.FieldValue.serverTimestamp();
        batch.set(col.doc(docId(store, id)), data);
        sent.push([k, dk.u]);
      }
      if(sent.length){
        const commit = batch.commit().then(() => {
          for(const [k, u] of sent){ if(dirty[k] && dirty[k].u === u) delete dirty[k]; }
          lastError = '';
          persistSoon(); emit();
        });
        commit.catch(e => { lastError = (e && (e.code || e.message)) || 'sync error'; emit(); });
        await Promise.race([commit, delay(15000)]);
      }
      more = Object.keys(dirty).length > 0;
    }catch(e){
      lastError = (e && (e.code || e.message)) || 'sync error';
      more = true;
    }
    flushing = false;
    persistSoon(); emit();
    if(more) scheduleFlush(lastError ? 30000 : 300);
  }

  /* ---------- login screen ---------- */
  const CSS = `
  #authGate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    padding:24px;background:var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',system-ui,sans-serif;}
  #authGate .auth-card{width:100%;max-width:380px;background:var(--bg-card);border:1px solid var(--line);
    border-radius:18px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.35);}
  #authGate h1{font-size:21px;font-weight:800;margin:0 0 4px;}
  #authGate .auth-sub{font-size:13px;color:var(--text-dim);margin:0 0 20px;line-height:1.5;}
  #authGate label{display:block;font-size:11px;font-weight:800;letter-spacing:.08em;color:var(--text-dim);margin:0 0 6px;}
  #authGate input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid var(--line);
    background:var(--bg-elevated);color:var(--text);font:inherit;font-size:16px;margin-bottom:14px;}
  #authGate input:focus{outline:2px solid var(--ecg);outline-offset:1px;}
  #authGate .pw-wrap{position:relative;}
  #authGate .pw-wrap input{padding-right:64px;}
  #authGate .pw-toggle{position:absolute;right:6px;top:5px;background:none;border:0;color:var(--text-dim);
    font:inherit;font-size:12px;font-weight:700;padding:8px;cursor:pointer;}
  #authGate .auth-btn{width:100%;padding:13px;border:0;border-radius:10px;background:var(--ecg);color:var(--on-ecg);
    font:inherit;font-size:15px;font-weight:800;cursor:pointer;}
  #authGate .auth-btn[disabled]{opacity:.6;cursor:default;}
  #authGate .auth-link{display:block;margin:14px auto 0;background:none;border:0;color:var(--spo2);font:inherit;
    font-size:13px;font-weight:700;cursor:pointer;}
  #authGate .auth-msg{min-height:18px;font-size:13px;margin:0 0 12px;line-height:1.4;}
  #authGate .auth-msg.err{color:var(--art);} #authGate .auth-msg.ok{color:var(--ecg);}
  #authGate .auth-foot{margin-top:18px;font-size:11.5px;color:var(--text-faint);text-align:center;}
  #authGate .auth-spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--ecg);
    margin:4px auto 16px;animation:authspin 0.9s linear infinite;}
  @keyframes authspin{to{transform:rotate(360deg);}}
  #cloudChip{position:fixed;right:10px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:60;width:12px;height:12px;
    border-radius:50%;background:var(--text-faint);border:2px solid var(--bg);cursor:pointer;box-shadow:0 0 0 1px var(--line);}
  #cloudChip.synced{background:var(--ecg);} #cloudChip.syncing,#cloudChip.connecting,#cloudChip.offline{background:var(--resp);}
  #cloudChip.error{background:var(--art);}
  `;
  function injectCss(){
    if(document.getElementById('cloudCss')) return;
    const st = document.createElement('style'); st.id = 'cloudCss'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  function gateEl(){
    let g = document.getElementById('authGate');
    if(!g){ g = document.createElement('div'); g.id = 'authGate'; document.body.appendChild(g); }
    return g;
  }
  function showSplash(text){
    injectCss();
    gateEl().innerHTML = '<div class="auth-card" style="text-align:center"><div class="auth-spin"></div>' +
      '<h1 style="font-size:17px">' + text + '</h1><p class="auth-sub" style="margin:6px 0 0">First time on this device — this can take a few seconds.</p></div>';
  }
  function hideGate(){ const g = document.getElementById('authGate'); if(g) g.remove(); }

  function friendly(e){
    const c = (e && e.code) || '';
    if(c === 'auth/invalid-email') return 'That email address is not valid.';
    if(c === 'auth/user-disabled') return 'This account has been disabled.';
    if(c === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
    if(c === 'auth/network-request-failed') return 'No internet connection. You need to be online for the first sign-in.';
    if(c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials')
      return 'Wrong email or password.';
    return 'Could not sign in (' + (c || (e && e.message) || 'unknown error') + ').';
  }

  function showLogin(){
    injectCss();
    const g = gateEl();
    g.innerHTML =
      '<form class="auth-card" id="authForm" novalidate>' +
        '<h1>Anaesthesia Vault</h1>' +
        '<p class="auth-sub">Sign in to open your notes on this device.</p>' +
        '<label for="authEmail">EMAIL</label>' +
        '<input id="authEmail" type="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="email">' +
        '<label for="authPass">PASSWORD</label>' +
        '<div class="pw-wrap"><input id="authPass" type="password" autocomplete="current-password">' +
        '<button type="button" class="pw-toggle" id="authToggle">Show</button></div>' +
        '<div class="auth-msg" id="authMsg" role="alert"></div>' +
        '<button class="auth-btn" id="authGo" type="submit">Sign in</button>' +
        '<button class="auth-link" id="authForgot" type="button">Forgot password?</button>' +
        '<div class="auth-foot">Private app. Accounts are created by the admin only.</div>' +
      '</form>';
    const $e = (id) => document.getElementById(id);
    const msg = (t, cls) => { $e('authMsg').textContent = t || ''; $e('authMsg').className = 'auth-msg ' + (cls || ''); };
    $e('authToggle').onclick = () => {
      const p = $e('authPass'); const show = p.type === 'password';
      p.type = show ? 'text' : 'password'; $e('authToggle').textContent = show ? 'Hide' : 'Show';
    };
    return new Promise((resolve) => {
      $e('authForm').onsubmit = async (ev) => {
        ev.preventDefault();
        const email = $e('authEmail').value.trim(), pass = $e('authPass').value;
        if(!email || !pass){ msg('Enter your email and password.', 'err'); return; }
        $e('authGo').disabled = true; $e('authGo').textContent = 'Signing in…'; msg('');
        try{
          const cred = await auth.signInWithEmailAndPassword(email, pass);
          user = cred.user; resolve();
        }catch(e){
          msg(friendly(e), 'err');
          $e('authGo').disabled = false; $e('authGo').textContent = 'Sign in';
        }
      };
      $e('authForgot').onclick = async () => {
        const email = $e('authEmail').value.trim();
        if(!email){ msg('Type your email above first, then tap "Forgot password?".', 'err'); return; }
        try{
          await auth.sendPasswordResetEmail(email);
          msg('If this email has an account, a password reset link has been sent.', 'ok');
        }catch(e){ msg(friendly(e), 'err'); }
      };
    });
  }

  /* ---------- start-up ---------- */
  async function begin(){
    await loadMeta();
    if(meta.uid !== user.uid){
      meta = { uid:user.uid, lastSync:0, init:false };
      dirty = {};
      await persistNow();
    }
    col = fs.collection('users').doc(user.uid).collection('items');
    const firstRun = !meta.init;
    const firstSync = new Promise(r => { firstSyncResolve = r; });
    if(firstRun) showSplash('Syncing your vault…');
    startListener();
    if(firstRun) await Promise.race([firstSync, delay(20000)]);
    hideGate();

    window.addEventListener('online',  () => { lastError = ''; scheduleFlush(500); emit(); });
    window.addEventListener('offline', emit);
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'hidden') persistNow();
      else { scheduleFlush(500); emit(); }
    });
    auth.onAuthStateChanged(u => { if(!u && user){ user = null; location.reload(); } });
  }

  async function gate(){
    if(!filled) return 'local';
    if(!libOk){ console.error('Firebase library missing'); return 'local'; }
    try{
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      fs = firebase.firestore();
      try{ fs.settings({ experimentalAutoDetectLongPolling:true, merge:true }); }catch(e){}
    }catch(e){
      console.error(e); lastError = 'init failed'; return 'local';
    }
    const u = await new Promise(res => { const off = auth.onAuthStateChanged(x => { off(); res(x); }); });
    if(u) user = u; else await showLogin();
    await begin();
    return 'cloud';
  }

  /* ---------- small public surface ---------- */
  function mountChip(onClick){
    if(!filled) return;
    injectCss();
    let c = document.getElementById('cloudChip');
    if(!c){ c = document.createElement('div'); c.id = 'cloudChip'; document.body.appendChild(c); }
    c.onclick = onClick;
    statusCbs.push(s => {
      c.className = s.state;
      const t = { synced:'Synced', syncing:'Syncing… (' + s.pending + ' pending)', connecting:'Connecting…',
                  offline:'Offline — changes are saved on this device (' + s.pending + ' waiting)', error:'Sync problem: ' + s.error };
      c.title = t[s.state] || '';
    });
    emit();
  }
  async function signOut(){
    await persistNow();
    try{ await auth.signOut(); }catch(e){}
    location.reload();
  }
  function syncNow(){
    lastError = '';
    if(!serverSynced) startListener();
    scheduleFlush(0); emit();
  }

  return {
    enabled: () => enabled, configured: () => filled,
    gate, stamp, wrote, deleted, status, syncNow, signOut, mountChip,
    onRemote: (f) => { remoteCb = f; },
    onStatus: (f) => { statusCbs.push(f); }
  };
})();
