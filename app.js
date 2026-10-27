'use strict';
// Gym – Hannes' Trainings-App. Daten bleiben auf dem Gerät (localStorage + IndexedDB für Fotos).

const VERSION = '1.2.1';
const KEY = 'gym.v1';
const MUSCLES = ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Beine vorne', 'Beine hinten', 'Waden', 'Bauch'];
const LEG_MUSCLES = ['Beine vorne', 'Beine hinten', 'Waden'];
// Ziel: harte Sätze pro Woche je Muskel (passt zu Plan 3+1 Tage)
const WEEK_TARGET = { 'Brust': 9, 'Rücken': 9, 'Schultern': 9, 'Bizeps': 6, 'Trizeps': 6, 'Beine vorne': 6, 'Beine hinten': 6, 'Waden': 3, 'Bauch': 3 };

const DEFAULT_EX = [
  ['bank', 'Bankdrücken (Langhantel)', 'Brust'], ['schraeg', 'Schrägbankdrücken Kurzhantel', 'Brust'],
  ['sdrueck', 'Schulterdrücken Kurzhantel', 'Schultern'], ['seitkabel', 'Seitheben am Kabelturm', 'Schultern'],
  ['pushdown', 'Trizeps nach unten (Pushdown)', 'Trizeps'], ['ueberkopf', 'Trizeps über Kopf (Kabel)', 'Trizeps'],
  ['latzug', 'Latzug breit', 'Rücken'], ['tbar', 'T-Bar-Rudern', 'Rücken'], ['rudereng', 'Rudern eng am Kabel', 'Rücken'],
  ['revfly', 'Reverse Butterfly', 'Schultern'], ['hammer', 'Hammer Curls', 'Bizeps'], ['spider', 'Spider Curls', 'Bizeps'],
  ['presse', 'Beinpresse', 'Beine vorne'], ['rdl', 'Rumänisches Kreuzheben (RDL)', 'Beine hinten'],
  ['beuger', 'Beinbeuger', 'Beine hinten'], ['strecker', 'Beinstrecker', 'Beine vorne'], ['waden', 'Wadenheben', 'Waden'],
  ['crunch', 'Cable Crunch', 'Bauch'], ['hack', 'Hackenschmidt', 'Beine vorne'], ['schraegfly', 'Schrägbank-Butterfly', 'Brust'],
  ['seitkh', 'Seitheben Kurzhantel', 'Schultern'], ['lateinarm', 'Latzug einarmig', 'Rücken'], ['preacher', 'Preacher Curls', 'Bizeps'],
  ['beinheben', 'Beinheben hängend', 'Bauch'], ['brustpresse', 'Brustpresse', 'Brust'], ['butterfly', 'Butterfly', 'Brust'],
  ['klimmzug', 'Klimmzüge', 'Rücken'], ['kniebeuge', 'Kniebeuge', 'Beine vorne'], ['adduktor', 'Adduktoren', 'Beine hinten'],
  ['rueckenstr', 'Rückenstrecker', 'Rücken'], ['bizcurl', 'Bizeps Curls', 'Bizeps'], ['wrist', 'Wrist Curls (Unterarme)', 'Bizeps'],
].map(([id, name, muscle]) => ({ id, name, muscle }));

const DEFAULT_PLAN = [
  { id: 'push', name: 'Push', icon: '💥', core: true, items: [['bank', '3 × 6-8'], ['schraeg', '3 × 8-10'], ['sdrueck', '3 × 8-10'], ['seitkabel', '3 × 12-15'], ['pushdown', '3 × 10-12'], ['ueberkopf', '3 × 10-12']] },
  { id: 'pull', name: 'Pull', icon: '🪝', core: true, items: [['latzug', '3 × 8-10'], ['tbar', '3 × 8-10'], ['rudereng', '3 × 10-12'], ['revfly', '3 × 12-15'], ['hammer', '3 × 10-12'], ['spider', '3 × 10-12']] },
  { id: 'beine', name: 'Beine', icon: '🦵', core: true, items: [['presse', '3 × 8-10'], ['rdl', '3 × 8-10'], ['beuger', '3 × 10-12'], ['strecker', '3 × 12-15'], ['waden', '3 × 12-15'], ['crunch', '3 × 12-15']] },
  { id: 'schwach', name: 'Schwächen', icon: '🎯', core: false, items: [['hack', '3 × 8-10'], ['schraegfly', '3 × 10-12'], ['seitkh', '4 × 12-15'], ['lateinarm', '3 × 8-12'], ['preacher', '3 × 10-12'], ['beinheben', '3 × max']] },
];

// ---------- Speicher ----------
function freshState() {
  return { v: 1, exercises: structuredClone(DEFAULT_EX), plan: structuredClone(DEFAULT_PLAN), sessions: [], weekPlan: {}, bodyweight: [], current: null,
    settings: { rest: 90, benchGoal: 100, benchEx: 'bank', weekGoal: 3, bar: 20 } };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || freshState(); } catch (e) { S = freshState(); }
// fehlende Felder nach Updates ergänzen
S = Object.assign(freshState(), S); S.settings = Object.assign(freshState().settings, S.settings);
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen!'); } }

// Fotos in IndexedDB
const DB = { db: null,
  open() { return this.db ? Promise.resolve(this.db) : new Promise((ok, no) => {
    const r = indexedDB.open('gym-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'id' });
    r.onsuccess = () => { this.db = r.result; ok(this.db); }; r.onerror = () => no(r.error); }); },
  async tx(mode, fn) { const db = await this.open(); return new Promise((ok, no) => {
    const t = db.transaction('p', mode); const st = t.objectStore('p'); const res = fn(st);
    t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res); t.onerror = () => no(t.error); }); },
  all() { return this.tx('readonly', s => s.getAll()); },
  put(p) { return this.tx('readwrite', s => s.put(p)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};

// ---------- Helfer ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ex = id => S.exercises.find(e => e.id === id) || { id, name: id, muscle: 'Brust' };
const day = id => S.plan.find(d => d.id === id);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const fmtDate = s => parseYmd(s).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const e1rm = (w, r) => r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30); // Epley
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
function mondayOf(d) { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x; }
function weekKey(s) { return ymd(mondayOf(parseYmd(s))); }
const workSets = sess => sess.entries.flatMap(en => en.sets.filter(st => st.done && !st.warm && st.r > 0).map(st => ({ ...st, exId: en.exId })));
const volume = sess => workSets(sess).reduce((a, s) => a + (s.w || 0) * s.r, 0);
const sorted = () => [...S.sessions].sort((a, b) => a.date.localeCompare(b.date) || (a.start || 0) - (b.start || 0));
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

// Bestwerte je Übung (ohne eine bestimmte Einheit, für Rekord-Erkennung)
function bests(exId, skipSessId) {
  let w = 0, e = 0, r = 0;
  for (const s of S.sessions) { if (s.id === skipSessId) continue;
    for (const en of s.entries) if (en.exId === exId) for (const st of en.sets) if (st.done && !st.warm) {
      w = Math.max(w, st.w || 0); e = Math.max(e, e1rm(st.w || 0, st.r)); r = Math.max(r, st.r); } }
  return { w, e, r };
}
// Rekorde für alle Einheiten neu berechnen (nach Löschen, Bearbeiten, Import, Beispieldaten)
function recomputePRs() {
  const best = {};
  for (const s of sorted()) { s.prs = 0;
    for (const en of s.entries) for (const st of en.sets) { st.pr = false; if (!st.done || st.warm) continue;
      const b = best[en.exId]; const e = e1rm(st.w || 0, st.r);
      if (b && (e > b.e + 0.01 || (st.w || 0) > b.w)) { st.pr = true; s.prs++; }
      best[en.exId] = { e: Math.max(b ? b.e : 0, e), w: Math.max(b ? b.w : 0, st.w || 0) }; } }
}
function lastEntry(exId, skipSessId) {
  const list = sorted().reverse();
  for (const s of list) { if (s.id === skipSessId) continue; const en = s.entries.find(x => x.exId === exId);
    if (en && en.sets.some(x => x.done)) return { date: s.date, sets: en.sets.filter(x => x.done && !x.warm) }; }
  return null;
}
// Doppelte Progression: obere Wdh in allen Sätzen geschafft → mehr Gewicht
function progressHint(exId, target) {
  const last = lastEntry(exId); if (!last || !last.sets.length) return '';
  const m = /(\d+)\s*-\s*(\d+)/.exec(target || ''); if (!m) return '';
  const hi = +m[2], lo = +m[1];
  const all = last.sets.every(s => s.r >= hi);
  const w = Math.max(...last.sets.map(s => s.w || 0));
  if (all) { const step = w >= 40 ? 2.5 : 1.25; return `⬆️ Letztes Mal alle Sätze ${hi}+ Wdh → heute ${fmtNum(w + step)} kg (schon eingetragen)`; }
  const minR = Math.min(...last.sets.map(s => s.r));
  if (minR < lo) return `↔️ Letztes Mal unter ${lo} Wdh → Gewicht halten (${fmtNum(w)} kg), sauber mehr Wdh holen`;
  return `➡️ ${fmtNum(w)} kg halten, Ziel: in jedem Satz ${hi} Wdh`;
}

// ---------- Analyse ----------
function nextDay() {
  const planned = S.weekPlan[today()]; if (planned && day(planned) && !S.sessions.some(s => s.date === today() && s.dayId === planned)) return day(planned);
  const core = S.plan.filter(d => d.core);
  const last = sorted().reverse().find(s => core.some(c => c.id === s.dayId));
  if (!last) return core[0];
  const i = core.findIndex(c => c.id === last.dayId);
  // Schwächen-Tag vorschlagen, wenn diese Woche alle Pflichttage geschafft sind
  const wk = weekKey(today());
  const doneCore = new Set(S.sessions.filter(s => weekKey(s.date) === wk).map(s => s.dayId));
  if (core.every(c => doneCore.has(c.id)) && !doneCore.has('schwach') && day('schwach')) return day('schwach');
  return core[(i + 1) % core.length];
}
function lastLegDay() {
  const s = sorted().reverse().find(x => workSets(x).some(st => LEG_MUSCLES.includes(ex(st.exId).muscle)));
  return s ? s.date : null;
}
function muscleSets(fromYmd, toYmd) {
  const m = Object.fromEntries(MUSCLES.map(x => [x, 0]));
  for (const s of S.sessions) if (s.date >= fromYmd && s.date <= toYmd) for (const st of workSets(s)) m[ex(st.exId).muscle] = (m[ex(st.exId).muscle] || 0) + 1;
  return m;
}
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function weakest(days = 14) {
  const m = muscleSets(addDays(today(), -days + 1), today()); const f = days / 7;
  return MUSCLES.map(k => ({ k, pct: m[k] / (WEEK_TARGET[k] * f) })).sort((a, b) => a.pct - b.pct);
}
function e1rmSeries(exId) {
  const out = [];
  for (const s of sorted()) { let best = 0, bw = 0;
    for (const en of s.entries) if (en.exId === exId) for (const st of en.sets) if (st.done && !st.warm) { const v = e1rm(st.w || 0, st.r); if (v > best) best = v; bw = Math.max(bw, st.w || 0); }
    if (best) out.push({ date: s.date, e: best, w: bw }); }
  return out;
}
function benchForecast() {
  const ser = e1rmSeries(S.settings.benchEx); const goal = S.settings.benchGoal;
  if (!ser.length) return { cur: 0, goal, start: 0 };
  const cur = Math.max(...ser.map(p => p.e)); const start = ser[0].e;
  let eta = null;
  if (ser.length >= 3 && cur < goal) { // lineare Regression e1RM über Tage
    const x0 = parseYmd(ser[0].date); const xs = ser.map(p => (parseYmd(p.date) - x0) / 864e5), ys = ser.map(p => p.e);
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    const sl = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
    if (sl > 0.005) { const d = new Date(x0); d.setDate(d.getDate() + Math.round((goal - (my - sl * mx)) / sl)); eta = d; }
  }
  return { cur, goal, start, eta, done: cur >= goal };
}
function strengthIndex() { // Ø Steigerung e1RM je Übung seit erster Messung
  const vals = [];
  for (const e of S.exercises) { const s = e1rmSeries(e.id); if (s.length >= 2 && s[0].e > 0) vals.push((Math.max(...s.map(p => p.e)) / s[0].e - 1) * 100); }
  return vals.length ? vals.reduce((a, b) => a + b) / vals.length : null;
}
function streakWeeks() { // Wochen in Folge mit Wochenziel erreicht (laufende Woche zählt mit, wenn schon erreicht)
  const cnt = {}; for (const s of S.sessions) cnt[weekKey(s.date)] = (cnt[weekKey(s.date)] || 0) + 1;
  let n = 0; let w = mondayOf(new Date());
  if ((cnt[ymd(w)] || 0) >= S.settings.weekGoal) n++;
  w.setDate(w.getDate() - 7);
  while ((cnt[ymd(w)] || 0) >= S.settings.weekGoal) { n++; w.setDate(w.getDate() - 7); }
  return n;
}

// ---------- Navigation ----------
let tab = 'heute';
const charts = [];
function go(t) { tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); render(); scrollTo(0, 0); }
function render() {
  charts.splice(0).forEach(c => c.destroy());
  const titles = { heute: 'Heute', training: S.current ? (day(S.current.dayId)?.name || 'Training') : 'Training', verlauf: 'Verlauf', fortschritt: 'Fortschritt', mehr: 'Mehr' };
  $('#title').textContent = titles[tab]; tickClock();
  ({ heute: vHeute, training: vTraining, verlauf: vVerlauf, fortschritt: vFortschritt, mehr: vMehr })[tab]();
}

// ---------- Heute ----------
function vHeute() {
  const nd = nextDay(); const wk = mondayOf(new Date()); const t = today();
  const leg = lastLegDay(); const legDays = leg ? daysBetween(leg, t) : null;
  const weekSess = S.sessions.filter(s => weekKey(s.date) === ymd(wk));
  const coreDone = new Set(weekSess.filter(s => day(s.dayId)?.core).map(s => s.dayId)).size;
  const bf = benchForecast(); const weak = weakest(14);
  let h = '';
  if (S.sessions.some(x => x.demo)) h += `<div class="alert bad">🧪 Beispieldaten aktiv (nicht echt). Entfernen unter „Mehr".</div>`;
  const real = S.sessions.filter(x => !x.demo).length;
  if (real >= 8 && (!S.settings.lastExport || daysBetween(S.settings.lastExport, t) > 30)) h += `<div class="alert bad">💾 Seit über 30 Tagen keine Sicherung. <button class="btn-sm" data-act="export" style="float:right">Jetzt sichern</button></div>`;
  if (S.current) h += `<div class="alert ok">🏋️ Training läuft (${esc(day(S.current.dayId)?.name || '')}) <button class="btn-sm btn-acc" data-act="tab" data-v="training" style="float:right">Weiter</button></div>`;
  const firstDays = S.sessions.length ? daysBetween(sorted()[0].date, t) : 0;
  if (S.sessions.length && (legDays === null ? firstDays > 7 : legDays > 7)) h += `<div class="alert bad">🦵 Beintag-Wächter: ${legDays === null ? 'Noch nie Beine trainiert.' : `Seit <b>${legDays} Tagen</b> keine Beine.`} Das war deine Schwäche bei Upper/Lower.</div>`;
  h += `<div class="card"><h2>Diese Woche · ${weekSess.length}/${S.settings.weekGoal}${weekSess.length >= S.settings.weekGoal ? ' ✅' : ''}</h2><div class="week">`;
  for (let i = 0; i < 7; i++) { const d = new Date(wk); d.setDate(d.getDate() + i); const k = ymd(d);
    const ss = S.sessions.filter(s => s.date === k);
    const pl = !ss.length && S.weekPlan[k] && day(S.weekPlan[k]);
    h += `<div class="wd ${k === t ? 'today' : ''} ${ss.length ? 'done' : ''}" data-act="dayinfo" data-v="${k}">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][i]}<b>${d.getDate()}</b>${ss.map(s => `<span class="tag">${esc(day(s.dayId)?.icon || '✔')}</span>`).join('')}${pl ? `<span class="tag" style="background:transparent;border:1px dashed var(--acc);color:var(--acc2)">${esc(pl.icon)}</span>` : ''}</div>`; }
  h += `</div><div class="mute" style="margin-top:8px">${coreDone >= 3 ? '✅ Pflicht geschafft. Tag 4 ist Bonus.' : `Pflichttage: ${coreDone}/3 · Stress-Regel: 3 Tage = Woche geschafft`} · Tag antippen = planen</div></div>`;
  if (!S.current) {
    h += `<div class="card"><h2>Als Nächstes dran</h2><h3>${esc(nd.icon)} ${esc(nd.name)}</h3><div class="mute">${nd.items.map(i => esc(ex(i[0]).name)).join(' · ')}</div><br>
      <button class="btn btn-acc btn-full" data-act="start" data-v="${nd.id}">▶ ${esc(nd.name)} starten</button>
      <div class="row wrap" style="margin-top:8px">${S.plan.filter(d => d.id !== nd.id).map(d => `<button class="btn-sm" data-act="start" data-v="${d.id}">${esc(d.icon)} ${esc(d.name)}</button>`).join('')}<button class="btn-sm" data-act="start" data-v="frei">➕ Frei</button></div></div>`;
  }
  // Bank-Quest
  const pct = bf.goal ? Math.min(100, bf.cur / bf.goal * 100) : 0;
  h += `<div class="card"><h2>⚔️ Quest: ${bf.goal} kg Bankdrücken</h2><div class="row between"><span class="big">${bf.cur ? fmtNum(bf.cur) : '–'} kg</span><span class="mute">geschätztes 1RM</span></div>
    <div class="bar" style="margin:8px 0"><i style="width:${pct}%"></i></div>
    <div class="mute">${bf.done ? '🏆 Geschafft!' : bf.eta ? `Prognose bei deinem Tempo: <b style="color:var(--acc2)">${bf.eta.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</b>` : 'Prognose ab 3 Bank-Einheiten.'}${bf.cur ? ` · noch ${fmtNum(Math.max(0, bf.goal - bf.cur))} kg` : ''}</div></div>`;
  // Wochen-Zeugnis (letzte Woche)
  h += reportCard();
  if (S.sessions.length) h += `<div class="card"><h2>🧍 Diese Woche trainiert</h2>${bodyMap()}</div>
    <div class="card"><h2>🔋 Erholung</h2><div class="grid3">${recovery().map(r => `<div class="stat" style="text-align:left;padding:8px"><span style="color:var(--text);font-size:13px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${r.c}"></i> ${esc(r.k)}</span><br><span>${r.d === null ? r.t : r.d === 0 ? 'heute' : `vor ${r.d} T. · ${r.t}`}</span></div>`).join('')}</div>
    <div class="mute" style="margin-top:8px">Faustregel: denselben Muskel nach ca. 48 h wieder hart trainieren.</div></div>`;
  if (S.sessions.length >= 2) h += `<div class="card"><h2>🎯 Schwächster Muskel (14 Tage)</h2><h3>${esc(weak[0].k)}</h3><div class="mute">${Math.round(weak[0].pct * 100)} % vom Ziel · danach: ${esc(weak[1].k)} (${Math.round(weak[1].pct * 100)} %), ${esc(weak[2].k)} (${Math.round(weak[2].pct * 100)} %)</div>
    ${S.current ? '' : `<br><button class="btn btn-full" data-act="start" data-v="smart">🧠 Smart-Schwächen-Tag starten</button><div class="mute" style="margin-top:6px">Baut Tag 4 aus genau diesen 3 Muskeln. Deine Bonus-Einheit, wenn Zeit ist.</div>`}</div>`;
  if (!S.sessions.length) h += `<div class="card empty">Noch keine Einheit. Starte oben dein erstes Training.<br>Dein Plan (Push / Pull / Beine / Schwächen) ist schon drin.</div>`;
  $('#view').innerHTML = h;
}
function reportCard() {
  const lw = mondayOf(new Date()); lw.setDate(lw.getDate() - 7); const k = ymd(lw); const pk = addDays(k, -7);
  const ss = S.sessions.filter(s => weekKey(s.date) === k); if (!ss.length) return '';
  const pv = S.sessions.filter(s => weekKey(s.date) === pk);
  const v = ss.reduce((a, s) => a + volume(s), 0), vp = pv.reduce((a, s) => a + volume(s), 0);
  const prs = ss.reduce((a, s) => a + (s.prs || 0), 0);
  const m = muscleSets(k, addDays(k, 6)); const low = MUSCLES.map(x => ({ x, p: m[x] / WEEK_TARGET[x] })).sort((a, b) => a.p - b.p)[0];
  return `<div class="card report"><h2>📜 Wochen-Zeugnis · ${fmtDate(k)}</h2><div class="grid3">
    <div class="stat"><b>${ss.length}</b><span>Einheiten</span></div>
    <div class="stat"><b>${vp ? (v >= vp ? '+' : '') + Math.round((v / vp - 1) * 100) + ' %' : fmtNum(v / 1000) + ' t'}</b><span>Volumen${vp ? ' vs. Vorwoche' : ''}</span></div>
    <div class="stat"><b>${prs}</b><span>Rekorde</span></div></div>
    <div class="mute" style="margin-top:8px">Zu kurz gekommen: <b>${esc(low.x)}</b> (${m[low.x]}/${WEEK_TARGET[low.x]} Sätze)</div></div>`;
}

// ---------- Training ----------
// Smart-Schwächen-Tag: die 3 schwächsten Muskeln (14 Tage), je 2 Übungen, bekannte zuerst
function smartWeakItems() {
  const used = id => S.sessions.filter(s => s.entries.some(en => en.exId === id)).length;
  const items = [];
  for (const { k } of weakest(14).slice(0, 3)) {
    const cand = S.exercises.filter(e => e.muscle === k).sort((a, b) => used(b.id) - used(a.id));
    cand.slice(0, 2).forEach((e, i) => items.push([e.id, i ? '3 × 10-12' : '3 × 8-10']));
  }
  return items;
}
function startSession(dayId, date) {
  if (S.current) { go('training'); return; }
  const smart = dayId === 'smart'; const d = smart ? day('schwach') : day(dayId);
  S.current = { id: uid(), dayId: d ? d.id : 'frei', date: date || today(), start: Date.now(), notes: smart ? 'Smart-Schwächen-Tag' : '',
    entries: (smart ? smartWeakItems() : d ? d.items : []).map(([exId, target]) => ({ exId, target, sets: prefill(exId, target) })) };
  save(); go('training');
}
function nextWeight(exId, target) { // doppelte Progression: obere Wdh überall geschafft → mehr Gewicht
  const last = lastEntry(exId); const m = /(\d+)\s*-\s*(\d+)/.exec(target || '');
  if (!last || !last.sets.length || !m || !last.sets.every(s => s.r >= +m[2])) return null;
  const w = Math.max(...last.sets.map(s => s.w || 0)); return w ? w + (w >= 40 ? 2.5 : 1.25) : null;
}
function prefill(exId, target) {
  const n = +(/^(\d+)/.exec(target || '') || [0, 3])[1] || 3; const last = lastEntry(exId); const up = nextWeight(exId, target);
  const lo = +((/(\d+)\s*-/.exec(target || '') || [0, ''])[1]) || '';
  return Array.from({ length: n }, (_, i) => { const l = last && last.sets[Math.min(i, last.sets.length - 1)];
    return { w: up || (l ? l.w : ''), r: up ? lo : (l ? l.r : ''), done: false, warm: false }; });
}
function vTraining() {
  const c = S.current;
  if (!c) { $('#view').innerHTML = `<div class="card empty">Kein Training aktiv.<br><br><button class="btn btn-acc" data-act="start" data-v="${nextDay().id}">▶ ${esc(nextDay().name)} starten</button></div>`; return; }
  let h = `<div class="row between" style="margin-bottom:10px"><span class="mute">${fmtDate(c.date)} · Dauer <b id="dur"></b></span><button class="btn-sm" data-act="cdate">📅 Datum</button></div>`;
  const prev = sorted().reverse().find(s => s.dayId === c.dayId && s.id !== c.id && s.date <= c.date); const cv = volume(c);
  if (prev && volume(prev)) { const p = Math.round(cv / volume(prev) * 100);
    h += `<div class="card" style="padding:10px 14px"><div class="row between"><span class="mute">Live gegen letztes ${esc(day(c.dayId)?.name || '')} (${fmtDate(prev.date)})</span><b style="color:${p >= 100 ? 'var(--ok)' : 'var(--acc2)'}">${p} %</b></div>
      <div class="bar" style="margin-top:6px"><i style="width:${Math.min(100, p)}%;${p >= 100 ? 'background:var(--ok)' : ''}"></i></div><div class="mute" style="margin-top:4px">${fmtNum(cv)} von ${fmtNum(volume(prev))} kg Volumen${p >= 100 ? ' · 🔥 schon mehr als letztes Mal' : ''}</div></div>`; }
  c.entries.forEach((en, ei) => {
    const e = ex(en.exId); const last = lastEntry(en.exId, c.id);
    h += `<div class="ex"><div class="ex-head"><div><h3>${esc(e.name)}</h3><span class="pill">${esc(e.muscle)}</span> ${en.target ? `<span class="pill">${esc(en.target)}</span>` : ''}</div>
      <div class="row"><button class="btn-sm" data-act="exinfo" data-v="${en.exId}">📈</button><button class="btn-sm" data-act="exmenu" data-v="${ei}">⋯</button></div></div>
      ${e.note ? `<div class="mute" style="margin-top:6px">📌 ${esc(e.note)}</div>` : ''}
      <div class="last">${last ? `Letztes Mal (${fmtDate(last.date)}): ${last.sets.map(s => `${fmtNum(s.w || 0)}×${s.r}`).join(', ')}` : 'Erstes Mal: Gewicht finden, sauber ausführen.'}</div>
      ${progressHint(en.exId, en.target) ? `<div class="hint">${progressHint(en.exId, en.target)}</div>` : ''}
      <div class="colhead"><span>Satz</span><span>kg</span><span>Wdh</span><span>✓</span></div>`;
    if (ei === 0 && !S.sessions.length) h += `<div class="mute" style="margin-bottom:6px">Tipp: Satznummer antippen = Aufwärmsatz (A), zählt nicht in die Statistik.</div>`;
    en.sets.forEach((st, si) => {
      h += `<div class="set ${st.done ? 'done' : ''}"><span class="n ${st.warm ? 'warm' : ''}" data-act="warm" data-v="${ei}.${si}">${st.warm ? 'A' : si + 1 - en.sets.slice(0, si).filter(x => x.warm).length}</span>
        <input type="number" inputmode="decimal" step="0.5" value="${st.w}" data-in="w" data-v="${ei}.${si}" placeholder="kg">
        <input type="number" inputmode="numeric" value="${st.r}" data-in="r" data-v="${ei}.${si}" placeholder="Wdh">
        <button class="chk" data-act="done" data-v="${ei}.${si}">✓</button></div>`;
    });
    h += `<div class="row"><button class="btn-sm" data-act="addset" data-v="${ei}">+ Satz</button><button class="btn-sm" data-act="delset" data-v="${ei}">− Satz</button>
      ${e.name.includes('Langhantel') || /bank|kniebeuge|rdl/.test(en.exId) ? `<button class="btn-sm" data-act="plates" data-v="${ei}">🥏 Scheiben</button>` : ''}</div></div>`;
  });
  h += `<button class="btn btn-full" data-act="addex">➕ Übung hinzufügen</button><label>Notiz (wie lief's, Erholung, was sonst noch)</label>
    <textarea rows="3" data-in="notes" placeholder="z. B. Schulter zwickt, 10 min Laufband, schlecht geschlafen">${esc(c.notes)}</textarea><br><br>
    <button class="btn btn-ok btn-full" data-act="finish">🏁 Training beenden</button><br><br>
    <button class="btn btn-bad btn-full" data-act="discard">Training verwerfen</button>`;
  $('#view').innerHTML = h; tickClock();
}
function setAt(v) { const [ei, si] = v.split('.').map(Number); return [S.current.entries[ei], S.current.entries[ei].sets[si], ei, si]; }
function markDone(v) {
  const [en, st] = setAt(v); st.done = !st.done;
  if (st.done) {
    if (st.r === '' || st.r == null) { st.done = false; toast('Erst Wdh eintragen'); return; }
    st.w = +st.w || 0; st.r = +st.r;
    const nx = en.sets[setAt(v)[3] + 1]; // nächsten leeren Satz vorbelegen
    if (nx && !nx.done && nx.w === '' && nx.r === '') { nx.w = st.w; nx.r = st.r; }
    if (!st.warm) { const b = bests(en.exId, S.current.id);
      const pr = (b.e && e1rm(st.w, st.r) > b.e + 0.01) || (b.w && st.w > b.w);
      if (pr) { st.pr = true; toast(`🏆 Neuer Rekord: ${ex(en.exId).name} ${fmtNum(st.w)} × ${st.r}`); vibrate([60, 40, 60]); } else st.pr = false; }
    startRest(ex(en.exId).rest || S.settings.rest);
  }
  save(); vTraining();
}
function finishSession() {
  const c = S.current; c.entries = c.entries.filter(en => en.sets.some(s => s.done));
  c.entries.forEach(en => en.sets = en.sets.filter(s => s.done));
  if (!c.entries.length) { if (!confirm('Kein Satz abgehakt. Trotzdem speichern?')) return; }
  if (c.edit) delete c.edit; // bearbeitete Einheit: Dauer bleibt
  else if (c.date !== today()) { const m = parseInt(prompt('Nachgetragen: Wie lange warst du im Gym (Minuten)?', '60'), 10); c.durationMin = m > 0 ? m : 60; c.end = c.start + c.durationMin * 6e4; }
  else { c.end = Date.now(); c.durationMin = Math.max(1, Math.round((c.end - c.start) / 60000)); }
  c.prs = c.entries.reduce((a, en) => a + en.sets.filter(s => s.pr).length, 0);
  S.sessions.push(c); S.current = null; stopRest(); recomputePRs(); save();
  const v = volume(c);
  toast(`💪 Gespeichert: ${c.durationMin} min · ${fmtNum(v)} kg Volumen${c.prs ? ` · ${c.prs} Rekord${c.prs > 1 ? 'e' : ''}` : ''}`, 4000);
  go('heute');
}

// Pausen-Timer
let restEnd = 0, restInt = null;
function startRest(sec = S.settings.rest) { restEnd = Date.now() + sec * 1000; $('#restbar').hidden = false; clearInterval(restInt); restInt = setInterval(tickRest, 250); tickRest(); }
function tickRest() { const left = Math.round((restEnd - Date.now()) / 1000);
  if (left <= 0) { stopRest(); vibrate([200, 100, 200]); toast('⏱️ Pause vorbei. Nächster Satz!'); return; }
  $('#resttime').textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`; }
function stopRest() { clearInterval(restInt); $('#restbar').hidden = true; }
function tickClock() {
  const d = $('#dur'); const c = S.current;
  $('#clock').textContent = c ? `⏱ ${Math.floor((Date.now() - c.start) / 60000)} min` : '';
  if (d && c) { const m = Math.floor((Date.now() - c.start) / 60000); d.textContent = `${Math.floor(m / 60) ? Math.floor(m / 60) + ' h ' : ''}${m % 60} min`; }
}
setInterval(tickClock, 15000);

// Scheiben-Rechner
function plates(total) {
  const per = (total - S.settings.bar) / 2; if (per < 0) return null;
  const kinds = [[25, '#e33', 46], [20, '#36f', 42], [15, '#fd3', 38], [10, '#3c6', 34], [5, '#eee', 28], [2.5, '#e33', 22], [1.25, '#aaa', 18]];
  let rest = per; const out = [];
  for (const [kg, col, hgt] of kinds) while (rest >= kg - 1e-9) { out.push([kg, col, hgt]); rest -= kg; }
  return { out, rest };
}

// ---------- Verlauf ----------
function vVerlauf() {
  let h = `<div class="card"><h2>Gym-Tage · letztes Jahr</h2>${heatmap()}<div class="mute" style="margin-top:6px">${S.sessions.length} ${S.sessions.length === 1 ? 'Einheit' : 'Einheiten'} insgesamt${streakWeeks() ? ` · ${streakWeeks()} ${streakWeeks() === 1 ? 'Woche' : 'Wochen'} in Folge Ziel erreicht 🔥` : ''}</div></div>`;
  h += `<button class="btn btn-full" data-act="later">➕ Training nachtragen</button><br><br>`;
  const list = sorted().reverse();
  if (!list.length) h += `<div class="card empty">Noch nichts eingetragen.</div>`;
  let lastMonth = '';
  for (const s of list) {
    const mo = parseYmd(s.date).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (mo !== lastMonth) { h += `<h2 class="mute" style="margin:14px 2px 6px">${mo}</h2>`; lastMonth = mo; }
    h += `<div class="card" data-act="sess" data-v="${s.id}"><div class="row between"><h3>${esc(day(s.dayId)?.icon || '➕')} ${esc(day(s.dayId)?.name || 'Frei')}</h3><span class="mute">${fmtDate(s.date)}</span></div>
      <div class="mute">${s.durationMin || '?'} min · ${workSets(s).length} Sätze · ${fmtNum(volume(s))} kg${s.prs ? ` · 🏆 ${s.prs}` : ''}</div></div>`;
  }
  $('#view').innerHTML = h;
  const hm = $('.heat'); if (hm) hm.scrollLeft = hm.scrollWidth;
}
function heatmap() {
  const cnt = {}; for (const s of S.sessions) cnt[s.date] = (cnt[s.date] || 0) + volume(s) + 1;
  const max = Math.max(1, ...Object.values(cnt));
  const end = new Date(); const start = mondayOf(new Date(end)); start.setDate(start.getDate() - 7 * 52);
  let h = '<div class="heat">'; const t = today();
  for (let d = new Date(start); ymd(d) <= addDays(ymd(mondayOf(end)), 6); d.setDate(d.getDate() + 1)) {
    const k = ymd(d); const v = cnt[k] || 0; const l = v ? 1 + Math.min(3, Math.floor(v / max * 3.999)) : 0;
    h += `<i class="${l ? 'l' + l : ''} ${k > t ? 'fut' : ''}" title="${k}"></i>`;
  }
  return h + '</div>';
}
function sessionDialog(id) {
  const s = S.sessions.find(x => x.id === id); if (!s) return;
  let h = `<h3>${esc(day(s.dayId)?.name || 'Frei')} · ${fmtDate(s.date)}</h3><div class="mute">${s.durationMin || '?'} min · ${fmtNum(volume(s))} kg Volumen</div><hr>`;
  for (const en of s.entries) h += `<div style="margin-bottom:8px"><b>${esc(ex(en.exId).name)}</b><div class="mute">${en.sets.map(st => `${st.warm ? '(A) ' : ''}${fmtNum(st.w || 0)}×${st.r}${st.pr ? '🏆' : ''}`).join(' · ')}</div></div>`;
  if (s.notes) h += `<hr><div>📝 ${esc(s.notes)}</div>`;
  h += `<hr><div class="row between"><button class="btn-sm btn-bad" data-act="delsess" data-v="${s.id}">Löschen</button><button class="btn-sm" data-act="editsess" data-v="${s.id}">Bearbeiten</button><button class="btn-sm btn-acc" data-act="close">Schließen</button></div>`;
  openDlg(h);
}

// Erholung: Tage seit dem letzten harten Satz je Muskel
function recovery() {
  const last = {}; for (const s of S.sessions) for (const st of workSets(s)) { const k = ex(st.exId).muscle; if (!last[k] || s.date > last[k]) last[k] = s.date; }
  return MUSCLES.map(k => { const d = last[k] ? daysBetween(last[k], today()) : null;
    const [c, t] = d === null ? ['#2a2f3a', 'noch nie'] : d === 0 ? ['#ff4d5e', 'heute'] : d === 1 ? ['#f5d142', 'erholt sich'] : d <= 7 ? ['#3ccf7a', 'bereit'] : ['#8b93a3', 'lange her'];
    return { k, d, c, t }; });
}
// Muskel-Karte: Körper vorn + hinten, Farbe = % vom Wochenziel (letzte 7 Tage)
function bodyMap(days = 7) {
  const m = muscleSets(addDays(today(), -days + 1), today());
  const pct = k => m[k] / (WEEK_TARGET[k] * days / 7);
  const col = k => { const p = pct(k); if (!p) return '#2a2f3a'; if (p < .34) return '#6b3a12'; if (p < .67) return '#b0581a'; if (p < 1) return '#ff7a1a'; return '#ffb066'; };
  const sk = '#3a404c';
  const fig = (x, front) => `<g transform="translate(${x},0)">
    <circle cx="60" cy="22" r="15" fill="${sk}"/><rect x="52" y="36" width="16" height="10" fill="${sk}"/>
    <ellipse cx="28" cy="58" rx="14" ry="11" fill="${col('Schultern')}"/><ellipse cx="92" cy="58" rx="14" ry="11" fill="${col('Schultern')}"/>
    ${front ? `<rect x="40" y="50" width="19" height="26" rx="7" fill="${col('Brust')}"/><rect x="61" y="50" width="19" height="26" rx="7" fill="${col('Brust')}"/>
      <rect x="45" y="80" width="30" height="40" rx="8" fill="${col('Bauch')}"/>
      <rect x="15" y="70" width="13" height="30" rx="6" fill="${col('Bizeps')}"/><rect x="92" y="70" width="13" height="30" rx="6" fill="${col('Bizeps')}"/>
      <rect x="40" y="126" width="18" height="52" rx="8" fill="${col('Beine vorne')}"/><rect x="62" y="126" width="18" height="52" rx="8" fill="${col('Beine vorne')}"/>`
    : `<path d="M40 50 h40 l-6 62 h-28 z" fill="${col('Rücken')}"/>
      <rect x="15" y="70" width="13" height="30" rx="6" fill="${col('Trizeps')}"/><rect x="92" y="70" width="13" height="30" rx="6" fill="${col('Trizeps')}"/>
      <rect x="44" y="112" width="32" height="16" rx="7" fill="${col('Beine hinten')}"/>
      <rect x="40" y="130" width="18" height="48" rx="8" fill="${col('Beine hinten')}"/><rect x="62" y="130" width="18" height="48" rx="8" fill="${col('Beine hinten')}"/>`}
    <rect x="14" y="102" width="11" height="34" rx="5" fill="${sk}"/><rect x="95" y="102" width="11" height="34" rx="5" fill="${sk}"/>
    <rect x="42" y="182" width="14" height="38" rx="6" fill="${front ? sk : col('Waden')}"/><rect x="64" y="182" width="14" height="38" rx="6" fill="${front ? sk : col('Waden')}"/>
    <text x="60" y="240" text-anchor="middle" fill="#8b93a3" font-size="12">${front ? 'vorn' : 'hinten'}</text></g>`;
  return `<svg viewBox="0 0 280 250" style="width:100%;max-width:360px;display:block;margin:0 auto">${fig(10, true)}${fig(150, false)}</svg>
    <div class="row wrap" style="justify-content:center;gap:10px;font-size:12px;color:var(--mute);margin-top:6px">
    ${[['#2a2f3a', '0'], ['#6b3a12', '< 1/3'], ['#b0581a', '< 2/3'], ['#ff7a1a', 'fast'], ['#ffb066', 'Ziel ✓']].map(([c, l]) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${c}"></i> ${l}</span>`).join('')}</div>`;
}

// ---------- Fortschritt (Diagramme) ----------
let progEx = null;
Chart.defaults.color = '#8b93a3'; Chart.defaults.borderColor = '#2a2f3a'; Chart.defaults.font.family = 'system-ui, sans-serif';
Chart.defaults.plugins.legend.labels.boxWidth = 12; Chart.defaults.maintainAspectRatio = false;
function mk(id, cfg) { const el = document.getElementById(id); if (el) charts.push(new Chart(el, cfg)); }
function weeksBack(n) { const out = []; const w = mondayOf(new Date()); w.setDate(w.getDate() - 7 * (n - 1)); for (let i = 0; i < n; i++) { out.push(ymd(w)); w.setDate(w.getDate() + 7); } return out; }
function vFortschritt() {
  if (!S.sessions.length) { $('#view').innerHTML = `<div class="card empty">Hier entstehen deine Diagramme, sobald du die erste Einheit gespeichert hast.<br><br>Tipp: Unter „Mehr" kannst du Beispieldaten laden, um alles anzusehen.</div>`; return; }
  const si = strengthIndex(); const all = sorted(); const first = all[0].date;
  const totV = all.reduce((a, s) => a + volume(s), 0); const totPR = all.reduce((a, s) => a + (s.prs || 0), 0);
  const used = S.exercises.filter(e => S.sessions.some(s => s.entries.some(en => en.exId === e.id)));
  if (!progEx || !used.some(e => e.id === progEx)) progEx = used.some(e => e.id === S.settings.benchEx) ? S.settings.benchEx : used[0]?.id;
  let h = `<button class="btn btn-acc btn-full" data-act="card" style="margin-bottom:12px">🖼️ Fortschritts-Bild erstellen</button><div class="grid2" style="margin-bottom:12px">
    <div class="stat"><b>${si == null ? '–' : (si >= 0 ? '+' : '') + Math.round(si) + ' %'}</b><span>Kraft seit Start (Ø 1RM)</span></div>
    <div class="stat"><b>${all.length}</b><span>Einheiten seit ${fmtDate(first)}</span></div>
    <div class="stat"><b>${fmtNum(totV / 1000)} t</b><span>bewegtes Gewicht</span></div>
    <div class="stat"><b>${totPR}</b><span>Rekorde</span></div></div>
  <div class="card"><h2>🧍 Muskel-Karte · letzte 7 Tage</h2>${bodyMap()}</div>
  <div class="card"><h2>Overall · Kraft-Index pro Woche</h2><div class="chartbox tall"><canvas id="c-overall"></canvas></div><div class="mute">Linie = Ø deiner besten 1RMs in % vom Start (alle Übungen). Balken = Volumen pro Woche.</div></div>
  <div class="card"><h2>Einheiten pro Woche</h2><div class="chartbox"><canvas id="c-freq"></canvas></div></div>
  <div class="card"><h2>🎯 Schwächen-Radar · letzte 14 Tage</h2><div class="chartbox tall"><canvas id="c-radar"></canvas></div><div class="mute">Sätze pro Muskel im Verhältnis zum Ziel. Was nach innen knickt, kommt zu kurz.</div></div>
  <div class="card"><h2>Übung im Detail</h2><select data-in="progex">${used.map(e => `<option value="${e.id}" ${e.id === progEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    <div class="chartbox" style="margin-top:10px"><canvas id="c-ex"></canvas></div><div id="exstats" class="mute"></div></div>
  <div class="card"><details><summary style="cursor:pointer;list-style:none"><h2 style="display:inline">🏆 Rekorde · alle Übungen ▾</h2></summary>${prTable()}</details></div>
  <div class="card"><h2>⚔️ Weg zu ${S.settings.benchGoal} kg Bank</h2><div class="chartbox"><canvas id="c-bench"></canvas></div></div>
  <div class="card"><h2>Sätze pro Muskel · Wochen</h2><div class="chartbox tall"><canvas id="c-muscle"></canvas></div></div>
  <div class="card"><h2>Körper · Gewicht und Maße</h2><div class="chartbox"><canvas id="c-bw"></canvas></div><button class="btn-sm" data-act="bw" style="margin-top:8px">+ Gewicht / Maße eintragen</button></div>
  <div class="card"><h2>Dauer pro Einheit</h2><div class="chartbox"><canvas id="c-dur"></canvas></div></div>
  <div class="card"><h2>📸 Vorher / Nachher</h2><div id="cmp" class="mute">Lade Fotos …</div></div>`;
  $('#view').innerHTML = h;
  const ACC = '#ff7a1a', ACC2 = '#ffb066', OK = '#3ccf7a', BLUE = '#4da3ff';
  // Overall
  const wks = weeksBack(Math.min(26, Math.max(8, Math.ceil(daysBetween(first, today()) / 7) + 1)));
  const lbl = wks.map(w => fmtDate(w).slice(4));
  const vol = wks.map(w => S.sessions.filter(s => weekKey(s.date) === w).reduce((a, s) => a + volume(s), 0) / 1000);
  const idx = wks.map(w => { const end = addDays(w, 6); const vals = [];
    for (const e of S.exercises) { const s = e1rmSeries(e.id); const upto = s.filter(p => p.date <= end); if (s.length && upto.length) vals.push(Math.max(...upto.map(p => p.e)) / s[0].e * 100); }
    return vals.length ? vals.reduce((a, b) => a + b) / vals.length : null; });
  mk('c-overall', { data: { labels: lbl, datasets: [
    { type: 'line', label: 'Kraft-Index %', data: idx, borderColor: ACC, backgroundColor: ACC, tension: .35, yAxisID: 'y', spanGaps: true, pointRadius: 3 },
    { type: 'bar', label: 'Volumen (t)', data: vol, backgroundColor: 'rgba(77,163,255,.35)', yAxisID: 'y2', borderRadius: 4 }] },
    options: { scales: { y: { position: 'left', suggestedMin: 95 }, y2: { position: 'right', grid: { display: false } } } } });
  // Frequenz
  const freq = wks.map(w => S.sessions.filter(s => weekKey(s.date) === w).length);
  mk('c-freq', { type: 'bar', data: { labels: lbl, datasets: [{ label: 'Einheiten', data: freq, backgroundColor: freq.map(f => f >= S.settings.weekGoal ? OK : ACC), borderRadius: 5 },
    { type: 'line', label: `Ziel ${S.settings.weekGoal}`, data: wks.map(() => S.settings.weekGoal), borderColor: '#8b93a3', borderDash: [5, 5], pointRadius: 0 }] },
    options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
  // Radar
  const m14 = muscleSets(addDays(today(), -13), today());
  mk('c-radar', { type: 'radar', data: { labels: MUSCLES, datasets: [
    { label: 'Du (% vom Ziel)', data: MUSCLES.map(k => Math.round(m14[k] / (WEEK_TARGET[k] * 2) * 100)), borderColor: ACC, backgroundColor: 'rgba(255,122,26,.25)' },
    { label: 'Ziel 100 %', data: MUSCLES.map(() => 100), borderColor: '#8b93a3', borderDash: [4, 4], backgroundColor: 'transparent', pointRadius: 0 }] },
    options: { scales: { r: { beginAtZero: true, suggestedMax: 120, grid: { color: '#2a2f3a' }, angleLines: { color: '#2a2f3a' }, pointLabels: { color: '#eef0f4', font: { size: 11 } }, ticks: { display: false } } } } });
  drawExChart();
  // Bank
  const bs = e1rmSeries(S.settings.benchEx); const bf = benchForecast();
  const bl = bs.map(p => fmtDate(p.date).slice(4)); const bd = bs.map(p => Math.round(p.e * 10) / 10);
  const fcL = [...bl], fcD = bs.map(() => null);
  if (bf.eta && bs.length) { fcD[fcD.length - 1] = bd[bd.length - 1]; fcL.push(bf.eta.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })); fcD.push(bf.goal); bd.push(null); }
  mk('c-bench', { type: 'line', data: { labels: fcL, datasets: [
    { label: 'Bank 1RM (geschätzt)', data: bd, borderColor: ACC, backgroundColor: ACC, tension: .3 },
    { label: 'Prognose', data: fcD, borderColor: ACC2, borderDash: [6, 4], pointRadius: 0, spanGaps: true },
    { label: `Ziel ${bf.goal} kg`, data: fcL.map(() => bf.goal), borderColor: OK, pointRadius: 0, borderDash: [2, 3] }] } });
  // Muskeln gestapelt
  const cols = ['#ff7a1a', '#4da3ff', '#ffb066', '#3ccf7a', '#c77dff', '#ff4d5e', '#f5d142', '#5ee6d0', '#9aa3b5'];
  mk('c-muscle', { type: 'bar', data: { labels: lbl, datasets: MUSCLES.map((k, i) => ({ label: k, backgroundColor: cols[i],
    data: wks.map(w => muscleSets(w, addDays(w, 6))[k]) })) }, options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } });
  // Körpergewicht
  const bw = [...S.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  const hasM = k => bw.some(p => p[k]);
  mk('c-bw', { type: 'line', data: { labels: bw.map(p => fmtDate(p.date).slice(4)), datasets: [{ label: 'Gewicht kg', data: bw.map(p => p.kg), borderColor: BLUE, backgroundColor: BLUE, tension: .3, spanGaps: true, yAxisID: 'y' },
    ...[['waist', 'Taille cm', '#ff4d5e'], ['arm', 'Arm cm', ACC], ['chest', 'Brust cm', OK]].filter(([k]) => hasM(k)).map(([k, l, c]) => ({ label: l, data: bw.map(p => p[k]), borderColor: c, backgroundColor: c, tension: .3, spanGaps: true, yAxisID: 'y2' }))] },
    options: { scales: { y: { position: 'left' }, y2: { position: 'right', display: ['waist', 'arm', 'chest'].some(hasM), grid: { display: false } } } } });
  // Dauer
  mk('c-dur', { type: 'bar', data: { labels: all.slice(-20).map(s => fmtDate(s.date).slice(4)), datasets: [{ label: 'Minuten', data: all.slice(-20).map(s => s.durationMin || 0),
    backgroundColor: all.slice(-20).map(s => (s.durationMin || 0) > 75 ? '#ff4d5e' : ACC), borderRadius: 4 }] }, options: { scales: { y: { beginAtZero: true } } } });
  compareView();
}
function prTable() {
  const rows = [];
  for (const e of S.exercises) { let best = null;
    for (const s of S.sessions) for (const en of s.entries) if (en.exId === e.id) for (const st of en.sets) if (st.done && !st.warm) { const v = e1rm(st.w || 0, st.r); if (!best || v > best.v) best = { v, w: st.w || 0, r: st.r, date: s.date }; }
    if (best) rows.push({ e, ...best }); }
  rows.sort((a, b) => MUSCLES.indexOf(a.e.muscle) - MUSCLES.indexOf(b.e.muscle) || b.v - a.v);
  return rows.length ? rows.map(r => `<div class="list-item" data-act="exinfo" data-v="${r.e.id}"><div><b>${esc(r.e.name)}</b><div class="mute">${esc(r.e.muscle)} · ${fmtDate(r.date)}</div></div><div style="text-align:right"><b>${fmtNum(r.w)} × ${r.r}</b><div class="mute">1RM ${fmtNum(r.v)}</div></div></div>`).join('') : '<div class="mute">Noch keine.</div>';
}
function drawExChart() {
  const old = charts.findIndex(c => c.canvas.id === 'c-ex'); if (old >= 0) charts.splice(old, 1)[0].destroy();
  const s = e1rmSeries(progEx);
  mk('c-ex', { type: 'line', data: { labels: s.map(p => fmtDate(p.date).slice(4)), datasets: [
    { label: '1RM geschätzt', data: s.map(p => Math.round(p.e * 10) / 10), borderColor: '#ff7a1a', backgroundColor: '#ff7a1a', tension: .3 },
    { label: 'Schwerstes Gewicht', data: s.map(p => p.w), borderColor: '#4da3ff', backgroundColor: '#4da3ff', tension: .3 }] } });
  const b = bests(progEx); const el = $('#exstats');
  const hist = sorted().reverse().map(x => ({ x, en: x.entries.find(en => en.exId === progEx) })).filter(o => o.en && o.en.sets.some(st => st.done)).slice(0, 12);
  if (el) el.innerHTML = s.length ? `Bestes 1RM <b>${fmtNum(b.e)} kg</b> · schwerstes <b>${fmtNum(b.w)} kg</b> · ${s.length} ${s.length === 1 ? 'Einheit' : 'Einheiten'} · seit Start <b>${s.length > 1 ? (b.e >= s[0].e ? '+' : '') + Math.round((b.e / s[0].e - 1) * 100) + ' %' : '–'}</b>
    <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--acc2)">Verlauf dieser Übung ▾</summary>${hist.map(o => `<div class="list-item"><span>${fmtDate(o.x.date)}</span><span>${o.en.sets.filter(st => st.done && !st.warm).map(st => `${fmtNum(st.w || 0)}×${st.r}${st.pr ? '🏆' : ''}`).join(' · ')}</span></div>`).join('')}</details>` : '';
}
let cmpSel = [];
async function compareView() {
  const el = $('#cmp'); if (!el) return; let ps = [];
  try { ps = (await DB.all()).sort((a, b) => a.date.localeCompare(b.date)); } catch (e) {}
  if (ps.length < 2) { el.innerHTML = `${ps.length ? 'Ein Foto da. Ab zwei Fotos kannst du hier vergleichen.' : 'Noch keine Fotos.'} <button class="btn-sm" data-act="tab" data-v="mehr">Fotos hinzufügen</button>`; return; }
  const ia = Math.min(cmpSel[0] ?? 0, ps.length - 1), ib = Math.min(cmpSel[1] ?? ps.length - 1, ps.length - 1);
  const a = ps[ia], b = ps[ib];
  const opts = sel => ps.map((p, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${fmtDate(p.date)}</option>`).join('');
  el.innerHTML = `<div class="grid2" style="margin-bottom:8px"><select data-in="cmpa">${opts(ia)}</select><select data-in="cmpb">${opts(ib)}</select></div><div class="compare" id="cmpbox"><img src="${URL.createObjectURL(a.blob)}"><img class="after" src="${URL.createObjectURL(b.blob)}"><div class="handle"></div>
    <span class="lbl" style="left:8px">${fmtDate(a.date)}</span><span class="lbl" style="right:8px">${fmtDate(b.date)}</span></div><div class="mute" style="margin-top:6px">Mit dem Finger schieben · ${daysBetween(a.date, b.date)} Tage dazwischen</div>`;
  const box = $('#cmpbox'); const mv = ev => { const r = box.getBoundingClientRect(); const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * 100;
    const p = Math.max(0, Math.min(100, x)); box.querySelector('.after').style.clipPath = `inset(0 0 0 ${p}%)`; box.querySelector('.handle').style.left = p + '%'; };
  box.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') mv(e); }); box.addEventListener('pointerdown', mv);
}

// Fortschritts-Bild (1080×1350, zum Speichern/Teilen)
async function progressCard() {
  let ps = []; try { ps = (await DB.all()).sort((a, b) => a.date.localeCompare(b.date)); } catch (e) {}
  const pics = ps.length >= 2 ? [ps[0], ps[ps.length - 1]] : ps.slice(-1);
  const W = 1080, H = pics.length ? 2050 : 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, '#1d1209'); grd.addColorStop(1, '#0f1115'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const all = sorted(); const first = all[0].date; const si = strengthIndex(); const bf = benchForecast();
  const totV = all.reduce((a, s) => a + volume(s), 0), prs = all.reduce((a, s) => a + (s.prs || 0), 0);
  g.fillStyle = '#ff7a1a'; g.font = '700 44px system-ui, sans-serif'; g.fillText('GYM · FORTSCHRITT', 70, 110);
  g.fillStyle = '#8b93a3'; g.font = '34px system-ui, sans-serif'; g.fillText(`${fmtDate(first)} bis ${fmtDate(today())} · ${daysBetween(first, today())} Tage`, 70, 165);
  g.fillStyle = '#eef0f4'; g.font = '800 170px system-ui, sans-serif'; g.fillText(si == null ? '–' : `${si >= 0 ? '+' : ''}${Math.round(si)}%`, 64, 360);
  g.fillStyle = '#8b93a3'; g.font = '36px system-ui, sans-serif'; g.fillText('stärker im Schnitt (geschätztes 1RM aller Übungen)', 70, 420);
  const tiles = [[all.length, 'Einheiten'], [fmtNum(totV / 1000) + ' t', 'bewegt'], [prs, 'Rekorde'], [bf.cur ? fmtNum(bf.cur) + ' kg' : '–', 'Bank 1RM']];
  tiles.forEach(([v, l], i) => { const x = 70 + (i % 2) * 480, y = 480 + Math.floor(i / 2) * 190;
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.roundRect(x, y, 450, 165, 28); g.fill();
    g.fillStyle = '#eef0f4'; g.font = '800 70px system-ui, sans-serif'; g.fillText(String(v), x + 34, y + 92);
    g.fillStyle = '#8b93a3'; g.font = '32px system-ui, sans-serif'; g.fillText(l, x + 36, y + 140); });
  // Kurve: Bank-1RM bzw. Kraft-Index
  const ser = e1rmSeries(S.settings.benchEx).map(p => p.e);
  const pts = ser.length >= 2 ? ser : all.map(volume);
  g.fillStyle = '#8b93a3'; g.font = '32px system-ui, sans-serif'; g.fillText(ser.length >= 2 ? `Bankdrücken auf dem Weg zu ${bf.goal} kg` : 'Volumen pro Einheit', 70, 920);
  const x0 = 70, y0 = 950, w = 940, h = 220, mn = Math.min(...pts), mx = Math.max(...pts, ser.length >= 2 ? bf.goal : 0);
  const X = i => x0 + i / Math.max(1, pts.length - 1) * w, Y = v => y0 + h - (v - mn) / ((mx - mn) || 1) * h;
  if (ser.length >= 2) { g.strokeStyle = '#3ccf7a'; g.setLineDash([10, 10]); g.lineWidth = 3; g.beginPath(); g.moveTo(x0, Y(bf.goal)); g.lineTo(x0 + w, Y(bf.goal)); g.stroke(); g.setLineDash([]); }
  g.strokeStyle = '#ff7a1a'; g.lineWidth = 8; g.lineJoin = 'round'; g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
  g.fillStyle = '#ffb066'; g.beginPath(); g.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 14, 0, 7); g.fill();
  const weak = weakest(14)[0];
  g.fillStyle = '#8b93a3'; g.font = '32px system-ui, sans-serif'; g.fillText(`Nächster Fokus: ${weak.k}${bf.eta ? ` · 100 kg Prognose: ${bf.eta.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}` : ''}`, 70, 1260);
  // Fotos: erstes und neuestes nebeneinander (Ausschnitt 3:4)
  const pw = pics.length === 2 ? 455 : 940, ph = 620;
  for (let i = 0; i < pics.length; i++) { const img = await new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = URL.createObjectURL(pics[i].blob); });
    if (!img) continue; const x = 70 + i * (pw + 30), y = 1330; const sc = Math.max(pw / img.width, ph / img.height); const sw = pw / sc, sh = ph / sc;
    g.save(); g.beginPath(); g.roundRect(x, y, pw, ph, 28); g.clip(); g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, pw, ph); g.restore();
    g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.roundRect(x + 18, y + 18, 230, 56, 14); g.fill();
    g.fillStyle = '#eef0f4'; g.font = '700 30px system-ui, sans-serif'; g.fillText(fmtDate(pics[i].date), x + 34, y + 57); }
  if (pics.length) { g.fillStyle = '#8b93a3'; g.font = '30px system-ui, sans-serif'; g.fillText(pics.length === 2 ? `${daysBetween(pics[0].date, pics[1].date)} Tage dazwischen` : 'Neuestes Fortschrittsfoto', 70, 2000); }
  return new Promise(ok => c.toBlob(ok, 'image/png'));
}

// ---------- Mehr ----------
async function vMehr() {
  let h = `<div class="card"><h2>📸 Fortschrittsfotos</h2><label class="btn btn-acc" style="text-align:center;color:#111">+ Foto hinzufügen<input type="file" accept="image/*" data-in="photo" hidden multiple></label>
    <div class="mute" style="margin:8px 0">Bleiben nur auf diesem Gerät. Gleiche Pose, gleiches Licht = bester Vergleich.</div><div class="photos" id="photos"></div></div>
  <div class="card"><h2>⚖️ Körpergewicht und Maße</h2><button class="btn" data-act="bw">+ Gewicht / Maße eintragen</button>
    <div class="mute" style="margin-top:8px">${S.bodyweight.length ? [...S.bodyweight].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(p => `${fmtDate(p.date)}: ${p.kg ? fmtNum(p.kg) + ' kg' : ''}${p.waist ? ' · Taille ' + fmtNum(p.waist) : ''}`).join(' · ') : 'Noch nichts eingetragen.'}</div></div>
  <div class="card"><h2>📋 Mein Plan</h2>${S.plan.map(d => `<div class="list-item"><div><b>${esc(d.icon)} ${esc(d.name)}</b>${d.core ? '' : ' <span class="pill">Bonus</span>'}<div class="mute">${d.items.map(i => esc(ex(i[0]).name) + ' ' + esc(i[1])).join(' · ')}</div></div><button class="btn-sm" data-act="editday" data-v="${d.id}">✏️</button></div>`).join('')}</div>
  <div class="card"><h2>🏋️ Übungen</h2><button class="btn" data-act="newex">+ Eigene Übung</button><div class="mute" style="margin-top:8px">${S.exercises.length} Übungen in der Bibliothek</div></div>
  <div class="card"><h2>⚙️ Einstellungen</h2>
    <label>Pause zwischen Sätzen (Sekunden)</label><input type="number" data-in="set-rest" value="${S.settings.rest}">
    <label>Wochenziel (Einheiten)</label><input type="number" data-in="set-weekGoal" value="${S.settings.weekGoal}">
    <label>Bank-Ziel (kg)</label><input type="number" data-in="set-benchGoal" value="${S.settings.benchGoal}">
    <label>Stange (kg)</label><input type="number" data-in="set-bar" value="${S.settings.bar}"></div>
  <div class="card"><h2>💾 Sicherung</h2><div class="row wrap"><button class="btn" data-act="export">⬇️ Daten sichern</button><label class="btn">⬆️ Sicherung laden<input type="file" accept=".json,application/json" data-in="import" hidden></label>
    <button class="btn" data-act="mdexport">📝 Für Second Brain</button></div>
    <div class="mute" style="margin-top:8px">Einmal im Monat sichern. Ohne Sicherung sind die Daten weg, wenn der Browser-Speicher gelöscht wird.</div></div>
  <div class="card"><h2>🧪 Ausprobieren</h2><div class="row wrap"><button class="btn" data-act="demo">Beispieldaten laden</button>${S.sessions.some(x => x.demo) ? '<button class="btn" data-act="undemo">Beispieldaten entfernen</button>' : ''}<button class="btn btn-bad" data-act="reset">Alles löschen</button></div>
    <div class="mute" style="margin-top:8px">Version ${VERSION} · alle Funktionen kostenlos, für immer.</div></div>`;
  $('#view').innerHTML = h;
  try { const ps = (await DB.all()).sort((a, b) => b.date.localeCompare(a.date));
    const el = $('#photos'); if (el) el.innerHTML = ps.map(p => `<figure data-act="photo" data-v="${p.id}"><img src="${URL.createObjectURL(p.blob)}"><figcaption>${fmtDate(p.date)}</figcaption></figure>`).join('');
  } catch (e) {}
}
async function addPhotos(files) {
  for (const f of files) { const blob = await shrink(f); const d = f.lastModified ? new Date(f.lastModified) : new Date();
    await DB.put({ id: uid(), date: ymd(d), blob }); }
  toast('📸 Gespeichert'); vMehr();
}
function shrink(file) { // auf max. 1400 px verkleinern, spart Speicher
  return new Promise(ok => { const img = new Image(); img.onload = () => { const s = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => ok(b || file), 'image/jpeg', .85); URL.revokeObjectURL(img.src); }; img.onerror = () => ok(file); img.src = URL.createObjectURL(file); });
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
function mdExport() {
  const l = sorted().slice(-30).reverse();
  let md = `# Gym-Export (${today()})\n\n| Datum | Tag | Dauer | Sätze | Volumen | Rekorde |\n|---|---|---|---|---|---|\n`;
  for (const s of l) md += `| ${s.date} | ${day(s.dayId)?.name || 'Frei'} | ${s.durationMin || '?'} min | ${workSets(s).length} | ${Math.round(volume(s))} kg | ${s.prs || 0} |\n`;
  const bf = benchForecast(); md += `\nBank 1RM (geschätzt): ${fmtNum(bf.cur)} kg von ${bf.goal} kg\n`;
  download(`Gym-Export ${today()}.md`, md, 'text/markdown');
}

// Beispieldaten: 10 Wochen realistisch, damit man die Diagramme sieht
function demo() {
  if (S.sessions.length && !confirm('Es gibt schon Daten. Beispieldaten trotzdem dazu laden?')) return;
  const base = { bank: 62, schraeg: 22, sdrueck: 18, seitkabel: 7.5, pushdown: 25, ueberkopf: 20, latzug: 55, tbar: 40, rudereng: 50, revfly: 30, hammer: 14, spider: 10,
    presse: 120, rdl: 60, beuger: 40, strecker: 45, waden: 60, crunch: 30, hack: 80, schraegfly: 25, seitkh: 10, lateinarm: 25, preacher: 25, beinheben: 0 };
  const start = mondayOf(new Date()); start.setDate(start.getDate() - 70); const order = ['push', 'pull', 'beine'];
  let k = 0;
  for (let w = 0; w < 10; w++) { const offs = w === 4 ? [0, 3] : [0, 2, 4, ...(w % 3 === 1 ? [5] : [])];
    offs.forEach(o => { const d = new Date(start); d.setDate(d.getDate() + w * 7 + o); if (d > new Date()) return;
      const dayId = o === 5 ? 'schwach' : order[k++ % 3]; if (w >= 5 && w <= 6 && dayId === 'beine') return;
      const pd = day(dayId); const dur = 50 + Math.round(Math.random() * 20); const st = d.getTime() + 17 * 36e5;
      const sess = { id: uid(), demo: true, dayId, date: ymd(d), start: st, end: st + dur * 6e4, durationMin: dur, notes: '', prs: 0,
        entries: pd.items.map(([exId, target]) => { const g = base[exId] * (1 + w * 0.018 + (Math.random() - .5) * .02);
          const hi = +(/(\d+)\s*-\s*(\d+)/.exec(target) || [0, 0, 12])[2];
          return { exId, target, sets: [0, 1, 2].map(i => ({ w: Math.round(g / 1.25) * 1.25, r: Math.max(4, hi - i - Math.round(Math.random() * 2)), done: true, warm: false })) }; }) };
      S.sessions.push(sess); }); }
  for (let w = 0; w < 10; w += 2) { const d = new Date(start); d.setDate(d.getDate() + w * 7); S.bodyweight.push({ date: ymd(d), kg: Math.round((93 - w * 0.15 + Math.random() * .6) * 10) / 10, demo: true }); }
  recomputePRs(); save(); toast('Beispieldaten geladen'); go('fortschritt');
}

// ---------- Dialoge ----------
function openDlg(h) { $('#dlgbody').innerHTML = h; $('#dlg').showModal(); }
function closeDlg() { $('#dlg').open && $('#dlg').close(); }
function pickExercise(cb) {
  const groups = MUSCLES.map(m => `<h4 style="margin:10px 0 4px;color:var(--acc2)">${m}</h4>` + S.exercises.filter(e => e.muscle === m).map(e => `<div class="list-item" data-act="pick" data-v="${e.id}"><span>${esc(e.name)}</span><span>➕</span></div>`).join('')).join('');
  pickExercise.cb = cb;
  openDlg(`<div class="row between"><h3>Übung wählen</h3><button class="btn-sm" data-act="close">✕</button></div><input placeholder="Suchen …" data-in="exsearch"><div id="exlist">${groups}</div>`);
}
function newExercise(cb) {
  openDlg(`<h3>Eigene Übung</h3><label>Name</label><input id="nx-name" placeholder="z. B. Dips"><label>Muskel</label><select id="nx-m">${MUSCLES.map(m => `<option>${m}</option>`).join('')}</select><br><br>
    <div class="row between"><button class="btn-sm" data-act="close">Abbrechen</button><button class="btn-sm btn-acc" data-act="savenx">Speichern</button></div>`);
  newExercise.cb = cb;
}
function editDay(id) {
  const d = day(id); editDay.d = JSON.parse(JSON.stringify(d));
  const draw = () => { const x = editDay.d; $('#dlgbody').innerHTML = `<h3>${esc(x.icon)} ${esc(x.name)} bearbeiten</h3>
    ${x.items.map((it, i) => `<div class="list-item"><div style="flex:1">${esc(ex(it[0]).name)}<input value="${esc(it[1])}" data-in="dtarget" data-v="${i}" style="margin-top:4px;padding:6px"></div>
      <div class="row"><button class="btn-sm" data-act="dup" data-v="${i}">↑</button><button class="btn-sm" data-act="ddel" data-v="${i}">✕</button></div></div>`).join('')}
    <br><button class="btn" data-act="dadd">+ Übung</button><br><br><div class="row between"><button class="btn-sm" data-act="close">Abbrechen</button><button class="btn-sm btn-acc" data-act="dsave">Speichern</button></div>`; };
  editDay.draw = draw; openDlg(''); draw();
}

// ---------- Ereignisse ----------
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-act],[data-tab]'); if (!t) return;
  if (t.dataset.tab) return go(t.dataset.tab);
  const a = t.dataset.act, v = t.dataset.v;
  switch (a) {
    case 'tab': closeDlg(); go(v); break;
    case 'start': closeDlg(); startSession(v); break;
    case 'done': markDone(v); break;
    case 'warm': { const [, st] = setAt(v); st.warm = !st.warm; save(); vTraining(); break; }
    case 'addset': { const en = S.current.entries[+v]; const l = en.sets[en.sets.length - 1]; en.sets.push({ w: l ? l.w : '', r: l ? l.r : '', done: false, warm: false }); save(); vTraining(); break; }
    case 'delset': { const en = S.current.entries[+v]; if (en.sets.length > 1) en.sets.pop(); save(); vTraining(); break; }
    case 'addex': pickExercise(id => { S.current.entries.push({ exId: id, target: '', sets: prefill(id, '3') }); save(); vTraining(); }); break;
    case 'exmenu': { const i = +v; openDlg(`<h3>${esc(ex(S.current.entries[i].exId).name)}</h3><div class="row wrap"><button class="btn" data-act="exup" data-v="${i}">↑ nach oben</button><button class="btn" data-act="exswap" data-v="${i}">🔁 Ersetzen</button><button class="btn" data-act="exnote" data-v="${i}">📌 Notiz und Pause</button><button class="btn btn-bad" data-act="exdel" data-v="${i}">Entfernen</button><button class="btn" data-act="close">Zurück</button></div>`); break; }
    case 'exnote': { const e = ex(S.current.entries[+v].exId); openDlg(`<h3>📌 ${esc(e.name)}</h3><label>Notiz (bleibt für immer an der Übung)</label><input id="exn" value="${esc(e.note || '')}" placeholder="z. B. Sitz Stufe 4, Lehne 2, enger Griff">
      <label>Eigene Pause (Sekunden, leer = Standard ${S.settings.rest} s)</label><input id="exr" type="number" inputmode="numeric" value="${e.rest || ''}" placeholder="z. B. 180 bei Bankdrücken"><br><br><button class="btn btn-acc btn-full" data-act="exnotesave" data-v="${esc(e.id)}">Speichern</button>`); break; }
    case 'exnotesave': { const e = S.exercises.find(x => x.id === v); if (e) { e.note = $('#exn').value.trim(); e.rest = +$('#exr').value || null; save(); } closeDlg(); vTraining(); break; }
    case 'exup': { const i = +v, e = S.current.entries; if (i > 0) [e[i - 1], e[i]] = [e[i], e[i - 1]]; save(); closeDlg(); vTraining(); break; }
    case 'exdel': S.current.entries.splice(+v, 1); save(); closeDlg(); vTraining(); break;
    case 'exswap': { const i = +v; pickExercise(id => { const en = S.current.entries[i]; en.exId = id; en.sets = prefill(id, en.target); save(); vTraining(); }); break; }
    case 'exinfo': progEx = v; closeDlg(); go('fortschritt'); setTimeout(() => $('#c-ex')?.closest('.card').scrollIntoView({ behavior: 'smooth' }), 50); break;
    case 'pick': closeDlg(); pickExercise.cb && pickExercise.cb(v); break;
    case 'plates': { const en = S.current.entries[+v]; const w = +(en.sets.find(s => !s.done) || en.sets[en.sets.length - 1]).w || 0; const p = plates(w);
      openDlg(`<h3>🥏 ${fmtNum(w)} kg auf der Stange</h3>${p ? `<div class="mute">Pro Seite (Stange ${S.settings.bar} kg):</div><div class="plates">${p.out.map(([kg, col, hh]) => `<i style="background:${col};height:${hh * 2}px">${String(kg).replace(".", ",")}</i>`).join('') || '<span class="mute">nur Stange</span>'}</div>${p.rest > 0.01 ? `<div class="mute">Rest ${fmtNum(p.rest)} kg pro Seite passt nicht genau.</div>` : ''}` : '<div class="mute">Weniger als die Stange.</div>'}<br><button class="btn btn-full" data-act="close">OK</button>`); break; }
    case 'finish': finishSession(); break;
    case 'card': { const b = await progressCard(); const url = URL.createObjectURL(b); progressCard.blob = b;
      openDlg(`<div class="row between"><h3>🖼️ Dein Fortschritt</h3><button class="btn-sm" data-act="close">✕</button></div><img src="${url}" style="width:100%;border-radius:12px"><br><br>
        <div class="row"><a class="btn btn-acc" style="flex:1;text-align:center;text-decoration:none" href="${url}" download="Gym-Fortschritt ${today()}.png">⬇️ Speichern</a>${navigator.canShare ? '<button class="btn" style="flex:1" data-act="share">📤 Teilen</button>' : ''}</div>`); break; }
    case 'share': try { await navigator.share({ files: [new File([progressCard.blob], 'Gym-Fortschritt.png', { type: 'image/png' })] }); } catch (e) {} break;
    case 'discard': if (confirm('Training wirklich verwerfen? Alles von heute ist dann weg.')) { S.current = null; stopRest(); save(); go('heute'); } break;
    case 'cdate': openDlg(`<h3>Datum der Einheit</h3><input type="date" id="cd" value="${S.current.date}"><br><br><button class="btn btn-acc btn-full" data-act="cdsave">OK</button>`); break;
    case 'cdsave': S.current.date = $('#cd').value || today(); save(); closeDlg(); vTraining(); break;
    case 'rest-add': restEnd += 15000; tickRest(); break;
    case 'rest-stop': stopRest(); break;
    case 'later': openDlg(`<h3>Training nachtragen</h3><label>Datum</label><input type="date" id="ld" value="${today()}"><label>Tag</label><select id="lday">${S.plan.map(d => `<option value="${d.id}">${esc(d.icon)} ${esc(d.name)}</option>`).join('')}<option value="frei">➕ Frei</option></select><br><br><button class="btn btn-acc btn-full" data-act="laterok">Weiter</button>`); break;
    case 'laterok': { const d = $('#ld').value, id = $('#lday').value; closeDlg(); if (S.current) { toast('Erst laufendes Training beenden'); break; } startSession(id, d); break; }
    case 'dayinfo': { const ss = S.sessions.filter(s => s.date === v);
      if (!ss.length && v >= today()) { openDlg(`<h3>📅 ${fmtDate(v)} planen</h3><div class="row wrap">${S.plan.map(d => `<button class="btn-sm" style="${S.weekPlan[v] === d.id ? 'background:var(--acc);color:#111;font-weight:700' : ''}" data-act="plan" data-v="${v}|${d.id}">${esc(d.icon)} ${esc(d.name)}</button>`).join('')}<button class="btn-sm" data-act="plan" data-v="${v}|">🛌 Ruhetag</button></div>
        ${v === today() && !S.current ? `<br><button class="btn btn-acc btn-full" data-act="start" data-v="${S.weekPlan[v] || nextDay().id}">▶ Jetzt starten</button>` : ''}<br><button class="btn btn-full" data-act="close">Schließen</button>`); break; }
      if (ss.length === 1) sessionDialog(ss[0].id); else if (ss.length) openDlg(ss.map(s => `<div class="list-item" data-act="sess" data-v="${s.id}">${esc(day(s.dayId)?.name || 'Frei')}<span>›</span></div>`).join('')); else if (v <= today() && !S.current) { openDlg(`<h3>${fmtDate(v)}</h3><div class="mute">Kein Training an dem Tag.</div><br><div class="row wrap">${S.plan.map(d => `<button class="btn-sm" data-act="startat" data-v="${d.id}|${v}">${esc(d.icon)} ${esc(d.name)} nachtragen</button>`).join('')}</div><br><button class="btn btn-full" data-act="close">Schließen</button>`); } break; }
    case 'plan': { const [d, id] = v.split('|'); if (id) S.weekPlan[d] = id; else delete S.weekPlan[d]; save(); closeDlg(); render(); break; }
    case 'startat': { const [id, d] = v.split('|'); closeDlg(); startSession(id, d); break; }
    case 'sess': sessionDialog(v); break;
    case 'delsess': if (confirm('Diese Einheit löschen?')) { S.sessions = S.sessions.filter(s => s.id !== v); recomputePRs(); save(); closeDlg(); render(); } break;
    case 'editsess': { if (S.current) { toast('Erst laufendes Training beenden'); break; } const s = S.sessions.find(x => x.id === v); S.sessions = S.sessions.filter(x => x.id !== v);
      s.entries.forEach(en => en.sets.forEach(st => st.done = true)); s.edit = true; S.current = s; save(); closeDlg(); go('training'); break; }
    case 'close': closeDlg(); break;
    case 'bw': openDlg(`<h3>⚖️ Körpergewicht</h3><label>Datum</label><input type="date" id="bwd" value="${today()}"><label>kg</label><input type="number" step="0.1" inputmode="decimal" id="bwk" placeholder="93.0">
      <div class="grid3"><div><label>Taille cm</label><input type="number" step="0.5" inputmode="decimal" id="bwt" placeholder="Nabel"></div><div><label>Arm cm</label><input type="number" step="0.5" inputmode="decimal" id="bwa" placeholder="angespannt"></div><div><label>Brust cm</label><input type="number" step="0.5" inputmode="decimal" id="bwb"></div></div>
      <div class="mute" style="margin-top:6px">Maße sind freiwillig. Immer morgens, gleiche Stelle.</div><br><button class="btn btn-acc btn-full" data-act="bwsave">Speichern</button>`); break;
    case 'bwsave': { const num = id => parseFloat(($(id).value || '').replace(',', '.')) || null; const kg = num('#bwk'), waist = num('#bwt'), arm = num('#bwa'), chest = num('#bwb');
      if (!kg && !waist && !arm && !chest) break; const d = $('#bwd').value || today(); const old = S.bodyweight.find(p => p.date === d) || {};
      S.bodyweight = S.bodyweight.filter(p => p.date !== d); S.bodyweight.push({ date: d, kg: kg || old.kg || null, waist: waist || old.waist || null, arm: arm || old.arm || null, chest: chest || old.chest || null }); save(); closeDlg(); render(); break; }
    case 'photo': openDlg(`<div class="row between"><h3>Foto</h3><button class="btn-sm" data-act="close">✕</button></div><img src="${t.querySelector('img').src}" style="width:100%;border-radius:12px"><br><br><button class="btn btn-bad btn-full" data-act="delphoto" data-v="${v}">Foto löschen</button>`); break;
    case 'delphoto': if (confirm('Foto löschen?')) { await DB.del(v); closeDlg(); vMehr(); } break;
    case 'newex': newExercise(() => vMehr()); break;
    case 'savenx': { const n = $('#nx-name').value.trim(); if (!n) break; const e = { id: 'x' + uid(), name: n, muscle: $('#nx-m').value }; S.exercises.push(e); save(); closeDlg(); newExercise.cb && newExercise.cb(e.id); break; }
    case 'editday': editDay(v); break;
    case 'dup': { const i = +v, it = editDay.d.items; if (i > 0) [it[i - 1], it[i]] = [it[i], it[i - 1]]; editDay.draw(); break; }
    case 'ddel': editDay.d.items.splice(+v, 1); editDay.draw(); break;
    case 'dadd': { const keep = editDay.d; pickExercise(id => { keep.items.push([id, '3 × 10-12']); editDay.d = keep; openDlg(''); editDay.draw(); }); break; }
    case 'dsave': { const i = S.plan.findIndex(d => d.id === editDay.d.id); S.plan[i] = editDay.d; save(); closeDlg(); vMehr(); break; }
    case 'export': S.settings.lastExport = today(); save(); download(`Gym-Sicherung ${today()}.json`, JSON.stringify(S), 'application/json'); toast('Sicherung heruntergeladen'); break;
    case 'mdexport': mdExport(); break;
    case 'demo': demo(); break;
    case 'undemo': S.sessions = S.sessions.filter(x => !x.demo); S.bodyweight = S.bodyweight.filter(x => !x.demo); recomputePRs(); save(); toast('Beispieldaten entfernt'); go('heute'); break;
    case 'reset': if (confirm('Wirklich ALLE Trainingsdaten löschen? (Fotos bleiben)') && confirm('Sicher? Das geht nicht rückgängig.')) { S = freshState(); save(); go('heute'); } break;
  }
});
document.addEventListener('input', ev => {
  const t = ev.target; const k = t.dataset.in; if (!k) return;
  if (k === 'w' || k === 'r') { const [, st] = setAt(t.dataset.v); st[k] = t.value === '' ? '' : +t.value.replace(',', '.'); save(); }
  else if (k === 'notes') { S.current.notes = t.value; save(); }
  else if (k === 'dtarget') editDay.d.items[+t.dataset.v][1] = t.value;
  else if (k.startsWith('set-')) { const n = +t.value; if (n > 0) { S.settings[k.slice(4)] = n; save(); } }
  else if (k === 'exsearch') { const q = t.value.toLowerCase(); document.querySelectorAll('#exlist .list-item').forEach(li => li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none'); }
});
document.addEventListener('change', async ev => {
  const t = ev.target; const k = t.dataset.in;
  if (k === 'progex') { progEx = t.value; drawExChart(); }
  else if (k === 'cmpa' || k === 'cmpb') { cmpSel[k === 'cmpa' ? 0 : 1] = +t.value; compareView(); }
  else if (k === 'photo' && t.files.length) addPhotos([...t.files]);
  else if (k === 'import' && t.files[0]) { try { const d = JSON.parse(await t.files[0].text()); if (!d.sessions) throw 0;
      if (confirm(`Sicherung mit ${d.sessions.length} Einheiten laden? Aktuelle Daten werden ersetzt.`)) { S = Object.assign(freshState(), d); recomputePRs(); save(); go('heute'); toast('Sicherung geladen'); }
    } catch (e) { toast('Datei ist keine Gym-Sicherung'); } }
});

// Offline-Fähigkeit
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
if (S.current) tab = 'training';
go(tab);
