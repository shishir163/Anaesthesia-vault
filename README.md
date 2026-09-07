# Anaesthesia Vault — Phases 1–6

Offline, installable notes + study-planner app for FCPS Anaesthesia exam prep (Written / Viva / OSPE / Long Case / Short Case).
Pure HTML/CSS/JS — no build step, no server, no dependencies. All data is stored locally on your device (IndexedDB), so it works fully offline once installed.

## Phase 1 — Notes
- Colourful dashboard (ICU-monitor inspired theme), dark/light mode
- New note editor: bold, italic, underline, highlighter, font family/size/colour
- Autosave while typing
- Folders (colour-coded) + free-text tags
- FCPS tags: Written, Viva, OSPE, Long Case, Short Case, Must-Know, High-Yield, Hard Topic
- Pin / Archive / Trash (with restore + permanent delete)
- Search across title, content, tags
- Installable as an app (PWA) — works offline after first load

## Phase 2 — Study Planner
Switch to "🗓 Planner" in the sidebar. Week runs Saturday → Friday (BD convention).
- **Today** — quick-add checklist for today's tasks, with a completion progress bar
- **Week** — 7-day board (Sat–Fri), add a task to any day, tick off as you go, jump to next/previous week
- **Month** — full calendar grid with dot-indicators on days that have tasks; tap a date to see/add its tasks
- **Timetable** — your recurring weekly study routine (day + time-slot + subject), set once, reused every week

## Phase 3 — Revision system
Switch to "🔥 Revise" in the sidebar.
- **Revision list** — every note tagged Must-Know / High-Yield / Hard Topic in one place, sorted oldest-revision-first so what you've neglected sits at the top. Filter by any exam tag (Written, Viva, OSPE, Long/Short Case). Tap a note to read it inline without leaving the list, then hit **✓ Mark revised**.
- Each row shows how long since you last revised it ("never revised", "revised 3d ago"); anything 7+ days old turns red.
- **Activity** — daily bar chart (revisions in green, completed tasks in blue) over the last 7 or 30 days, plus a topic-wise breakdown showing where your study time actually went, and a days-studied count.

## Phase 4 — Export & Share
- **Backup / Restore** — buttons at the bottom of the sidebar. Backup downloads a single `.json` file containing every note, folder, task, timetable slot and activity record. Restore reads that file back in — matching items are overwritten, nothing else is deleted. This is also how you move your data between phone and desktop.
- **Per-note export** — open any note; the footer has three buttons:
  - **📤 Share** — opens your phone's share sheet (WhatsApp, email, etc.); on desktop it copies the note to the clipboard.
  - **🖼 JPEG** — renders the note as a branded image card you can send or drop into slides.
  - **📄 PDF** — opens the print dialog with a clean paper layout (serif text, highlights preserved). Choose "Save as PDF" — on iPhone, Share → Print → pinch out to save.

## Phase 5 — Dashboard & Settings
- **🏠 Home** is now the landing screen: greeting, exam-date countdown, today's task progress, how many topics are due for revision, a week activity chart, quick-add task box, due-revision list and recent notes. Every section links straight through to the full view.
- **⚙ Settings** (top right) — pick from 7 themes (3 dark: ICU Monitor, Midnight, Carbon; 4 light: Paper, Citrus, Mint, Blossom), set the default note font and text size, set your exam date for the countdown, and choose whether the week starts Saturday, Sunday or Monday.

## Phase 6 — Status, photos & polish
- Renamed to **Anaesthesia Vault**.
- **Note status** — every note is Not started / Due / Partial / Completed. Set it in the editor; filter by it from the Notes sidebar; each card shows a coloured dot.
- **Photos in notes** — 🖼 button in the editor toolbar. Insert an ECG (or any image) and type your caption on the line underneath. Images are auto-resized to max 1200px so the app and your backups stay small.
- **Lato font** — added to Settings, along with a Regular/Bold weight option that applies to all note text.
- **Fuller sidebar** — Home, Planner and Revise each get their own sidebar now (shortcuts, counts, filters) instead of empty space.
- **Colourful dashboard** — gradient stat cards, accent-striped section headers, and a new **Pinned notes** section.

## Run it locally (before deploying)
You can't just double-click `index.html` — service workers need a server. From this folder:
```
python3 -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

## Deploy to GitHub Pages
1. Create a new GitHub repo (e.g. `anaesthesia-vault`).
2. Upload everything in this folder (`index.html`, `manifest.json`, `sw.js`, `icons/`) to the repo root.
3. Go to **Settings → Pages** → Source: **Deploy from branch** → Branch: `main`, folder: `/ (root)` → Save.
4. Wait ~1 minute, then your app is live at `https://<your-username>.github.io/anaesthesia-vault/`.
5. Open that link on your phone → browser menu → **Add to Home Screen** (or the install icon on desktop Chrome).

## Editing the source
`index.html` is a generated bundle. Edit the files in `src/` (`shell.html`, `style.css`, `db.js`, `app.js`), then run `python3 build.py` to regenerate `index.html`. Only `index.html`, `manifest.json`, `sw.js` and `icons/` need to be deployed.

Your notes, tasks and activity live in IndexedDB inside the browser profile you use. Phone and desktop copies do not sync automatically — use **Backup** on one device and **Restore** on the other to move data across.
