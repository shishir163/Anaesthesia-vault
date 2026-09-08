/* ============================================================
   app.js — Anaesthesia Vault (Phase 1: core note engine)
   ============================================================ */

const EXAM_TAGS = ['Written','Viva','OSPE','Long Case','Short Case','Must-Know','High-Yield','Hard Topic'];
const FOLDER_COLORS = ['#39FF88','#22D3EE','#FB5F76','#FFD166','#B79CFF','#F97316','#5EEAD4'];

const state = {
  notes: [],
  folders: [],
  view: 'all',        // all | pinned | archived | trash | folder:<id>
  tagFilter: null,
  statusFilter: null,
  query: '',
  editingId: null,
  dirty: false,
  saveTimer: null,
  unsavedNewIds: new Set(), // notes opened via "+ New" that haven't been written to DB yet

  // ---- Phase 2: Study Planner ----
  mode: 'notes',          // 'notes' | 'planner'
  pview: 'today',         // today | week | month | timetable
  tasks: [],
  slots: [],
  weekOffset: 0,          // weeks from current week
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: null,     // YYYY-MM-DD picked in month view

  // ---- Phase 3: Revision system ----
  rview: 'list',          // list | activity
  revFilter: 'flagged',   // flagged | Must-Know | High-Yield | Hard Topic | Written | Viva | OSPE | Long Case | Short Case
  revOpenId: null,        // note expanded inline in the revision list
  activity: [],
  actRange: 'week',       // week | month
  backupNagHidden: false, // 'Later' only hides it for this session

  // ---- Phase 5: settings ----
  settings: {
    theme: 'icu',
    noteFont: "'Plus Jakarta Sans', system-ui, sans-serif",
    noteSize: '14.5px',
    noteWeight: '400',
    examDate: '',
    weekStart: 6,         // JS getDay index: 6=Sat, 0=Sun, 1=Mon
    backupReminderDays: 3,
    lastBackupAt: 0,
  },
};

const THEMES = [
  { id:'icu',      name:'ICU Monitor', kind:'dark',  sw:['#0A1622','#39FF88','#22D3EE','#FFD166'] },
  { id:'midnight', name:'Midnight',    kind:'dark',  sw:['#0E0B1F','#C4B5FD','#7DD3FC','#F472B6'] },
  { id:'carbon',   name:'Carbon',      kind:'dark',  sw:['#0C0C0D','#F59E0B','#38BDF8','#FDE047'] },
  { id:'paper',    name:'Paper',       kind:'light', sw:['#F5F3EC','#0FA45C','#0E90A8','#D6425A'] },
  { id:'citrus',   name:'Citrus',      kind:'light', sw:['#FFF9F0','#EA580C','#CA8A04','#DB2777'] },
  { id:'mint',     name:'Mint',        kind:'light', sw:['#F0FBF6','#0D9488','#0369A1','#E11D48'] },
  { id:'blossom',  name:'Blossom',     kind:'light', sw:['#FDF4FB','#C026D3','#7C3AED','#2563EB'] },
];

const DOW_ALL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function dowLabels(){
  const s = state.settings.weekStart;
  return Array.from({length:7}, (_,i) => DOW_ALL[(s+i)%7]);
}

const REV_FILTERS = ['flagged','Must-Know','High-Yield','Hard Topic','Written','Viva','OSPE','Long Case','Short Case'];
const FLAG_TAGS = ['Must-Know','High-Yield','Hard Topic'];

const STATUSES = [
  { id:'none',      label:'Not started', cls:'st-none' },
  { id:'due',       label:'Due',         cls:'st-due' },
  { id:'partial',   label:'Partial',     cls:'st-partial' },
  { id:'completed', label:'Completed',   cls:'st-completed' },
];
const statusOf = n => n.status || 'none';
const statusMeta = id => STATUSES.find(s=>s.id===id) || STATUSES[0];


const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

function fmtDate(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB',{ day:'2-digit', month:'short' }) + ' · ' +
         d.toLocaleTimeString('en-GB',{ hour:'2-digit', minute:'2-digit' });
}
function plainText(html){
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || '';
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function badgeClass(tag){
  const map = {
    'Written':'badge-writ','Viva':'badge-viva','OSPE':'badge-ospe',
    'Long Case':'badge-long','Short Case':'badge-short',
    'Must-Know':'badge-must','High-Yield':'badge-yield','Hard Topic':'badge-hard'
  };
  return map[tag] || 'badge-writ';
}

/* ---------------- Date helpers (week starts Saturday) ---------------- */
function isoDate(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayISO(){ return isoDate(new Date()); }
function addDays(d, n){ const c = new Date(d); c.setDate(c.getDate()+n); return c; }
function dowIndex(d){ return (d.getDay() - state.settings.weekStart + 7) % 7; }
function startOfWeek(d){ return addDays(d, -dowIndex(d)); }
function fmtDayLabel(d){ return d.toLocaleDateString('en-GB',{ day:'2-digit', month:'short' }); }
function fmtMonthLabel(d){ return d.toLocaleDateString('en-GB',{ month:'long', year:'numeric' }); }
function fmtTime12(t){
  if(!t) return '';
  const [h,m] = t.split(':').map(Number);
  const ampm = h>=12?'PM':'AM'; const h12 = ((h+11)%12)+1;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

/* ---------------- Boot ---------------- */
async function boot(){
  registerSW();
  state.notes   = await DB.getAllNotes();
  state.folders = await DB.getAllFolders();
  state.tasks   = await DB.getAllTasks();
  state.slots   = await DB.getAllSlots();
  state.activity = await DB.getAllActivity();

  if(state.folders.length === 0){
    const seed = [
      {name:'Cardiac Anaesthesia', color:FOLDER_COLORS[0]},
      {name:'Regional & Obstetric', color:FOLDER_COLORS[1]},
      {name:'Critical Care', color:FOLDER_COLORS[2]},
      {name:'Applied Physiology', color:FOLDER_COLORS[3]},
    ];
    for(const f of seed){
      const folder = { id: uid(), name:f.name, color:f.color, createdAt: Date.now() };
      await DB.putFolder(folder);
      state.folders.push(folder);
    }
  }

  await loadSettings();
  await migrateSlots();

  bindGlobalEvents();
  renderSidebar();
  renderGrid();
  switchMode('home');
}

function registerSW(){
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    });
  }
}

/* ---------------- Derived data ---------------- */
function visibleNotes(){
  let list = state.notes.filter(n => {
    if(state.view === 'trash')    return n.trashed;
    if(n.trashed) return false;
    if(state.view === 'archived') return n.archived;
    if(n.archived) return false;
    if(state.view === 'pinned')   return n.pinned;
    if(state.view.startsWith('folder:')) return n.folderId === state.view.slice(7);
    return true; // 'all'
  });

  if(state.statusFilter){
    list = list.filter(n => statusOf(n) === state.statusFilter);
  }
  if(state.tagFilter){
    list = list.filter(n => (n.tags||[]).includes(state.tagFilter) || (n.examTags||[]).includes(state.tagFilter));
  }
  if(state.query.trim()){
    const q = state.query.toLowerCase();
    list = list.filter(n =>
      (n.title||'').toLowerCase().includes(q) ||
      plainText(n.content).toLowerCase().includes(q) ||
      (n.tags||[]).some(t=>t.toLowerCase().includes(q)) ||
      (n.examTags||[]).some(t=>t.toLowerCase().includes(q))
    );
  }
  list.sort((a,b) => {
    if(state.view !== 'trash' && (a.pinned !== b.pinned)) return a.pinned ? -1 : 1;
    return (b.updatedAt||0) - (a.updatedAt||0);
  });
  return list;
}

function allUserTags(){
  const s = new Set();
  state.notes.forEach(n => (n.tags||[]).forEach(t => s.add(t)));
  return Array.from(s).sort();
}

/* ---------------- Sidebar ---------------- */
function renderSidebar(){
  const dot = $('#backupDot');
  if(dot) dot.style.display = backupOverdue() ? 'inline-block' : 'none';
  const body = $('#sideBody');
  if(state.mode === 'notes')        renderNotesSidebar(body);
  else if(state.mode === 'planner') renderPlannerSidebar(body);
  else if(state.mode === 'revise')  renderReviseSidebar(body);
  else                              renderHomeSidebar(body);
}

/* ---- Notes sidebar: views, status, folders, tags ---- */
function renderNotesSidebar(body){
  const counts = {
    all: state.notes.filter(n=>!n.trashed && !n.archived).length,
    pinned: state.notes.filter(n=>n.pinned && !n.trashed && !n.archived).length,
    archived: state.notes.filter(n=>n.archived && !n.trashed).length,
    trash: state.notes.filter(n=>n.trashed).length,
  };
  const live = state.notes.filter(n=>!n.trashed && !n.archived);

  const folderRows = state.folders.map(f => {
    const c = state.notes.filter(n => n.folderId===f.id && !n.trashed && !n.archived).length;
    return `
      <div class="folder-row">
        <button class="side-btn ${state.view==='folder:'+f.id?'active':''}" data-view="folder:${f.id}">
          <span class="folder-dot" style="background:${f.color}"></span>
          ${escapeHtml(f.name)} <span class="count">${c}</span>
        </button>
        <button class="icon-btn" data-del-folder="${f.id}" title="Delete folder">${icon('x')}</button>
      </div>`;
  }).join('');

  const tags = allUserTags();

  body.innerHTML = `
    <div class="side-section">
      <button class="side-btn ${state.view==='all'?'active':''}" data-view="all">
        ${icon('grid')} All notes <span class="count">${counts.all}</span></button>
      <button class="side-btn ${state.view==='pinned'?'active':''}" data-view="pinned">
        ${icon('pin')} Pinned <span class="count">${counts.pinned}</span></button>
      <button class="side-btn ${state.view==='archived'?'active':''}" data-view="archived">
        ${icon('archive')} Archive <span class="count">${counts.archived}</span></button>
      <button class="side-btn ${state.view==='trash'?'active':''}" data-view="trash">
        ${icon('trash')} Trash <span class="count">${counts.trash}</span></button>
    </div>

    <div class="side-section">
      <div class="side-label">Status</div>
      ${STATUSES.map(st=>{
        const c = live.filter(n=>statusOf(n)===st.id).length;
        return `<button class="side-btn ${state.statusFilter===st.id?'active':''}" data-status="${st.id}">
          <span class="status-dot ${st.cls}"></span>${st.label} <span class="count">${c}</span></button>`;
      }).join('')}
    </div>

    <div class="side-section">
      <div class="side-label">Folders <button class="icon-btn" id="addFolderBtn">${icon('plus')}</button></div>
      ${folderRows || '<div style="padding:6px 8px;color:var(--text-faint);font-size:12px;">No folders yet</div>'}
    </div>

    ${tags.length ? `<div class="side-section">
      <div class="side-label">Tags</div>
      <div class="tag-wrap">
        ${tags.map(t=>`<span class="tag-chip ${state.tagFilter===t?'active':''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')}
      </div></div>` : ''}
  `;

  $$('.side-btn[data-view]', body).forEach(b => b.onclick = () => {
    state.view = b.dataset.view; state.tagFilter = null; state.statusFilter = null;
    renderSidebar(); renderGrid(); closeSidebarMobile();
  });
  $$('[data-status]', body).forEach(b => b.onclick = () => {
    state.statusFilter = state.statusFilter === b.dataset.status ? null : b.dataset.status;
    renderSidebar(); renderGrid(); closeSidebarMobile();
  });
  $$('.tag-chip', body).forEach(c => c.onclick = () => {
    state.tagFilter = state.tagFilter === c.dataset.tag ? null : c.dataset.tag;
    renderSidebar(); renderGrid();
  });
  $$('[data-del-folder]', body).forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const id = b.dataset.delFolder;
    if(!confirm('Delete this folder? Notes inside will move to All notes.')) return;
    await DB.deleteFolder(id);
    state.folders = state.folders.filter(f=>f.id!==id);
    const affected = state.notes.filter(n=>n.folderId===id);
    for(const n of affected){ n.folderId = null; await DB.putNote(n); }
    if(state.view === 'folder:'+id) state.view = 'all';
    renderSidebar(); renderGrid();
  });
  $('#addFolderBtn').onclick = () => openFolderModal();
}

/* ---- Home sidebar ---- */
function renderHomeSidebar(body){
  const d = daysUntilExam();
  const todays = state.tasks.filter(t=>t.date===todayISO());
  const due = liveNotes().filter(n => (n.examTags||[]).some(t=>FLAG_TAGS.includes(t)))
                         .filter(n => { const x = daysSince(n.lastRevisedAt); return x===null || x>=7; });
  body.innerHTML = `
    ${d !== null && d >= 0 ? `<div class="side-mini accent"><div class="v">${d}</div><div class="k">days to exam</div></div>` : ''}
    <div class="side-mini"><div class="v">${todays.filter(t=>t.completed).length}/${todays.length}</div><div class="k">today's tasks</div></div>
    <div class="side-mini"><div class="v" style="color:var(--art)">${due.length}</div><div class="k">due for revision</div></div>
    <div class="side-section">
      <button class="side-btn" data-jump="new">${icon('plus')} New note</button>
      <button class="side-btn" data-jump="planner">${icon('grid')} Study planner</button>
      <button class="side-btn" data-jump="revise">${icon('pin')} Revision list</button>
    </div>
  `;
  $$('[data-jump]', body).forEach(b => b.onclick = () => {
    const j = b.dataset.jump;
    if(j==='new') openEditor('new');
    else if(j==='planner'){ switchMode('planner'); switchPView('today'); }
    else { switchMode('revise'); switchRView('list'); }
  });
}

/* ---- Planner sidebar ---- */
function renderPlannerSidebar(body){
  const views = [['today','Today'],['week','Week'],['month','Month'],['timetable','Timetable']];
  const todays = state.tasks.filter(t=>t.date===todayISO());
  const weekDates = new Set(activityWindow().map(w=>w.date));
  const weekDone = state.tasks.filter(t=>t.completed && weekDates.has(t.date)).length;
  body.innerHTML = `
    <div class="side-section">
      <div class="side-label">Planner</div>
      ${views.map(([v,l])=>`<button class="side-btn ${state.pview===v?'active':''}" data-pjump="${v}">${l}</button>`).join('')}
    </div>
    <div class="side-mini accent"><div class="v">${todays.filter(t=>t.completed).length}/${todays.length}</div><div class="k">done today</div></div>
    <div class="side-mini"><div class="v">${weekDone}</div><div class="k">tasks done this week</div></div>
    <div class="side-mini"><div class="v">${state.slots.length}</div><div class="k">timetable slots</div></div>
    <div class="side-hint">Tip: put your fixed routine in <b>Timetable</b>, and only day-specific work in <b>Today</b>.</div>
  `;
  $$('[data-pjump]', body).forEach(b => b.onclick = () => { switchPView(b.dataset.pjump); renderSidebar(); closeSidebarMobile(); });
}

/* ---- Revise sidebar ---- */
function renderReviseSidebar(body){
  const flagged = revisionCandidates('flagged');
  const never = flagged.filter(n=>!n.lastRevisedAt).length;
  body.innerHTML = `
    <div class="side-section">
      <div class="side-label">Revise</div>
      <button class="side-btn ${state.rview==='list'?'active':''}" data-rjump="list">Revision list</button>
      <button class="side-btn ${state.rview==='activity'?'active':''}" data-rjump="activity">Activity</button>
    </div>
    <div class="side-section">
      <div class="side-label">Filter</div>
      ${REV_FILTERS.map(f=>{
        const c = revisionCandidates(f).length;
        if(!c && f!=='flagged') return '';
        return `<button class="side-btn ${state.revFilter===f?'active':''}" data-rfilter="${f}">
          ${f==='flagged'?'All flagged':f} <span class="count">${c}</span></button>`;
      }).join('')}
    </div>
    <div class="side-mini"><div class="v" style="color:var(--art)">${never}</div><div class="k">never revised</div></div>
    <div class="side-hint">The list is sorted oldest-first, so the top is always what you've left longest.</div>
  `;
  $$('[data-rjump]', body).forEach(b => b.onclick = () => { switchRView(b.dataset.rjump); renderSidebar(); closeSidebarMobile(); });
  $$('[data-rfilter]', body).forEach(b => b.onclick = () => {
    state.revFilter = b.dataset.rfilter; state.rview = 'list'; state.revOpenId = null;
    switchRView('list'); renderSidebar(); closeSidebarMobile();
  });
}

/* ---------------- Grid ---------------- */
function viewTitle(){
  if(state.view === 'all') return 'All notes';
  if(state.view === 'pinned') return 'Pinned';
  if(state.view === 'archived') return 'Archive';
  if(state.view === 'trash') return 'Trash';
  if(state.view.startsWith('folder:')){
    const f = state.folders.find(f=>f.id===state.view.slice(7));
    return f ? f.name : 'Folder';
  }
  return 'Notes';
}

function renderGrid(){
  const list = visibleNotes();
  $('#sectionTitle').textContent = viewTitle();
  $('#sectionSub').textContent = state.tagFilter ? `filtered by #${state.tagFilter}` :
    `${list.length} note${list.length===1?'':'s'}`;

  if(list.length === 0){
    $('#grid').innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        ${icon('inbox', 40)}
        <div>${state.view==='trash' ? 'Trash is empty' : 'No notes here yet — tap + New to start'}</div>
      </div>`;
    return;
  }

  $('#grid').innerHTML = list.map(n => {
    const folder = state.folders.find(f=>f.id===n.folderId);
    const preview = escapeHtml(plainText(n.content)).slice(0,160);
    const tags = [...(n.examTags||[]), ...(n.tags||[]).map(t=>'#'+t)];
    return `
    <div class="note-card" style="border-left-color:${folder?folder.color:'var(--ecg)'}" data-open="${n.id}">
      <div class="nc-top">
        <div class="nc-title">${escapeHtml(n.title || 'Untitled')}</div>
        ${n.pinned ? `<span class="nc-pin">${icon('pin',14)}</span>` : ''}
      </div>
      <div class="nc-body">${preview || 'Empty note'}</div>
      <div class="nc-tags">
        <span class="badge badge-status"><i class="status-dot ${statusMeta(statusOf(n)).cls}"></i>${statusMeta(statusOf(n)).label}</span>
        ${(n.examTags||[]).map(t=>`<span class="badge ${badgeClass(t)}">${t}</span>`).join('')}
        ${(n.tags||[]).slice(0,3).map(t=>`<span class="badge" style="background:var(--bg-elevated);color:var(--text-faint)">#${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="nc-foot">
        <span>${fmtDate(n.updatedAt)}</span>
        <span class="nc-actions">
          ${state.view==='trash' ? `
            <button class="icon-btn" data-restore="${n.id}" title="Restore">${icon('undo',15)}</button>
            <button class="icon-btn" data-purge="${n.id}" title="Delete forever">${icon('x',15)}</button>
          ` : `
            <button class="icon-btn" data-pin="${n.id}" title="Pin">${icon('pin',15)}</button>
            <button class="icon-btn" data-archive="${n.id}" title="Archive">${icon('archive',15)}</button>
            <button class="icon-btn" data-trash="${n.id}" title="Move to trash">${icon('trash',15)}</button>
          `}
        </span>
      </div>
    </div>`;
  }).join('');

  $$('[data-open]').forEach(el => el.addEventListener('click', (e) => {
    if(e.target.closest('[data-pin],[data-archive],[data-trash],[data-restore],[data-purge]')) return;
    openEditor(el.dataset.open);
  }));
  $$('[data-pin]').forEach(b => b.onclick = (e)=>{ e.stopPropagation(); toggleField(b.dataset.pin,'pinned'); });
  $$('[data-archive]').forEach(b => b.onclick = (e)=>{ e.stopPropagation(); toggleField(b.dataset.archive,'archived'); });
  $$('[data-trash]').forEach(b => b.onclick = (e)=>{ e.stopPropagation(); moveToTrash(b.dataset.trash); });
  $$('[data-restore]').forEach(b => b.onclick = (e)=>{ e.stopPropagation(); restoreNote(b.dataset.restore); });
  $$('[data-purge]').forEach(b => b.onclick = (e)=>{ e.stopPropagation(); purgeNote(b.dataset.purge); });
}

async function toggleField(id, field){
  const n = state.notes.find(n=>n.id===id); if(!n) return;
  n[field] = !n[field];
  n.updatedAt = Date.now();
  await DB.putNote(n);
  renderSidebar(); renderGrid();
}
async function moveToTrash(id){
  const n = state.notes.find(n=>n.id===id); if(!n) return;
  n.trashed = true; n.pinned = false; n.updatedAt = Date.now();
  await DB.putNote(n);
  renderSidebar(); renderGrid();
  toast('Moved to trash');
}
async function restoreNote(id){
  const n = state.notes.find(n=>n.id===id); if(!n) return;
  n.trashed = false; n.updatedAt = Date.now();
  await DB.putNote(n);
  renderSidebar(); renderGrid();
  toast('Restored');
}
async function purgeNote(id){
  if(!confirm('Delete this note permanently? This cannot be undone.')) return;
  await DB.deleteNoteHard(id);
  state.notes = state.notes.filter(n=>n.id!==id);
  renderSidebar(); renderGrid();
  toast('Deleted permanently');
}

/* ============================================================
   Phase 2 — Study Planner
   ============================================================ */

function switchMode(mode){
  state.mode = mode;
  const modes = { home:'#modeHomeBtn', notes:'#modeNotesBtn', planner:'#modePlannerBtn', revise:'#modeReviseBtn' };
  Object.entries(modes).forEach(([m,sel]) => $(sel).classList.toggle('active', mode===m));
  $('#dashContent').style.display    = mode==='home'    ? '' : 'none';
  $('#notesContent').style.display   = mode==='notes'   ? '' : 'none';
  $('#plannerContent').style.display = mode==='planner' ? '' : 'none';
  $('#reviseContent').style.display  = mode==='revise'  ? '' : 'none';
  $('#sidebarFooter').style.display  = mode==='notes' ? '' : 'none';
  renderSidebar();
  if(mode==='home') renderDashboard();
  else if(mode==='planner') renderPlannerBody();
  else if(mode==='revise') renderReviseBody();
  else renderGrid();
  closeSidebarMobile();
}

function switchPView(view){
  state.pview = view;
  $$('.planner-tab').forEach(b => b.classList.toggle('active', b.dataset.pview===view));
  const titles = { today:'Today', week:'This Week', month:'This Month', timetable:'Weekly Timetable' };
  $('#plannerTitle').textContent = titles[view] || 'Planner';
  renderPlannerBody();
}

function renderPlannerBody(){
  if(state.pview==='today') return renderToday();
  if(state.pview==='week') return renderWeek();
  if(state.pview==='month') return renderMonth();
  if(state.pview==='timetable') return renderTimetable();
}

/* ---- Today ---- */
function renderToday(){
  const list = state.tasks.filter(t=>t.date===todayISO())
    .sort((a,b)=> (a.time||'99:99').localeCompare(b.time||'99:99'));
  const done = list.filter(t=>t.completed).length;
  const pct = list.length ? Math.round(done/list.length*100) : 0;

  $('#plannerBody').innerHTML = `
    <div class="quick-add">
      <input type="text" id="qaTitle" placeholder="Add today's task — e.g. Revise spinal anaesthesia">
      <input type="time" id="qaTime">
      <input type="text" id="qaTopic" placeholder="Topic" style="max-width:110px;">
      <button id="qaAdd">${icon('plus',14)} Add</button>
    </div>
    <div class="today-progress">
      <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      <span class="num">${done}/${list.length} done</span>
    </div>
    <div id="taskList">
      ${list.length ? list.map(taskRowHTML).join('') : `<div class="empty">${icon('inbox',34)}<div>No tasks for today yet</div></div>`}
    </div>
  `;
  bindTaskRowEvents();
  $('#qaAdd').onclick = async () => {
    const title = $('#qaTitle').value.trim();
    if(!title) return;
    await addTask({ title, date: todayISO(), time: $('#qaTime').value || '', topic: $('#qaTopic').value.trim() });
    renderToday();
  };
  $('#qaTitle').onkeydown = (e) => { if(e.key==='Enter') $('#qaAdd').click(); };
}

function taskRowHTML(t){
  return `
    <div class="task-row ${t.completed?'done':''}" data-task="${t.id}">
      <button class="task-check ${t.completed?'on':''}" data-toggle="${t.id}">${t.completed?icon('check',12):''}</button>
      <div style="flex:1;">
        <div class="task-title">${escapeHtml(t.title)}</div>
        <div class="task-meta">
          ${t.time ? `<span>${fmtTime12(t.time)}</span>` : ''}
          ${t.topic ? `<span class="task-topic">${escapeHtml(t.topic)}</span>` : ''}
        </div>
      </div>
      <button class="task-del" data-deltask="${t.id}">${icon('x',15)}</button>
    </div>`;
}
function bindTaskRowEvents(){
  $$('[data-toggle]').forEach(b => b.onclick = () => toggleTask(b.dataset.toggle));
  $$('[data-deltask]').forEach(b => b.onclick = () => removeTask(b.dataset.deltask));
}
async function addTask(partial){
  const t = {
    id: uid(), title: partial.title, date: partial.date, time: partial.time||'',
    topic: partial.topic||'', completed:false, createdAt: Date.now(), updatedAt: Date.now()
  };
  await DB.putTask(t);
  state.tasks.push(t);
  return t;
}
async function toggleTask(id){
  const t = state.tasks.find(t=>t.id===id); if(!t) return;
  t.completed = !t.completed; t.updatedAt = Date.now();
  await DB.putTask(t);
  if(t.completed) await logActivity('task', t.topic || 'General');
  refreshCurrentView();
}
async function removeTask(id){
  await DB.deleteTask(id);
  state.tasks = state.tasks.filter(t=>t.id!==id);
  refreshCurrentView();
}

function refreshCurrentView(){
  if(state.mode === 'home') renderDashboard();
  else if(state.mode === 'planner') renderPlannerBody();
  else if(state.mode === 'revise') renderReviseBody();
  else { renderSidebar(); renderGrid(); }
}

/* ---- Week ---- */
function renderWeek(){
  const start = addDays(startOfWeek(new Date()), state.weekOffset*7);
  const days = Array.from({length:7}, (_,i)=>addDays(start,i));
  const label = `${fmtDayLabel(days[0])} – ${fmtDayLabel(days[6])}`;

  $('#plannerBody').innerHTML = `
    <div class="week-nav">
      <button id="weekPrev">${icon('chevL',14)}</button>
      <span class="label">${label}</span>
      <button id="weekNext">${icon('chevR',14)}</button>
      ${state.weekOffset!==0 ? `<button class="btn btn-ghost" id="weekToday" style="padding:5px 10px;">This week</button>` : ''}
    </div>
    <div class="week-grid">
      ${days.map(d=>{
        const iso = isoDate(d);
        const dayTasks = state.tasks.filter(t=>t.date===iso).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
        const isToday = iso===todayISO();
        return `
        <div class="day-col ${isToday?'today':''}">
          <div class="day-col-head"><span>${dowLabels()[dowIndex(d)]}</span><span>${fmtDayLabel(d)}</span></div>
          ${dayTasks.map(t=>`
            <div class="task-row ${t.completed?'done':''}" data-task="${t.id}" style="padding:6px 8px;">
              <button class="task-check ${t.completed?'on':''}" data-toggle="${t.id}" style="width:16px;height:16px;">${t.completed?icon('check',10):''}</button>
              <div style="flex:1;">
                <div class="task-title" style="font-size:12px;">${escapeHtml(t.title)}</div>
                ${t.time ? `<div class="task-meta"><span>${fmtTime12(t.time)}</span></div>` : ''}
              </div>
              <button class="task-del" data-deltask="${t.id}">${icon('x',12)}</button>
            </div>`).join('')}
          <button class="add-mini" data-addday="${iso}">+ add</button>
        </div>`;
      }).join('')}
    </div>
  `;
  bindTaskRowEvents();
  $('#weekPrev').onclick = () => { state.weekOffset--; renderWeek(); };
  $('#weekNext').onclick = () => { state.weekOffset++; renderWeek(); };
  if($('#weekToday')) $('#weekToday').onclick = () => { state.weekOffset=0; renderWeek(); };
  $$('[data-addday]').forEach(b => b.onclick = () => openTaskModal(b.dataset.addday));
}

/* ---- Month (calendar grid) ---- */
function renderMonth(){
  const cursor = state.monthCursor;
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -dowIndex(firstOfMonth));
  const cells = Array.from({length:42}, (_,i)=>addDays(gridStart,i));
  const todayIso = todayISO();

  const tasksByDate = {};
  state.tasks.forEach(t => {
    if(!tasksByDate[t.date]) tasksByDate[t.date] = [];
    tasksByDate[t.date].push(t);
  });

  $('#plannerBody').innerHTML = `
    <div class="month-nav">
      <button id="monthPrev">${icon('chevL',14)}</button>
      <span class="label">${fmtMonthLabel(cursor)}</span>
      <button id="monthNext">${icon('chevR',14)}</button>
    </div>
    <div class="cal-grid">
      ${dowLabels().map(l=>`<div class="cal-dow">${l}</div>`).join('')}
      ${cells.map(d=>{
        const iso = isoDate(d);
        const outside = d.getMonth()!==cursor.getMonth();
        const count = (tasksByDate[iso]||[]).length;
        return `
        <div class="cal-cell ${outside?'outside':''} ${iso===todayIso?'today':''} ${state.selectedDate===iso?'selected':''}" data-date="${iso}">
          <span class="dnum">${d.getDate()}</span>
          <div class="dots">${Array.from({length:Math.min(count,4)}).map(()=>'<span></span>').join('')}</div>
        </div>`;
      }).join('')}
    </div>
    <div id="dayPanelWrap"></div>
  `;
  $('#monthPrev').onclick = () => { state.monthCursor = new Date(cursor.getFullYear(), cursor.getMonth()-1, 1); renderMonth(); };
  $('#monthNext').onclick = () => { state.monthCursor = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1); renderMonth(); };
  $$('[data-date]').forEach(c => c.onclick = () => { state.selectedDate = c.dataset.date; renderMonth(); });

  if(state.selectedDate) renderDayPanel(state.selectedDate);
}
function renderDayPanel(iso){
  const list = (state.tasks.filter(t=>t.date===iso)).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
  const d = new Date(iso+'T00:00:00');
  $('#dayPanelWrap').innerHTML = `
    <div class="day-panel">
      <h3>${d.toLocaleDateString('en-GB',{ weekday:'long', day:'2-digit', month:'long' })}</h3>
      <div id="dayPanelTasks">${list.length ? list.map(taskRowHTML).join('') : `<div style="color:var(--text-faint);font-size:13px;">No tasks this day</div>`}</div>
      <button class="btn btn-ghost" id="dayPanelAdd" style="margin-top:10px;">${icon('plus',13)} Add task for this day</button>
    </div>
  `;
  bindTaskRowEvents();
  $('#dayPanelAdd').onclick = () => openTaskModal(iso);
}

/* ---- Add-task modal (used by Week + Month) ---- */
function openTaskModal(dateIso){
  $('#taskTitleInput').value = '';
  $('#taskDateInput').value = dateIso || todayISO();
  $('#taskTimeInput').value = '';
  $('#taskTopicInput').value = '';
  $('#taskModal').classList.add('show');
  setTimeout(()=>$('#taskTitleInput').focus(),50);
}
async function saveTaskModal(){
  const title = $('#taskTitleInput').value.trim();
  if(!title) return;
  await addTask({
    title, date: $('#taskDateInput').value || todayISO(),
    time: $('#taskTimeInput').value, topic: $('#taskTopicInput').value.trim()
  });
  $('#taskModal').classList.remove('show');
  renderPlannerBody();
}

/* ---- Timetable (recurring weekly routine) ---- */
function renderTimetable(){
  $('#plannerBody').innerHTML = `
    <p class="section-sub" style="margin-bottom:14px;">Your recurring weekly study routine — set once, reuse every week.</p>
    <div class="timetable-grid">
      ${dowLabels().map((label,li)=>{
        const i = (state.settings.weekStart + li) % 7;
        const daySlots = state.slots.filter(s=>s.day===i).sort((a,b)=>a.start.localeCompare(b.start));
        return `
        <div class="tt-col">
          <div class="tt-col-head">${label}</div>
          ${daySlots.map(s=>`
            <div class="slot-chip" style="border-left-color:${s.color||'var(--ecg)'}">
              <div class="st">${fmtTime12(s.start)} – ${fmtTime12(s.end)}</div>
              <div class="sub">${escapeHtml(s.subject)}</div>
              <button class="del" data-delslot="${s.id}">${icon('x',11)}</button>
            </div>`).join('')}
          <button class="add-mini" data-addslot="${i}">+ add slot</button>
        </div>`;
      }).join('')}
    </div>
  `;
  $$('[data-addslot]').forEach(b => b.onclick = () => openSlotModal(Number(b.dataset.addslot)));
  $$('[data-delslot]').forEach(b => b.onclick = () => deleteSlotFn(b.dataset.delslot));
}
function openSlotModal(dayIdx){
  $('#slotDay').innerHTML = dowLabels().map((l,li)=>{
    const v = (state.settings.weekStart + li) % 7;
    return `<option value="${v}" ${v===dayIdx?'selected':''}>${l}</option>`;
  }).join('');
  $('#slotStart').value = '18:00';
  $('#slotEnd').value = '19:00';
  $('#slotSubject').value = '';
  $('#slotColorRow').innerHTML = FOLDER_COLORS.map((c,i)=>
    `<span class="color-swatch ${i===0?'sel':''}" style="background:${c}" data-color="${c}"></span>`).join('');
  $$('#slotColorRow .color-swatch').forEach(s => s.onclick = () => {
    $$('#slotColorRow .color-swatch').forEach(x=>x.classList.remove('sel'));
    s.classList.add('sel');
  });
  $('#slotModal').classList.add('show');
}
async function saveSlotModal(){
  const subject = $('#slotSubject').value.trim();
  if(!subject) return;
  const slot = {
    id: uid(), day: Number($('#slotDay').value),
    start: $('#slotStart').value, end: $('#slotEnd').value,
    subject, color: (function(){ var el = $('#slotColorRow .color-swatch.sel'); return el ? el.dataset.color : FOLDER_COLORS[0]; })(),
    createdAt: Date.now()
  };
  await DB.putSlot(slot);
  state.slots.push(slot);
  $('#slotModal').classList.remove('show');
  renderTimetable();
}
async function deleteSlotFn(id){
  await DB.deleteSlot(id);
  state.slots = state.slots.filter(s=>s.id!==id);
  renderTimetable();
}

/* ============================================================
   Phase 3 — Revision system
   ============================================================ */

async function logActivity(type, topic){
  const entry = { id: uid(), type, topic: topic || 'General', date: todayISO(), ts: Date.now() };
  await DB.putActivity(entry);
  state.activity.push(entry);
}

function switchRView(view){
  state.rview = view;
  $$('.revise-tab').forEach(b => b.classList.toggle('active', b.dataset.rview===view));
  $('#reviseTitle').textContent = view==='list' ? 'Last-night revision' : 'Study activity';
  renderReviseBody();
}
function renderReviseBody(){
  if(state.rview==='list') return renderRevisionList();
  return renderActivity();
}

/* ---- Revision list ---- */
function liveNotes(){ return state.notes.filter(n => !n.trashed); }

function revisionCandidates(filter){
  const pool = liveNotes();
  if(filter === 'flagged') return pool.filter(n => (n.examTags||[]).some(t => FLAG_TAGS.includes(t)));
  return pool.filter(n => (n.examTags||[]).includes(filter));
}

function daysSince(ts){
  if(!ts) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}
function ageLabel(n){
  const d = daysSince(n.lastRevisedAt);
  if(d === null) return { text:'never revised', stale:true };
  if(d === 0) return { text:'revised today', stale:false };
  if(d === 1) return { text:'revised 1d ago', stale:false };
  return { text:`revised ${d}d ago`, stale: d >= 7 };
}

function renderRevisionList(){
  const list = revisionCandidates(state.revFilter)
    .sort((a,b) => (a.lastRevisedAt||0) - (b.lastRevisedAt||0)); // least-recently-revised first

  const flagged = revisionCandidates('flagged');
  const neverRevised = flagged.filter(n => !n.lastRevisedAt).length;
  const revisedToday = liveNotes().filter(n => daysSince(n.lastRevisedAt) === 0).length;

  $('#reviseBody').innerHTML = `
    <div class="rev-summary">
      <div class="rev-stat"><div class="v">${flagged.length}</div><div class="k">flagged for revision</div></div>
      <div class="rev-stat"><div class="v" style="color:var(--art)">${neverRevised}</div><div class="k">never revised</div></div>
      <div class="rev-stat"><div class="v" style="color:var(--ecg)">${revisedToday}</div><div class="k">revised today</div></div>
    </div>

    <div class="rev-filters">
      ${REV_FILTERS.map(f=>{
        const c = revisionCandidates(f).length;
        const label = f==='flagged' ? 'All flagged' : f;
        return `<button class="rev-filter ${state.revFilter===f?'on':''}" data-revfilter="${f}">${label}<span class="n">${c}</span></button>`;
      }).join('')}
    </div>

    <p class="section-sub">Oldest revision first — the top of this list is what you've left longest.</p>

    <div id="revList">
      ${list.length ? list.map(revItemHTML).join('') : `
        <div class="empty">${icon('inbox',34)}
          <div>Nothing tagged here yet. Open a note and tag it Must-Know, High-Yield or Hard Topic.</div>
        </div>`}
    </div>
  `;

  $$('[data-revfilter]').forEach(b => b.onclick = () => {
    state.revFilter = b.dataset.revfilter; state.revOpenId = null; renderRevisionList();
  });
  $$('[data-revtoggle]').forEach(b => b.onclick = () => {
    const id = b.dataset.revtoggle;
    state.revOpenId = state.revOpenId === id ? null : id;
    renderRevisionList();
  });
  $$('[data-markrevised]').forEach(b => b.onclick = (e) => { e.stopPropagation(); markRevised(b.dataset.markrevised); });
  $$('[data-editnote]').forEach(b => b.onclick = (e) => { e.stopPropagation(); openEditor(b.dataset.editnote); });
}

function revItemHTML(n){
  const age = ageLabel(n);
  const open = state.revOpenId === n.id;
  const folder = state.folders.find(f=>f.id===n.folderId);
  return `
    <div class="rev-item ${open?'open':''}" style="border-left-color:${folder?folder.color:'var(--art)'}">
      <div class="rev-head" data-revtoggle="${n.id}">
        <div class="t">${escapeHtml(n.title || 'Untitled')}</div>
        <span class="rev-age ${age.stale?'stale':''}">${age.text}</span>
      </div>
      <div class="rev-badges">
        ${(n.examTags||[]).map(t=>`<span class="badge ${badgeClass(t)}">${t}</span>`).join('')}
        ${folder ? `<span class="badge" style="background:var(--bg-elevated);color:var(--text-faint)">${escapeHtml(folder.name)}</span>` : ''}
      </div>
      ${open ? `
        <div class="rev-body">${n.content || '<span style="color:var(--text-faint)">Empty note</span>'}</div>
        <div class="rev-actions">
          <button class="mark" data-markrevised="${n.id}">✓ Mark revised</button>
          <button data-editnote="${n.id}">Edit note</button>
        </div>` : ''}
    </div>`;
}

async function markRevised(id){
  const n = state.notes.find(n=>n.id===id); if(!n) return;
  n.lastRevisedAt = Date.now();
  await DB.putNote(n);
  const folder = state.folders.find(f=>f.id===n.folderId);
  await logActivity('revise', folder ? folder.name : (n.tags||[])[0] || 'General');
  state.revOpenId = null;
  renderRevisionList();
  toast('Marked as revised');
}

/* ---- Activity chart ---- */
function activityWindow(){
  const days = state.actRange === 'week' ? 7 : 30;
  const out = [];
  for(let i=days-1; i>=0; i--){
    const d = addDays(new Date(), -i);
    out.push({ date: isoDate(d), d });
  }
  return out;
}

function renderActivity(){
  const win = activityWindow();
  const winSet = new Set(win.map(w=>w.date));
  const inWindow = state.activity.filter(a => winSet.has(a.date));

  const byDate = {};
  win.forEach(w => byDate[w.date] = { revise:0, task:0 });
  inWindow.forEach(a => { if(byDate[a.date]) byDate[a.date][a.type] = (byDate[a.date][a.type]||0) + 1; });

  const byTopic = {};
  inWindow.forEach(a => { byTopic[a.topic] = (byTopic[a.topic]||0) + 1; });
  const topics = Object.entries(byTopic).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const topMax = topics.length ? topics[0][1] : 1;

  const totalRev = inWindow.filter(a=>a.type==='revise').length;
  const totalTask = inWindow.filter(a=>a.type==='task').length;
  const activeDays = win.filter(w => byDate[w.date].revise + byDate[w.date].task > 0).length;

  $('#reviseBody').innerHTML = `
    <div class="planner-tabs">
      <button class="planner-tab ${state.actRange==='week'?'active':''}" data-actrange="week">Week</button>
      <button class="planner-tab ${state.actRange==='month'?'active':''}" data-actrange="month">Month</button>
    </div>

    <div class="rev-summary">
      <div class="rev-stat"><div class="v" style="color:var(--ecg)">${totalRev}</div><div class="k">revisions done</div></div>
      <div class="rev-stat"><div class="v" style="color:var(--spo2)">${totalTask}</div><div class="k">tasks completed</div></div>
      <div class="rev-stat"><div class="v">${activeDays}/${win.length}</div><div class="k">days studied</div></div>
    </div>

    <div class="chart-card">
      <h3>Daily activity</h3>
      <p class="hint">green = revisions · blue = tasks completed</p>
      ${dailyChartSVG(win, byDate)}
    </div>

    <div class="chart-card">
      <h3>Topic-wise breakdown</h3>
      <p class="hint">where your ${state.actRange === 'week' ? 'last 7 days' : 'last 30 days'} went</p>
      ${topics.length ? topics.map(([name,count],i)=>`
        <div class="topic-bar">
          <div class="lbl"><span>${escapeHtml(name)}</span><span class="c">${count}</span></div>
          <div class="track"><div class="fill" style="width:${Math.round(count/topMax*100)}%;background:${FOLDER_COLORS[i%FOLDER_COLORS.length]}"></div></div>
        </div>`).join('')
        : `<div style="color:var(--text-faint);font-size:12.5px;">No activity yet. Tick off a task or mark a note revised, and it shows up here.</div>`}
    </div>
  `;

  $$('[data-actrange]').forEach(b => b.onclick = () => { state.actRange = b.dataset.actrange; renderActivity(); });
}

function dailyChartSVG(win, byDate){
  const W = 100, H = 34, n = win.length;
  const gap = n > 10 ? 0.5 : 1.4;
  const bw = (W - gap*(n-1)) / n;
  const max = Math.max(1, ...win.map(w => byDate[w.date].revise + byDate[w.date].task));

  const bars = win.map((w,i)=>{
    const x = i*(bw+gap);
    const r = byDate[w.date].revise, t = byDate[w.date].task;
    const hr = (r/max)*(H-6), ht = (t/max)*(H-6);
    let out = '';
    if(t) out += `<rect x="${x}" y="${H-6-ht}" width="${bw}" height="${ht}" fill="var(--spo2)" rx="0.6"/>`;
    if(r) out += `<rect x="${x}" y="${H-6-ht-hr}" width="${bw}" height="${hr}" fill="var(--ecg)" rx="0.6"/>`;
    if(!r && !t) out += `<rect x="${x}" y="${H-6.7}" width="${bw}" height="0.7" fill="var(--line)" rx="0.35"/>`;
    return out;
  }).join('');

  // label every day for a week, every 5th for a month
  const step = n > 10 ? 5 : 1;
  const labels = win.map((w,i)=>{
    if(i % step !== 0 && i !== n-1) return '';
    const x = i*(bw+gap) + bw/2;
    const txt = n > 10 ? String(w.d.getDate()) : dowLabels()[dowIndex(w.d)][0];
    return `<text x="${x}" y="${H-1}" font-size="2.6" fill="var(--text-faint)" text-anchor="middle" font-family="monospace">${txt}</text>`;
  }).join('');

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}${labels}</svg>`;
}

/* ============================================================
   Phase 4 — Export & Share
   ============================================================ */

/* ---- helpers ---- */
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function safeFilename(s){
  return (s || 'note').replace(/[^\w\u0980-\u09FF -]+/g,'').trim().replace(/\s+/g,'-').slice(0,60) || 'note';
}
/* HTML -> plain text, keeping block/line breaks */
function richToText(html){
  const d = document.createElement('div');
  d.innerHTML = html || '';
  d.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  d.querySelectorAll('li').forEach(li => li.prepend(document.createTextNode('• ')));
  d.querySelectorAll('p,div,li,h1,h2,h3,h4,tr').forEach(el => el.append(document.createTextNode('\n')));
  return (d.textContent || '').replace(/\n{3,}/g,'\n\n').trim();
}

/* ---- full backup: export / import ---- */
async function exportBackup(){
  try{
    const data = await DB.exportAll();
    const stamp = new Date().toISOString().slice(0,10);
    const name = `anaesthesia-vault-backup-${stamp}.json`;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {type:'application/json'});

    // On a phone, hand the file to the share sheet so it can go straight
    // into Google Drive. On a laptop that isn't available, so download it.
    let shared = false;
    try{
      if(navigator.canShare && window.File){
        const file = new File([blob], name, {type:'application/json'});
        if(navigator.canShare({ files:[file] })){
          await navigator.share({ files:[file], title:'Anaesthesia Vault backup' });
          shared = true;
        }
      }
    }catch(err){
      // user cancelled the sheet, or the browser refused the file type
      if(err && err.name === 'AbortError') return;
      shared = false;
    }

    if(!shared) downloadBlob(blob, name);

    state.settings.lastBackupAt = Date.now();
    await saveSettings();
    if(state.mode === 'home') renderDashboard();
    renderSidebar();
    toast(`Backed up ${data.notes.length} notes`);
  }catch(err){
    toast('Backup failed');
  }
}

/* ---- backup reminder ---- */
function daysSinceBackup(){
  const t = state.settings.lastBackupAt;
  if(!t) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
function backupOverdue(){
  const every = Number(state.settings.backupReminderDays || 0);
  if(!every) return false;                    // reminders switched off
  if(state.notes.length === 0) return false;  // nothing worth backing up yet
  const d = daysSinceBackup();
  return d === null || d >= every;
}
function backupStatusText(){
  const d = daysSinceBackup();
  if(d === null) return 'never backed up';
  if(d === 0) return 'backed up today';
  if(d === 1) return 'backed up yesterday';
  return `backed up ${d} days ago`;
}

async function importBackup(file){
  let data;
  try{
    data = JSON.parse(await file.text());
  }catch{
    toast('That file is not a valid backup');
    return;
  }
  if(!data || (!Array.isArray(data.notes) && !Array.isArray(data.folders))){
    toast('That file is not an Anaesthesia Vault backup');
    return;
  }
  const counts = ['notes','folders','tasks','slots','activity']
    .map(k => `${(data[k]||[]).length} ${k}`).join(', ');
  if(!confirm(`Restore ${counts}?\n\nExisting items with the same id will be overwritten. Nothing else is deleted.`)) return;

  try{
    await DB.importAll({
      notes: data.notes||[], folders: data.folders||[], tasks: data.tasks||[],
      slots: data.slots||[], activity: data.activity||[]
    });
    state.notes    = await DB.getAllNotes();
    state.folders  = await DB.getAllFolders();
    state.tasks    = await DB.getAllTasks();
    state.slots    = await DB.getAllSlots();
    state.activity = await DB.getAllActivity();
    switchMode(state.mode);
    toast('Restore complete');
  }catch(err){
    toast('Restore failed');
  }
}

/* ---- share a single note ---- */
async function shareNote(){
  const n = currentNoteFromForm();
  if(!n) return;
  await flushSave(true);
  const text = `${n.title || 'Untitled'}\n\n${richToText(n.content)}`;
  if(navigator.share){
    try{ await navigator.share({ title: n.title || 'FCPS note', text }); }
    catch{ /* user cancelled — nothing to report */ }
    return;
  }
  try{
    await navigator.clipboard.writeText(text);
    toast('Note copied to clipboard');
  }catch{
    toast('Sharing is not supported on this browser');
  }
}

/* ---- print / save as PDF ---- */
async function printNote(){
  const n = currentNoteFromForm();
  if(!n) return;
  await flushSave(true);
  const folder = state.folders.find(f=>f.id===n.folderId);
  const badges = [...(n.examTags||[]), ...(n.tags||[]).map(t=>'#'+t)];

  $('#printArea').innerHTML = `
    <div class="p-head">
      <h1>${escapeHtml(n.title || 'Untitled')}</h1>
      <div class="p-meta">
        Anaesthesia Vault${folder ? ' · ' + escapeHtml(folder.name) : ''} · updated ${fmtDate(n.updatedAt)}
      </div>
      ${badges.length ? `<div class="p-badges">${badges.map(b=>`<span>${escapeHtml(b)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="p-body">${n.content || ''}</div>
    <div class="p-foot">Printed ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</div>
  `;
  window.print();
}

/* ---- render a note to JPEG on a canvas ---- */
function jpegNote(){
  const n = currentNoteFromForm();
  if(!n) return;
  flushSave(true);

  const W = 1080, PAD = 72;
  const title = n.title || 'Untitled';
  const body  = richToText(n.content);
  const folder = state.folders.find(f=>f.id===n.folderId);
  const badges = [...(n.examTags||[]), ...(n.tags||[]).map(t=>'#'+t)];

  // measure first on a scratch canvas, then draw at the real height
  const scratch = document.createElement('canvas').getContext('2d');
  const wrap = (text, font, maxW) => {
    scratch.font = font;
    const lines = [];
    for(const para of text.split('\n')){
      if(!para.trim()){ lines.push(''); continue; }
      let line = '';
      for(const word of para.split(/\s+/)){
        const test = line ? line + ' ' + word : word;
        if(scratch.measureText(test).width > maxW && line){ lines.push(line); line = word; }
        else line = test;
      }
      lines.push(line);
    }
    return lines;
  };

  const maxW = W - PAD*2;
  const F_TITLE = 'bold 46px Georgia, serif';
  const F_BODY  = '27px Georgia, serif';
  const titleLines = wrap(title, F_TITLE, maxW);
  const bodyLines  = body ? wrap(body, F_BODY, maxW) : [];

  const headerH = 96;
  const titleH  = titleLines.length * 58;
  const badgeH  = badges.length ? 56 : 12;
  const bodyH   = bodyLines.length * 42;
  const footH   = 84;
  const H = Math.max(720, headerH + titleH + badgeH + bodyH + footH + PAD);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  // background
  c.fillStyle = '#0A1622'; c.fillRect(0,0,W,H);

  // header: monitor + gas cylinders mark, then the wordmark
  const bx = PAD, by = 30;
  c.lineJoin = 'round'; c.lineCap = 'round';
  // monitor
  c.strokeStyle = '#22D3EE'; c.lineWidth = 3;
  c.beginPath();
  if(c.roundRect) c.roundRect(bx, by, 52, 30, 5); else c.rect(bx, by, 52, 30);
  c.stroke();
  // ECG trace inside it
  c.strokeStyle = '#39FF88'; c.lineWidth = 3;
  c.beginPath();
  [[5,17],[15,17],[19,9],[23,27],[27,12],[30,17],[47,17]].forEach(([x,y],i)=>{
    i ? c.lineTo(bx+x, by+y) : c.moveTo(bx+x, by+y);
  });
  c.stroke();
  // three gas cylinders
  [['#22D3EE',0],['#39FF88',17],['#FFD166',34]].forEach(([col,dx])=>{
    c.fillStyle = col;
    c.beginPath();
    if(c.roundRect) c.roundRect(bx+3+dx, by+36, 13, 22, 6.5); else c.rect(bx+3+dx, by+36, 13, 22);
    c.fill();
  });
  c.fillStyle = '#8FAEC4'; c.font = 'bold 22px Helvetica, Arial, sans-serif';
  c.fillText('ANAESTHESIA VAULT', bx + 70, by + 36);

  // title
  c.fillStyle = '#E8F1F8'; c.font = F_TITLE;
  let y = headerH + 46;
  titleLines.forEach(l => { c.fillText(l, PAD, y); y += 58; });

  // badges
  if(badges.length){
    y += 8;
    c.font = 'bold 20px Helvetica, Arial, sans-serif';
    let x = PAD;
    const palette = { 'Written':'#22D3EE','Viva':'#B79CFF','OSPE':'#FFD166','Long Case':'#39FF88',
                      'Short Case':'#FB5F76','Must-Know':'#FB5F76','High-Yield':'#FFD166','Hard Topic':'#B79CFF' };
    badges.forEach(b => {
      const w = c.measureText(b).width + 30;
      if(x + w > W - PAD){ x = PAD; y += 42; }
      const col = palette[b] || '#587489';
      c.strokeStyle = col; c.lineWidth = 1.5;
      c.beginPath();
      if(c.roundRect) c.roundRect(x, y - 22, w, 34, 17);
      else c.rect(x, y - 22, w, 34);   // older Safari has no roundRect
      c.stroke();
      c.fillStyle = col; c.fillText(b, x + 15, y);
      x += w + 10;
    });
    y += 48;
  } else { y += 12; }

  // body
  c.fillStyle = '#C9DCE9'; c.font = F_BODY;
  bodyLines.forEach(l => { c.fillText(l, PAD, y); y += 42; });

  // footer
  c.strokeStyle = '#1C3A54'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(PAD, H - 62); c.lineTo(W - PAD, H - 62); c.stroke();
  c.fillStyle = '#587489'; c.font = '20px Helvetica, Arial, sans-serif';
  c.fillText(`${folder ? folder.name + ' · ' : ''}${fmtDate(n.updatedAt)}`, PAD, H - 32);

  cv.toBlob(blob => {
    if(!blob){ toast('Could not create the image'); return; }
    downloadBlob(blob, `${safeFilename(title)}.jpg`);
    toast('JPEG downloaded');
  }, 'image/jpeg', 0.92);
}

/* ============================================================
   Phase 5 — Settings + Dashboard
   ============================================================ */

async function loadSettings(){
  const saved = await DB.getSetting('settings', null);
  if(saved) state.settings = Object.assign({}, state.settings, saved);
  else {
    // migrate the old binary theme setting from earlier versions
    const legacy = await DB.getSetting('theme', null);
    if(legacy === 'light') state.settings.theme = 'paper';
    else if(legacy === 'dark') state.settings.theme = 'icu';
  }
  applySettings();
}
async function saveSettings(){
  await DB.setSetting('settings', state.settings);
  applySettings();
}
function applySettings(){
  const s = state.settings;
  document.documentElement.setAttribute('data-theme', s.theme);
  document.documentElement.style.setProperty('--note-font', s.noteFont);
  document.documentElement.style.setProperty('--note-size', s.noteSize);
  document.documentElement.style.setProperty('--note-weight', s.noteWeight);
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = THEMES.find(t=>t.id===s.theme);
  if(meta && t) meta.setAttribute('content', t.sw[0]);
}

/* timetable slots used to be stored as a Saturday-first index;
   convert them once to absolute JS day numbers (0=Sun … 6=Sat) */
async function migrateSlots(){
  if(await DB.getSetting('slotsAbsoluteDays', false)) return;
  for(const s of state.slots){
    s.day = (s.day + 6) % 7;
    await DB.putSlot(s);
  }
  await DB.setSetting('slotsAbsoluteDays', true);
}

function openSettings(){
  const s = state.settings;
  $('#themeGrid').innerHTML = THEMES.map(t=>`
    <button class="theme-opt ${s.theme===t.id?'sel':''}" data-theme-id="${t.id}">
      <span class="swatches">${t.sw.map(c=>`<i style="background:${c}"></i>`).join('')}</span>
      <span class="nm">${t.name}</span>
      <span class="ty">${t.kind}</span>
    </button>`).join('');
  $('#setNoteFont').value  = s.noteFont;
  $('#setNoteSize').value  = s.noteSize;
  $('#setNoteWeight').value = s.noteWeight;
  $('#setExamDate').value  = s.examDate || '';
  $('#setWeekStart').value = String(s.weekStart);
  $('#setBackupEvery').value = String(s.backupReminderDays);
  $('#backupStatus').textContent = backupStatusText();

  $$('[data-theme-id]').forEach(b => b.onclick = async () => {
    state.settings.theme = b.dataset.themeId;
    await saveSettings();
    $$('[data-theme-id]').forEach(x => x.classList.toggle('sel', x.dataset.themeId===state.settings.theme));
  });
  $('#settingsModal').classList.add('show');
}

async function commitSettingsForm(){
  state.settings.noteFont  = $('#setNoteFont').value;
  state.settings.noteSize  = $('#setNoteSize').value;
  state.settings.noteWeight = $('#setNoteWeight').value;
  state.settings.examDate  = $('#setExamDate').value;
  state.settings.weekStart = Number($('#setWeekStart').value);
  state.settings.backupReminderDays = Number($('#setBackupEvery').value);
  await saveSettings();
  $('#settingsModal').classList.remove('show');
  switchMode(state.mode);
}

/* ---- Dashboard ---- */
function greeting(){
  const h = new Date().getHours();
  if(h < 12) return 'Good morning';
  if(h < 17) return 'Good afternoon';
  if(h < 21) return 'Good evening';
  return 'Late night';
}
function daysUntilExam(){
  if(!state.settings.examDate) return null;
  const exam = new Date(state.settings.examDate + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((exam - today) / 86400000);
}

function renderDashboard(){
  const todays = state.tasks.filter(t=>t.date===todayISO());
  const doneToday = todays.filter(t=>t.completed).length;

  const flagged = liveNotes().filter(n => (n.examTags||[]).some(t => FLAG_TAGS.includes(t)));
  const dueRevision = flagged.filter(n => { const d = daysSince(n.lastRevisedAt); return d === null || d >= 7; });

  const win = activityWindow();
  const winSet = new Set(win.map(w=>w.date));
  const wkAct = state.activity.filter(a => winSet.has(a.date));
  const byDate = {}; win.forEach(w => byDate[w.date] = { revise:0, task:0 });
  wkAct.forEach(a => { if(byDate[a.date]) byDate[a.date][a.type]++; });
  const daysStudied = win.filter(w => byDate[w.date].revise + byDate[w.date].task > 0).length;

  const pinned = liveNotes().filter(n=>n.pinned && !n.archived)
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));

  const recent = liveNotes().filter(n=>!n.archived)
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,5);

  const dLeft = daysUntilExam();
  let countdownHTML;
  if(dLeft === null){
    countdownHTML = `<button class="set-exam" id="dashSetExam">＋ Set your exam date to start the countdown</button>`;
  } else if(dLeft >= 0){
    countdownHTML = `<div class="countdown"><span class="d">${dLeft}</span><span class="l">${dLeft===1?'day':'days'} until your FCPS exam</span></div>`;
  } else {
    countdownHTML = `<div class="countdown"><span class="l">Exam date has passed — update it in settings.</span></div>`;
  }

  const showNag = backupOverdue() && !state.backupNagHidden;

  $('#dashContent').innerHTML = `
    ${showNag ? `<div class="backup-banner">
      <div class="txt"><b>Time to back up</b>Your notes live only on this device — ${backupStatusText()}. Save a copy to Google Drive so you can restore it on your other devices.</div>
      <button id="nagBackup">Back up now</button>
      <button class="later" id="nagLater">Later</button>
    </div>` : ''}

    <div class="hero">
      <div class="greet">${greeting()}</div>
      <div class="big">${todays.length ? `${doneToday} of ${todays.length} tasks done today` : 'No tasks planned for today'}</div>
      <div class="sub">${dueRevision.length ? `${dueRevision.length} topic${dueRevision.length===1?'':'s'} waiting to be revised` : 'Revision is up to date'}</div>
      ${countdownHTML}
    </div>

    <div class="stat-grid">
      <div class="stat" style="--c1:var(--ecg);--c2:var(--spo2)">
        <div class="v">${liveNotes().length}</div><div class="k">notes</div></div>
      <div class="stat" style="--c1:var(--art);--c2:var(--violet)">
        <div class="v">${dueRevision.length}</div><div class="k">due for revision</div></div>
      <div class="stat" style="--c1:var(--resp);--c2:var(--art)">
        <div class="v">${flagged.length}</div><div class="k">flagged high-yield</div></div>
      <div class="stat" style="--c1:var(--spo2);--c2:var(--violet)">
        <div class="v">${daysStudied}/7</div><div class="k">days studied</div></div>
    </div>

    <div class="dash-sec" style="--accent:var(--spo2)">
      <div class="hd"><h3>This week</h3><button data-goto="revise-activity">Full chart →</button></div>
      <div class="chart-card">${dailyChartSVG(win, byDate)}</div>
    </div>

    <div class="dash-sec" style="--accent:var(--ecg)">
      <div class="hd"><h3>Today's tasks</h3><button data-goto="planner">Open planner →</button></div>
      <div class="quick-add">
        <input type="text" id="dashQaTitle" placeholder="Add a task for today…">
        <button id="dashQaAdd">＋ Add</button>
      </div>
      ${todays.length ? todays
        .sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'))
        .slice(0,5).map(taskRowHTML).join('')
        : `<div style="color:var(--text-faint);font-size:12.5px;">Nothing planned — add one above.</div>`}
    </div>

    <div class="dash-sec" style="--accent:var(--art)">
      <div class="hd"><h3>Due for revision</h3><button data-goto="revise">See all →</button></div>
      ${dueRevision.length ? dueRevision.slice(0,5).map(n=>{
        const age = ageLabel(n);
        return `<div class="mini-note" data-open="${n.id}" style="border-left-color:var(--art)">
          <span class="t">${escapeHtml(n.title||'Untitled')}</span>
          <span class="m">${age.text}</span></div>`;
      }).join('') : `<div style="color:var(--text-faint);font-size:12.5px;">All caught up.</div>`}
    </div>

    ${pinned.length ? `<div class="dash-sec" style="--accent:var(--resp)">
      <div class="hd"><h3>Pinned notes</h3><button data-goto="pinned">See all →</button></div>
      ${pinned.slice(0,5).map(n=>{
        const f = state.folders.find(f=>f.id===n.folderId);
        return `<div class="mini-note" data-open="${n.id}" style="border-left-color:${f?f.color:'var(--resp)'}">
          <span class="t">${escapeHtml(n.title||'Untitled')}</span>
          <span class="m">${statusMeta(statusOf(n)).label}</span></div>`;
      }).join('')}
    </div>` : ''}

    <div class="dash-sec" style="--accent:var(--violet)">
      <div class="hd"><h3>Recent notes</h3><button data-goto="notes">All notes →</button></div>
      ${recent.length ? recent.map(n=>{
        const f = state.folders.find(f=>f.id===n.folderId);
        return `<div class="mini-note" data-open="${n.id}" style="border-left-color:${f?f.color:'var(--ecg)'}">
          <span class="t">${escapeHtml(n.title||'Untitled')}</span>
          <span class="m">${fmtDate(n.updatedAt)}</span></div>`;
      }).join('') : `<div style="color:var(--text-faint);font-size:12.5px;">No notes yet — create your first one.</div>`}
    </div>
  `;

  const dash = $('#dashContent');
  $$('[data-open]', dash).forEach(el => el.onclick = () => openEditor(el.dataset.open));
  $$('[data-toggle]', dash).forEach(b => b.onclick = (e) => { e.stopPropagation(); toggleTask(b.dataset.toggle); });
  $$('[data-deltask]', dash).forEach(b => b.onclick = (e) => { e.stopPropagation(); removeTask(b.dataset.deltask); });
  $$('[data-goto]', dash).forEach(b => b.onclick = () => {
    const g = b.dataset.goto;
    if(g==='planner'){ switchMode('planner'); switchPView('today'); }
    else if(g==='revise'){ switchMode('revise'); switchRView('list'); }
    else if(g==='revise-activity'){ switchMode('revise'); switchRView('activity'); }
    else if(g==='pinned'){ state.view='pinned'; state.tagFilter=null; state.statusFilter=null; switchMode('notes'); }
    else { state.view='all'; switchMode('notes'); }
  });
  if($('#dashSetExam')) $('#dashSetExam').onclick = openSettings;
  if($('#nagBackup')) $('#nagBackup').onclick = exportBackup;
  if($('#nagLater')) $('#nagLater').onclick = () => { state.backupNagHidden = true; renderDashboard(); };
  $('#dashQaAdd').onclick = async () => {
    const title = $('#dashQaTitle').value.trim();
    if(!title) return;
    await addTask({ title, date: todayISO(), time:'', topic:'' });
    renderDashboard();
  };
  $('#dashQaTitle').onkeydown = (e) => { if(e.key==='Enter') $('#dashQaAdd').click(); };
}


/* ---- insert a photo into the note, downscaled so the file stays small ---- */
function insertPhoto(file){
  return new Promise((resolve) => {
    if(!file.type.startsWith('image/')){ toast('That file is not an image'); return resolve(); }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let { width:w, height:h } = img;
        if(w > MAX || h > MAX){
          const r = Math.min(MAX/w, MAX/h);
          w = Math.round(w*r); h = Math.round(h*r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = cv.toDataURL('image/jpeg', 0.82);

        $('#editable').focus();
        document.execCommand('insertImage', false, dataUrl);
        // leave the caret on a fresh line under the photo so a caption can be typed
        document.execCommand('insertHTML', false, '<div><br></div>');
        scheduleSave();
        toast('Photo added — type your caption below it');
        resolve();
      };
      img.onerror = () => { toast('Could not read that image'); resolve(); };
      img.src = reader.result;
    };
    reader.onerror = () => { toast('Could not read that file'); resolve(); };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Editor ---------------- */
function openEditor(id){
  let note;
  if(id === 'new'){
    note = {
      id: uid(), title:'', content:'', folderId: state.view.startsWith('folder:') ? state.view.slice(7) : null,
      tags:[], examTags:[], status:'none', pinned:false, archived:false, trashed:false,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    state.notes.unshift(note);
    state.unsavedNewIds.add(note.id);
  } else {
    note = state.notes.find(n=>n.id===id);
  }
  if(!note) return;
  state.editingId = note.id;

  $('#titleInput').value = note.title || '';
  $('#editable').innerHTML = note.content || '';
  $('#folderSelect').innerHTML =
    `<option value="">No folder</option>` +
    state.folders.map(f=>`<option value="${f.id}" ${f.id===note.folderId?'selected':''}>${escapeHtml(f.name)}</option>`).join('');
  $('#tagsInput').value = (note.tags||[]).join(', ');
  $('#statusSelect').innerHTML = STATUSES.map(st =>
    `<option value="${st.id}" ${statusOf(note)===st.id?'selected':''}>${st.label}</option>`).join('');

  $$('.exam-tag-btn').forEach(b=>{
    b.classList.toggle('on', (note.examTags||[]).includes(b.dataset.tag));
  });

  $('#editorOverlay').classList.add('show');
  $('#autosaveFlag').textContent = 'Ready';
  setTimeout(()=> $('#titleInput').focus(), 50);
}

function isFormEmpty(){
  const title = $('#titleInput').value.trim();
  const body = plainText($('#editable').innerHTML).trim();
  const tags = $('#tagsInput').value.trim();
  const exam = $$('.exam-tag-btn.on').length;
  return !title && !body && !tags && !exam;
}

function closeEditor(){
  const id = state.editingId;
  if(id && state.unsavedNewIds.has(id) && isFormEmpty()){
    // discard the never-saved blank note instead of littering the store
    state.notes = state.notes.filter(n => n.id !== id);
    state.unsavedNewIds.delete(id);
  } else {
    flushSave(true);
  }
  $('#editorOverlay').classList.remove('show');
  state.editingId = null;
  if(state.mode === 'revise') renderReviseBody();
  else if(state.mode === 'home') renderDashboard();
  else { renderSidebar(); renderGrid(); }
}

function currentNoteFromForm(){
  const n = state.notes.find(n=>n.id===state.editingId);
  if(!n) return null;
  n.title = $('#titleInput').value;
  n.content = $('#editable').innerHTML;
  n.folderId = $('#folderSelect').value || null;
  n.tags = $('#tagsInput').value.split(',').map(t=>t.trim()).filter(Boolean);
  n.status = $('#statusSelect').value;
  n.examTags = $$('.exam-tag-btn.on').map(b=>b.dataset.tag);
  n.updatedAt = Date.now();
  return n;
}

function scheduleSave(){
  $('#autosaveFlag').textContent = 'Editing…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(()=>flushSave(false), 700);
}
async function flushSave(silent){
  const n = currentNoteFromForm();
  if(!n) return;
  await DB.putNote(n);
  state.unsavedNewIds.delete(n.id);
  if(!silent) $('#autosaveFlag').textContent = 'Saved just now';
  const idx = state.notes.findIndex(x=>x.id===n.id);
  if(idx>=0) state.notes[idx] = n;
}

/* ---------------- Toolbar ---------------- */
function bindToolbar(){
  $$('[data-cmd]').forEach(btn => btn.onclick = () => {
    document.execCommand(btn.dataset.cmd, false, null);
    $('#editable').focus();
    scheduleSave();
  });
  $('#imgBtn').onclick = () => $('#imgFile').click();
  $('#imgFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if(f) await insertPhoto(f);
  };
  $('#markBtn').onclick = () => {
    document.execCommand('hiliteColor', false, '#FFD166');
    $('#editable').focus();
    scheduleSave();
  };
  $('#fontFamily').onchange = (e) => {
    document.execCommand('fontName', false, e.target.value);
    $('#editable').focus(); scheduleSave();
  };
  $('#fontSize').onchange = (e) => {
    document.execCommand('fontSize', false, e.target.value);
    $('#editable').focus(); scheduleSave();
  };
  $('#fontColor').oninput = (e) => {
    document.execCommand('foreColor', false, e.target.value);
    $('#editable').focus(); scheduleSave();
  };
}

/* ---------------- Folder modal ---------------- */
function openFolderModal(){
  $('#folderNameInput').value = '';
  $('#colorRow').innerHTML = FOLDER_COLORS.map((c,i)=>
    `<span class="color-swatch ${i===0?'sel':''}" style="background:${c}" data-color="${c}"></span>`).join('');
  $$('.color-swatch').forEach(s => s.onclick = () => {
    $$('.color-swatch').forEach(x=>x.classList.remove('sel'));
    s.classList.add('sel');
  });
  $('#folderModal').classList.add('show');
  setTimeout(()=>$('#folderNameInput').focus(),50);
}
async function saveFolderModal(){
  const name = $('#folderNameInput').value.trim();
  if(!name) return;
  const selSwatch = $('.color-swatch.sel');
  const color = selSwatch ? selSwatch.dataset.color : FOLDER_COLORS[0];
  const folder = { id: uid(), name, color, createdAt: Date.now() };
  await DB.putFolder(folder);
  state.folders.push(folder);
  $('#folderModal').classList.remove('show');
  renderSidebar();
}

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg){
  const el = $('#toast');
  el.innerHTML = `<span class="dot"></span>${escapeHtml(msg)}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'), 2200);
}

/* ---------------- Global events ---------------- */
function bindGlobalEvents(){
  $('#newNoteBtn').onclick = () => openEditor('new');
  $('#closeEditorBtn').onclick = closeEditor;
  $('#titleInput').oninput = scheduleSave;
  $('#editable').oninput = scheduleSave;
  $('#folderSelect').onchange = scheduleSave;
  $('#tagsInput').oninput = scheduleSave;
  $('#statusSelect').onchange = scheduleSave;
  $$('.exam-tag-btn').forEach(b => b.onclick = () => { b.classList.toggle('on'); scheduleSave(); });

  $('#trashFromEditor').onclick = async () => {
    if(!state.editingId) return;
    await moveToTrash(state.editingId);
    closeEditor();
  };

  $('#searchInput').oninput = (e) => { state.query = e.target.value; renderGrid(); };

  $('#settingsBtn').onclick = openSettings;
  $('#settingsClose').onclick = commitSettingsForm;

  $('#menuToggle').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
  $('#scrim').onclick = closeSidebarMobile;

  $('#folderModalCancel').onclick = () => $('#folderModal').classList.remove('show');
  $('#folderModalSave').onclick = saveFolderModal;

  $('#modeHomeBtn').onclick = () => switchMode('home');
  $('#modeNotesBtn').onclick = () => switchMode('notes');
  $('#modePlannerBtn').onclick = () => switchMode('planner');
  $('#modeReviseBtn').onclick = () => switchMode('revise');
  $$('.planner-tab[data-pview]').forEach(b => b.onclick = () => switchPView(b.dataset.pview));
  $$('.revise-tab').forEach(b => b.onclick = () => switchRView(b.dataset.rview));

  $('#taskModalCancel').onclick = () => $('#taskModal').classList.remove('show');
  $('#taskModalSave').onclick = saveTaskModal;
  $('#taskTitleInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveTaskModal(); });

  $('#slotModalCancel').onclick = () => $('#slotModal').classList.remove('show');
  $('#slotModalSave').onclick = saveSlotModal;

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){
      if($('#editorOverlay').classList.contains('show')) closeEditor();
      $('#folderModal').classList.remove('show');
      $('#taskModal').classList.remove('show');
      $('#slotModal').classList.remove('show');
      if($('#settingsModal').classList.contains('show')) commitSettingsForm();
    }
  });

  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = async (e) => {
    const f = e.target.files[0];
    if(f) await importBackup(f);
    e.target.value = '';
  };

  $('#shareNoteBtn').onclick = shareNote;
  $('#jpegNoteBtn').onclick = jpegNote;
  $('#pdfNoteBtn').onclick = printNote;

  bindToolbar();
}
function closeSidebarMobile(){
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('show');
}

/* ---------------- Icons (inline SVG, stroke = currentColor) ---------------- */
function icon(name, size=16){
  const s = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const paths = {
    grid: `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`,
    pin: `<path d="M12 17v5"/><path d="M9 3h6l1 6 3 2v2H5v-2l3-2 1-6Z"/>`,
    archive: `<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/>`,
    trash: `<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/>`,
    plus: `<path d="M12 5v14"/><path d="M5 12h14"/>`,
    x: `<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`,
    undo: `<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-6.7L3 9"/>`,
    inbox: `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>`,
    search: `<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>`,
    menu: `<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>`,
    check: `<path d="M20 6 9 17l-5-5"/>`,
    chevL: `<path d="M15 18l-6-6 6-6"/>`,
    chevR: `<path d="M9 18l6-6-6-6"/>`,
  };
  return `<svg ${s}>${paths[name]||''}</svg>`;
}

/* ---------------- Startup safety net ----------------
   If anything fails (old browser, blocked storage, in-app browser),
   say so plainly instead of showing a dead screen. */
function fatalScreen(title, detail){
  document.body.innerHTML =
    '<div style="max-width:520px;margin:12vh auto;padding:28px;font-family:system-ui,sans-serif;' +
    'color:#E8F1F8;background:#12283F;border:1px solid #1C3A54;border-radius:16px;line-height:1.6">' +
    '<div style="font-size:19px;font-weight:800;margin-bottom:10px">' + title + '</div>' +
    '<div style="font-size:14px;color:#8FAEC4">' + detail + '</div></div>';
}

function storageAvailable(){
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
  catch(e){ return false; }
}

window.addEventListener('error', function(e){
  if(!document.querySelector('.app')) return;
  console.error('Anaesthesia Vault error:', e.error || e.message);
});

if(!storageAvailable()){
  fatalScreen('This browser can\'t store your notes',
    'Open this page in Chrome or Safari directly (not inside WhatsApp, Facebook or another app\u2019s built-in browser), ' +
    'then use the browser menu to Add to Home Screen.');
} else {
  boot().catch(function(err){
    console.error(err);
    fatalScreen('Something went wrong starting the app',
      'Please open this link in an up-to-date Chrome or Safari. If it keeps happening, note down which phone and browser you are using.<br><br>' +
      '<span style="font-family:monospace;font-size:12px;opacity:.7">' + (err && err.message ? err.message : err) + '</span>');
  });
}
