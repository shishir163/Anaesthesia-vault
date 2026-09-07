/* ============================================================
   db.js — tiny IndexedDB wrapper (no external libs, fully offline)
   Stores: notes, folders, settings
   ============================================================ */

const DB_NAME = 'fcps_prep_vault';
const DB_VERSION = 3;
let _db = null;

function openDB(){
  return new Promise((resolve, reject) => {
    if(_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if(!db.objectStoreNames.contains('notes')){
        const notes = db.createObjectStore('notes', { keyPath:'id' });
        notes.createIndex('folderId', 'folderId');
        notes.createIndex('updatedAt', 'updatedAt');
        notes.createIndex('pinned', 'pinned');
        notes.createIndex('archived', 'archived');
        notes.createIndex('trashed', 'trashed');
      }
      if(!db.objectStoreNames.contains('folders')){
        db.createObjectStore('folders', { keyPath:'id' });
      }
      if(!db.objectStoreNames.contains('settings')){
        db.createObjectStore('settings', { keyPath:'key' });
      }
      if(!db.objectStoreNames.contains('tasks')){
        const tasks = db.createObjectStore('tasks', { keyPath:'id' });
        tasks.createIndex('date', 'date');
      }
      if(!db.objectStoreNames.contains('slots')){
        const slots = db.createObjectStore('slots', { keyPath:'id' });
        slots.createIndex('day', 'day');
      }
      if(!db.objectStoreNames.contains('activity')){
        const act = db.createObjectStore('activity', { keyPath:'id' });
        act.createIndex('date', 'date');
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode='readonly'){
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  // ---- notes ----
  async putNote(note){
    const store = await tx('notes','readwrite');
    return new Promise((res,rej)=>{
      const r = store.put(note);
      r.onsuccess = ()=>res(note);
      r.onerror = ()=>rej(r.error);
    });
  },
  async getAllNotes(){
    const store = await tx('notes');
    return new Promise((res,rej)=>{
      const r = store.getAll();
      r.onsuccess = ()=>res(r.result || []);
      r.onerror = ()=>rej(r.error);
    });
  },
  async getNote(id){
    const store = await tx('notes');
    return new Promise((res,rej)=>{
      const r = store.get(id);
      r.onsuccess = ()=>res(r.result || null);
      r.onerror = ()=>rej(r.error);
    });
  },
  async deleteNoteHard(id){
    const store = await tx('notes','readwrite');
    return new Promise((res,rej)=>{
      const r = store.delete(id);
      r.onsuccess = ()=>res(true);
      r.onerror = ()=>rej(r.error);
    });
  },

  // ---- folders ----
  async putFolder(folder){
    const store = await tx('folders','readwrite');
    return new Promise((res,rej)=>{
      const r = store.put(folder);
      r.onsuccess = ()=>res(folder);
      r.onerror = ()=>rej(r.error);
    });
  },
  async getAllFolders(){
    const store = await tx('folders');
    return new Promise((res,rej)=>{
      const r = store.getAll();
      r.onsuccess = ()=>res(r.result || []);
      r.onerror = ()=>rej(r.error);
    });
  },
  async deleteFolder(id){
    const store = await tx('folders','readwrite');
    return new Promise((res,rej)=>{
      const r = store.delete(id);
      r.onsuccess = ()=>res(true);
      r.onerror = ()=>rej(r.error);
    });
  },

  // ---- settings (theme, last active view, etc.) ----
  async getSetting(key, fallback=null){
    const store = await tx('settings');
    return new Promise((res,rej)=>{
      const r = store.get(key);
      r.onsuccess = ()=>res(r.result ? r.result.value : fallback);
      r.onerror = ()=>rej(r.error);
    });
  },
  async setSetting(key, value){
    const store = await tx('settings','readwrite');
    return new Promise((res,rej)=>{
      const r = store.put({ key, value });
      r.onsuccess = ()=>res(true);
      r.onerror = ()=>rej(r.error);
    });
  },

  // ---- tasks (Today / Week / Month planner) ----
  async putTask(task){
    const store = await tx('tasks','readwrite');
    return new Promise((res,rej)=>{
      const r = store.put(task);
      r.onsuccess = ()=>res(task);
      r.onerror = ()=>rej(r.error);
    });
  },
  async getAllTasks(){
    const store = await tx('tasks');
    return new Promise((res,rej)=>{
      const r = store.getAll();
      r.onsuccess = ()=>res(r.result || []);
      r.onerror = ()=>rej(r.error);
    });
  },
  async deleteTask(id){
    const store = await tx('tasks','readwrite');
    return new Promise((res,rej)=>{
      const r = store.delete(id);
      r.onsuccess = ()=>res(true);
      r.onerror = ()=>rej(r.error);
    });
  },

  // ---- weekly timetable slots ----
  async putSlot(slot){
    const store = await tx('slots','readwrite');
    return new Promise((res,rej)=>{
      const r = store.put(slot);
      r.onsuccess = ()=>res(slot);
      r.onerror = ()=>rej(r.error);
    });
  },
  async getAllSlots(){
    const store = await tx('slots');
    return new Promise((res,rej)=>{
      const r = store.getAll();
      r.onsuccess = ()=>res(r.result || []);
      r.onerror = ()=>rej(r.error);
    });
  },
  async deleteSlot(id){
    const store = await tx('slots','readwrite');
    return new Promise((res,rej)=>{
      const r = store.delete(id);
      r.onsuccess = ()=>res(true);
      r.onerror = ()=>rej(r.error);
    });
  },

  // ---- activity log (drives the study activity chart) ----
  async putActivity(entry){
    const store = await tx('activity','readwrite');
    return new Promise((res,rej)=>{
      const r = store.put(entry);
      r.onsuccess = ()=>res(entry);
      r.onerror = ()=>rej(r.error);
    });
  },
  async getAllActivity(){
    const store = await tx('activity');
    return new Promise((res,rej)=>{
      const r = store.getAll();
      r.onsuccess = ()=>res(r.result || []);
      r.onerror = ()=>rej(r.error);
    });
  },

  // ---- bulk import / export ----
  async exportAll(){
    const [notes, folders, tasks, slots, activity] = await Promise.all([
      DB.getAllNotes(), DB.getAllFolders(), DB.getAllTasks(), DB.getAllSlots(), DB.getAllActivity()
    ]);
    return { app:'anaesthesia-vault', version:1, exportedAt:new Date().toISOString(),
             notes, folders, tasks, slots, activity };
  },

  async importAll({notes=[], folders=[], tasks=[], slots=[], activity=[]}){
    const db = await openDB();
    return new Promise((res, rej) => {
      const t = db.transaction(['notes','folders','tasks','slots','activity'], 'readwrite');
      t.oncomplete = () => res(true);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
      notes.forEach(n => t.objectStore('notes').put(n));
      folders.forEach(f => t.objectStore('folders').put(f));
      tasks.forEach(x => t.objectStore('tasks').put(x));
      slots.forEach(s => t.objectStore('slots').put(s));
      activity.forEach(a => t.objectStore('activity').put(a));
    });
  }
};
