'use strict';
// Gym 1.5.0 (05.11.2026): Trainings-Feedback (Coach), Wochen-Tab (Rückblick + Prognose), Trend-Diagramm für „Heute".
// Alles regelbasiert und offline: nur echte Daten aus der App, nichts wird erfunden. Fehlen Daten, sagt die App das.

// ---------- Feedback-Coach ----------
const COACH_RX = {
  tired: /müde|tot\b|kaputt|keine kraft|null kraft|schlapp|erschöpft|platt|ausgelaugt|leer\b/,
  sleep: /schlaf|geschlafen|nacht/,
  caffeine: /monster|energy|kaffee|koffein|pre.?workout|booster|red ?bull/,
  pain: /schmerz|weh\b|tut weh|zwickt|zieht|verletz|stech|knackt|gezerrt/,
  technique: /technik|nicht richtig|unsauber|ausführung|\bform\b|schwung|abgefälscht/,
  hard: /schwer|nicht geschafft|nicht packen|zu viel|versagt|nicht hoch/,
  good: /\bgut\b|stark|geil|top|leicht|rekord|\bpr\b|besser|verbessert|mega|perfekt/,
  sick: /krank|erkält|fieber|husten/,
  stress: /stress|prüfung|klausur|lernen/,
};
function noteFlags(note) {
  const n = (note || '').toLowerCase(); const f = {};
  for (const [k, rx] of Object.entries(COACH_RX)) f[k] = rx.test(n);
  if (/nicht (so )?gut|schlecht/.test(n)) f.good = false;
  const h = /(\d+(?:[.,]\d)?)\s*(?:-|bis)?\s*(\d+)?\s*(?:stunden|std|h)\b/.exec(n);
  f.sleepH = f.sleep && h ? +(h[2] || h[1]).replace(',', '.') : null;
  return f;
}
function targetRange(target) { const m = /(\d+)\s*-\s*(\d+)/.exec(target || ''); return m ? [+m[1], +m[2]] : null; }
function targetSets(target) { const m = /^(\d+)\s*×/.exec(target || ''); return m ? +m[1] : null; }
// Bestes Set: mit Gewicht nach 1RM, ohne Zusatzgewicht (Klimmzüge, Beinheben) nach Wiederholungen
function bestOf(sets) { let b = null; for (const st of sets) { const e = e1rm(st.w || 0, st.r); const sc = e > 0 ? e : st.r / 1000; if (!b || sc > b.sc) b = { e, w: st.w || 0, r: st.r, sc }; } return b; }
function pctOf(cur, prev) { if (!cur || !prev) return null; if (cur.e > 0 && prev.e > 0) return (cur.e / prev.e - 1) * 100; if (!cur.e && !prev.e && prev.r) return (cur.r / prev.r - 1) * 100; return null; }

// Vergleich jeder Übung mit dem letzten Mal davor (egal an welchem Tag)
function exerciseDeltas(sess) {
  const out = [];
  for (const en of sess.entries) {
    const sets = en.sets.filter(s => s.done && !s.warm && s.r > 0); if (!sets.length) continue;
    const cur = bestOf(sets); let prev = null;
    for (const s of sorted().reverse()) { if (s.id === sess.id || s.date > sess.date || (s.date === sess.date && (s.start || 0) >= (sess.start || 0))) continue;
      const pe = s.entries.find(x => x.exId === en.exId); const ps = pe ? pe.sets.filter(x => x.done && !x.warm && x.r > 0) : [];
      if (ps.length) { prev = { ...bestOf(ps), date: s.date }; break; } }
    const rg = targetRange(en.target); const ts = targetSets(en.target);
    out.push({ exId: en.exId, name: ex(en.exId).name, cur, prev, pct: pctOf(cur, prev),
      sets: sets.length, tSets: ts, lo: rg ? rg[0] : null, hi: rg ? rg[1] : null,
      belowLo: rg ? sets.filter(s => s.r < rg[0]).length : 0, allTop: rg ? sets.every(s => s.r >= rg[1]) : false, prs: sets.filter(s => s.pr).length });
  }
  return out;
}

// Rückmeldung zu einer Einheit: 6 Punkte wie gewünscht + Rückfrage, wenn die Notiz unklar ist
function coachFeedback(sess) {
  const f = noteFlags(sess.notes); const d = exerciseDeltas(sess);
  const good = [], bad = [], errors = [], next = [], adjust = [], focus = [];
  let ask = null; const withPrev = d.filter(x => x.pct != null);
  const down = withPrev.filter(x => x.pct <= -5), up = withPrev.filter(x => x.pct >= 2.5);
  const prs = d.reduce((a, x) => a + x.prs, 0);
  const missing = d.filter(x => x.tSets && x.sets < x.tSets);
  const below = d.filter(x => x.belowLo > 0); const top = d.filter(x => x.allTop);
  const dur = sess.durationMin || 0;

  // 1 gut
  if (sess.entries.length) good.push(`Du warst da und hast ${d.length} ${d.length === 1 ? 'Übung' : 'Übungen'} mit ${d.reduce((a, x) => a + x.sets, 0)} Arbeitssätzen gemacht. Erscheinen ist der wichtigste Teil.`);
  if (prs) good.push(`${prs} ${prs === 1 ? 'neuer Rekord' : 'neue Rekorde'}.`);
  if (up.length) good.push(`Stärker als letztes Mal: ${up.map(x => `${x.name} (+${Math.round(x.pct)} %)`).join(', ')}.`);
  if (f.good) good.push('Du schreibst selbst, dass es gut lief. Merk dir, was heute anders war (Schlaf, Essen, Uhrzeit).');
  if (f.tired && !down.length) good.push('Trotz Müdigkeit hast du dein Niveau gehalten. Das ist stark.');
  if (sess.notes && sess.notes.trim().length > 20) good.push('Du hast eine ehrliche Notiz geschrieben. Ohne die könnte man den Leistungsabfall nicht erklären.');

  // 2 nicht optimal
  if (down.length) bad.push(`Schwächer als letztes Mal: ${down.map(x => `${x.name} ${Math.round(x.pct)} % (${fmtNum(x.cur.w)}×${x.cur.r} statt ${fmtNum(x.prev.w)}×${x.prev.r} am ${fmtDate(x.prev.date)})`).join('; ')}.`);
  const uniform = missing.length >= 3 && missing.length >= d.filter(x => x.tSets).length - 1;
  if (uniform) bad.push(`Bei fast allen Übungen weniger Sätze als im Plan (z. B. ${missing[0].sets} statt ${missing[0].tSets}). Wenn das Absicht ist: Plan unter Mehr → Plan bearbeiten anpassen, dann stimmt auch die Auswertung.`);
  else if (missing.length) bad.push(`Weniger Sätze als geplant: ${missing.map(x => `${x.name} ${x.sets}/${x.tSets}`).join(', ')}.`);
  if (below.length) bad.push(`Unter dem Wdh-Ziel: ${below.map(x => `${x.name} (Ziel ${x.lo} bis ${x.hi})`).join(', ')}. Dann ist das Gewicht für diesen Tag zu schwer.`);
  if (dur > 75) bad.push(`${dur} Minuten sind lang. Ab ca. 75 min lässt die Qualität meist nach.`);

  // 3 mögliche Fehler / Ursachen (nur aus Notiz und Daten, keine Ferndiagnose)
  if (f.sleep && (f.sleepH == null || f.sleepH < 7)) errors.push(`Zu wenig Schlaf${f.sleepH ? ` (${fmtNum(f.sleepH)} h)` : ''}: Kraft und Konzentration hängen stark am Schlaf, das Gefühl „ausgeschlafen" täuscht oft.`);
  if (f.caffeine) errors.push('Koffein (z. B. Monster) macht wach, bringt aber keine Kraft zurück, die durch Schlafmangel oder Ermüdung fehlt.');
  const recent = sorted().filter(s => s.id !== sess.id && s.date < sess.date && daysBetween(s.date, sess.date) <= 2);
  const sameMus = recent.filter(s => workSets(s).some(st => d.some(x => ex(x.exId).muscle === ex(st.exId).muscle)));
  if (sameMus.length) errors.push(`Dieselben Muskeln waren erst vor ${daysBetween(sameMus[sameMus.length - 1].date, sess.date)} Tag(en) dran (${day(sameMus[sameMus.length - 1].dayId)?.name || 'Frei'}). Unter 48 h Pause ist ein Abfall normal.`);
  if (f.sick) errors.push('Krank trainieren kostet Kraft und verlängert die Erholung.');
  if (f.stress) errors.push('Viel Stress (Prüfungen) wirkt wie zu wenig Schlaf auf die Leistung.');
  if (f.technique) errors.push('Du schreibst von Problemen bei der Ausführung. Unsaubere Wiederholungen zählen nicht als Fortschritt und belasten Gelenke.');
  if (f.pain) errors.push('Du schreibst von Schmerzen. Das ist kein normales Muskelbrennen, wenn es stechend ist, an einem Gelenk sitzt oder am nächsten Tag noch da ist.');
  if (!errors.length && down.length) errors.push('Aus den Daten allein lässt sich der Abfall nicht erklären. Schreib dazu, wie du geschlafen und gegessen hast.');

  // 4 nächstes Training verbessern
  if (down.length && (f.tired || f.sleep || sameMus.length)) next.push('Nicht gleich alles umwerfen: Ein schwacher Tag ist normal. Nächstes Mal mit normalem Schlaf dieselben Gewichte wie beim besseren Mal davor probieren.');
  for (const x of top) { const nw = nextWeight(x.exId, `x ${x.lo}-${x.hi}`); if (nw) next.push(`${x.name}: alle Sätze bei ${x.hi}+ Wdh → nächstes Mal ${fmtNum(nw)} kg.`); }
  for (const x of below) next.push(`${x.name}: Gewicht halten oder um eine Stufe runter, bis du in jedem Satz ${x.lo} Wdh sauber schaffst.`);
  if (missing.length && !uniform) next.push('Plane die Sätze ein, die gefehlt haben, lieber mit etwas weniger Gewicht.');
  if (!next.length) next.push('Doppelte Progression weiterfahren: erst Wiederholungen bis zum oberen Ende, dann Gewicht hoch.');

  // 5 Anpassungen / Übungen
  if (f.pain) adjust.push('Die schmerzende Übung beim nächsten Mal weglassen oder leichter ersetzen (z. B. Maschine statt freie Gewichte). Bleibt es länger, zum Arzt oder Physio.');
  if (f.technique) adjust.push('Gewicht 10 bis 20 % runter, langsam ablassen (2 bis 3 s), ein Video vom Satz machen und vergleichen.');
  if (down.length >= 3 && (f.tired || f.sleep)) adjust.push('An Tagen mit sehr wenig Schlaf: nur die Hauptübungen, je 1 Satz weniger. Lieber sauber und kurz als lang und schwach.');
  if (dur > 75) adjust.push('Pausen mit dem Timer einhalten, Handy nur für die App.');

  // 6 besonders beachten
  if (f.sleep && (f.sleepH == null || f.sleepH < 7)) focus.push('Vor dem nächsten Training 7 bis 8 h Schlaf. Das bringt mehr als jedes Monster.');
  if (sameMus.length) focus.push('Mindestens 48 h zwischen zwei harten Einheiten für dieselben Muskeln.');
  if (f.pain) focus.push('Schmerzen beobachten und in die Notiz schreiben, ob es besser wird.');
  focus.push('Nach dem Training 1 Satz Notiz: Schlaf, Energie (1 bis 5), Schmerzen ja/nein. Dann wird die Rückmeldung genauer.');

  // Rückfrage bei unklarer Notiz
  const n = (sess.notes || '').trim();
  if (!n) ask = 'Wie lief es? Schreib kurz: Schlaf (Stunden), Energie 1 bis 5, Schmerzen ja/nein.';
  else if (!Object.entries(f).some(([k, v]) => k !== 'sleepH' && v) && n.length < 40) ask = 'Deine Notiz ist kurz. War das Training eher leicht oder schwer, und wie hast du geschlafen?';
  else if (uniform) ask = `Machst du absichtlich ${missing[0].sets} Sätze pro Übung statt ${missing[0].tSets}?`;
  else if (down.length && !f.tired && !f.sleep && !f.sick) ask = 'Du warst schwächer als letztes Mal. Wie viel hast du geschlafen und gegessen?';
  const enough = withPrev.length > 0;
  return { good, bad, errors, next, adjust, focus, ask, enough, down: down.length, up: up.length, prs,
    dataNote: enough ? '' : 'Erste Einheit mit diesen Übungen: Ein Vergleich ist erst ab dem zweiten Mal möglich.' };
}
function coachHtml(sess) {
  const c = coachFeedback(sess);
  const sec = (t, arr, cls) => arr.length ? `<div class="coach ${cls}"><b>${t}</b><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<div class="mute" style="margin-bottom:6px">Regelbasiert aus deinen Zahlen und deiner Notiz, keine Garantie. Bei Schmerzen zählt der Arzt, nicht die App.</div>
    ${c.dataNote ? `<div class="alert">${c.dataNote}</div>` : ''}
    ${sec('1 Das war gut', c.good, 'ok')}${sec('2 Nicht optimal', c.bad, 'bad')}${sec('3 Mögliche Ursachen', c.errors, '')}
    ${sec('4 Nächstes Mal besser', c.next, '')}${sec('5 Anpassungen', c.adjust, '')}${sec('6 Besonders beachten', c.focus, '')}
    ${c.ask ? `<div class="alert ok">❓ ${esc(c.ask)}<br><button class="btn-sm" data-act="coachnote" data-v="${sess.id}" style="margin-top:6px">Antwort als Notiz ergänzen</button></div>` : ''}`;
}
function coachDialog(id) {
  const s = S.sessions.find(x => x.id === id); if (!s) return;
  const cl = s.claude && s.claude.text ? `<div class="alert ok" style="white-space:pre-wrap">💬 <b>Claude${s.claude.datum ? ' · ' + esc(s.claude.datum) : ''}</b><br>${esc(s.claude.text)}</div>` : '';
  openDlg(`<div class="row between"><h3>🧠 Rückmeldung · ${esc(day(s.dayId)?.name || 'Frei')} ${fmtDate(s.date)}</h3><button class="btn-sm" data-act="close">✕</button></div>${cl}${coachHtml(s)}<br><button class="btn btn-full" data-act="close">Verstanden</button>`);
}

// ---------- Woche ----------
let weekOff = null; // 0 = diese Woche, -1 = letzte Woche …
function weekData(mon) {
  const end = addDays(mon, 6);
  const ss = sorted().filter(s => s.date >= mon && s.date <= end);
  const pv = sorted().filter(s => s.date >= addDays(mon, -7) && s.date < mon);
  const vol = ss.reduce((a, s) => a + volume(s), 0), vp = pv.reduce((a, s) => a + volume(s), 0);
  const m = muscleSets(mon, end);
  const core = new Set(ss.filter(s => day(s.dayId)?.core).map(s => s.dayId));
  return { mon, end, ss, pv, vol, vp, m, core, sets: ss.reduce((a, s) => a + workSets(s).length, 0), prs: ss.reduce((a, s) => a + (s.prs || 0), 0),
    dur: ss.reduce((a, s) => a + (s.durationMin || 0), 0) };
}
// Beste Leistung je Übung in der Woche vs. bestes Mal vorher
function weekExercises(w) {
  const rows = {};
  for (const s of w.ss) for (const en of s.entries) { const st = en.sets.filter(x => x.done && !x.warm && x.r > 0); if (!st.length) continue;
    const b = bestOf(st); if (!rows[en.exId] || b.sc > rows[en.exId].cur.sc) rows[en.exId] = { exId: en.exId, cur: b }; }
  return Object.values(rows).map(r => {
    let prev = null; for (const s of sorted()) if (s.date < w.mon) for (const en of s.entries) if (en.exId === r.exId) { const st = en.sets.filter(x => x.done && !x.warm && x.r > 0); if (st.length) { const b = bestOf(st); if (!prev || b.sc > prev.sc) prev = b; } }
    return { ...r, name: ex(r.exId).name, muscle: ex(r.exId).muscle, prev, pct: pctOf(r.cur, prev), bw: !r.cur.e };
  }).sort((a, b) => MUSCLES.indexOf(a.muscle) - MUSCLES.indexOf(b.muscle));
}
function weekGoals(w) {
  const g = S.settings.weekGoal; const musOk = MUSCLES.filter(k => w.m[k] >= WEEK_TARGET[k]);
  const legs = LEG_MUSCLES.some(k => w.m[k] > 0);
  return [
    { ok: w.ss.length >= g, t: `${g} Einheiten (Wochenziel)`, v: `${w.ss.length}/${g}` },
    { ok: w.core.size >= 3, t: 'Push, Pull und Beine je einmal', v: `${w.core.size}/3` },
    { ok: legs, t: 'Beine trainiert', v: legs ? 'ja' : 'nein' },
    { ok: musOk.length === MUSCLES.length, t: 'Alle Muskeln mit genug Sätzen', v: `${musOk.length}/${MUSCLES.length}`, extra: MUSCLES.filter(k => !musOk.includes(k)).map(k => `${k} ${w.m[k]}/${WEEK_TARGET[k]}`).join(', ') },
    { ok: w.prs > 0, t: 'Mindestens ein Rekord', v: String(w.prs) },
  ];
}
// Prognose für die nächste Woche: nur aus vorhandenen Daten, mit Voraussetzungen
function forecast() {
  const real = S.sessions.filter(s => !s.demo); const t = today(); const mon = ymd(mondayOf(new Date()));
  const need = [];
  if (real.length < 3) need.push(`mindestens 3 Einheiten (du hast ${real.length})`);
  const weeks = []; for (let i = 1; i <= 4; i++) { const k = addDays(mon, -7 * i); if (sorted().length && k >= weekKey(sorted()[0].date)) weeks.push(S.sessions.filter(s => weekKey(s.date) === k).length); }
  const cur = S.sessions.filter(s => weekKey(s.date) === mon).length;
  const avg = weeks.length ? weeks.reduce((a, b) => a + b) / weeks.length : cur;
  if (!weeks.length) need.push('eine volle abgeschlossene Woche für den Schnitt');
  // Ziele je Übung aus dem Plan (doppelte Progression)
  const ex1 = [];
  for (const d of S.plan.filter(x => x.core)) for (const [exId, target] of d.items) {
    const rg = targetRange(target); const last = lastEntry(exId); if (!rg || !last || !last.sets.length) continue;
    const w = Math.max(...last.sets.map(s => s.w || 0)); const nw = nextWeight(exId, target); const minR = Math.min(...last.sets.map(s => s.r));
    ex1.push({ name: ex(exId).name, day: d.name, last: last.sets.map(s => `${fmtNum(s.w || 0)}×${s.r}`).join(', '),
      goal: nw ? `${fmtNum(nw)} kg × ${rg[0]}` : minR < rg[0] ? `${fmtNum(w)} kg halten, in jedem Satz ${rg[0]} Wdh` : `${fmtNum(w)} kg, +1 Wdh pro Satz (bis ${rg[1]})`,
      kind: nw ? 'up' : minR < rg[0] ? 'hold' : 'reps' });
  }
  const bf = benchForecast(); const bs = e1rmSeries(S.settings.benchEx);
  let bench = null;
  if (bs.length >= 3) { const x0 = parseYmd(bs[0].date); const xs = bs.map(p => (parseYmd(p.date) - x0) / 864e5), ys = bs.map(p => p.e);
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    const sl = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
    bench = { cur: bf.cur, slopeWeek: sl * 7, next: Math.min(bf.cur + Math.max(0, sl * 7), bf.cur * 1.03) }; }
  const weak = weakest(14);
  const lastNotes = sorted().filter(s => daysBetween(s.date, t) <= 7).map(s => noteFlags(s.notes));
  const tired = lastNotes.some(f => f.tired || (f.sleep && (f.sleepH == null || f.sleepH < 7)));
  const pain = lastNotes.some(f => f.pain);
  const goals = [];
  goals.push(`${Math.max(S.settings.weekGoal, Math.min(4, Math.round(avg) || S.settings.weekGoal))} Einheiten, davon Push, Pull und Beine je einmal`);
  const up = ex1.find(x => x.kind === 'up') || ex1.find(x => x.kind === 'reps');
  if (up) goals.push(`${up.name}: ${up.goal}`);
  if (real.length >= 2) goals.push(`Schwachstelle ${weak[0].k}: mindestens ${WEEK_TARGET[weak[0].k]} harte Sätze`);
  if (tired) goals.push('Vor jedem Training mindestens 7 h Schlaf (letzte Woche war Müdigkeit oder Schlafmangel ein Thema)');
  if (pain) goals.push('Schmerzende Übung schonen und beobachten');
  goals.push('Nach jedem Training eine kurze Notiz (Schlaf, Energie 1 bis 5, Schmerzen)');
  return { need, avg, cur, weeks: weeks.length, ex1, bench, goals, tired, pain };
}

function vWoche() {
  if (!S.sessions.length) { $('#view').innerHTML = `<div class="card empty">Der Wochenüberblick braucht Daten.<br>Speichere dein erstes Training, dann siehst du hier Rückblick und Prognose.</div>`; return; }
  if (weekOff === null) weekOff = S.sessions.some(s => weekKey(s.date) === ymd(mondayOf(new Date()))) && !S.sessions.some(s => weekKey(s.date) === addDays(ymd(mondayOf(new Date())), -7)) ? 0 : -1;
  const mon = addDays(ymd(mondayOf(new Date())), 7 * weekOff); const w = weekData(mon); const ex1 = weekExercises(w); const gl = weekGoals(w);
  const bf = benchForecast(); const si = strengthIndex(); const fc = forecast();
  const wn = weekOff === 0 ? 'Diese Woche' : weekOff === -1 ? 'Letzte Woche' : `Woche vom ${fmtDate(mon)}`;
  let h = `<div class="row between" style="margin-bottom:10px"><button class="btn-sm" data-act="wk" data-v="-1">◀</button><b>${wn} · ${fmtDate(mon).slice(4)} bis ${fmtDate(w.end).slice(4)}</b><button class="btn-sm" data-act="wk" data-v="1" ${weekOff >= 0 ? 'disabled' : ''}>▶</button></div>`;
  h += `<h2 class="sect">① Rückblick und aktueller Stand</h2>`;
  if (!w.ss.length) h += `<div class="card empty">In dieser Woche ist kein Training gespeichert.${weekOff === 0 ? '' : '<br>Entweder war Pause, oder es wurde nicht eingetragen. (Verlauf → Training nachtragen)'}</div>`;
  else {
    h += `<div class="grid3" style="margin-bottom:12px"><div class="stat"><b>${w.ss.length}</b><span>Einheiten</span></div>
      <div class="stat"><b>${w.vp ? (w.vol >= w.vp ? '+' : '') + Math.round((w.vol / w.vp - 1) * 100) + ' %' : fmtNum(w.vol / 1000) + ' t'}</b><span>Volumen${w.vp ? ' vs. Vorwoche' : ''}</span></div>
      <div class="stat"><b>${w.sets}</b><span>Arbeitssätze</span></div><div class="stat"><b>${w.prs}</b><span>Rekorde</span></div>
      <div class="stat"><b>${w.dur}</b><span>Minuten</span></div><div class="stat"><b>${w.core.size}/3</b><span>Pflichttage</span></div></div>`;
    h += `<div class="card"><h2>Einheiten</h2>${w.ss.map(s => `<div class="list-item" data-act="sess" data-v="${s.id}"><div><b>${esc(day(s.dayId)?.icon || '➕')} ${esc(day(s.dayId)?.name || 'Frei')}</b><div class="mute">${fmtDate(s.date)} · ${s.durationMin || '?'} min · ${workSets(s).length} Sätze${s.prs ? ` · 🏆 ${s.prs}` : ''}</div>${s.notes ? `<div class="mute">📝 ${esc(s.notes.slice(0, 90))}${s.notes.length > 90 ? '…' : ''}</div>` : ''}</div><button class="btn-sm" data-act="coach" data-v="${s.id}">🧠</button></div>`).join('')}</div>`;
    h += `<div class="card"><h2>Übungen · bestes Mal diese Woche vs. bisher</h2>${ex1.map(r => `<div class="list-item"><div><b>${esc(r.name)}</b><div class="mute">${esc(r.muscle)}${r.prev ? ` · bisher bestes: ${r.prev.w ? fmtNum(r.prev.w) + '×' : ''}${r.prev.r}${r.prev.w ? '' : ' Wdh'}` : ' · erstes Mal'}</div></div><div style="text-align:right"><b>${r.cur.w ? fmtNum(r.cur.w) + ' × ' + r.cur.r : r.cur.r + ' Wdh'}</b><div style="color:${r.pct == null ? 'var(--mute)' : r.pct >= 0.5 ? 'var(--ok)' : r.pct <= -3 ? 'var(--bad)' : 'var(--mute)'}">${r.pct == null ? 'neu' : (r.pct >= 0 ? '+' : '') + fmtNum(Math.round(r.pct * 10) / 10) + (r.bw ? ' % Wdh' : ' % 1RM')}</div></div></div>`).join('')}</div>`;
  }
  h += `<div class="card"><h2>Volumen und Einheiten · 8 Wochen</h2><div class="chartbox"><canvas id="c-wk"></canvas></div><div class="mute">Die gewählte Woche ist hervorgehoben.</div></div>`;
  if (w.ss.length) h += `<div class="card"><h2>Sätze pro Muskel · Ziel</h2><div class="chartbox tall"><canvas id="c-wkm"></canvas></div></div>
    <div class="card"><h2>Ziele dieser Woche</h2>${gl.map(g => `<div class="list-item"><div>${g.ok ? '✅' : '❌'} ${esc(g.t)}${g.extra && !g.ok ? `<div class="mute">fehlt: ${esc(g.extra)}</div>` : ''}</div><b>${esc(g.v)}</b></div>`).join('')}</div>`;
  h += `<div class="card"><h2>Wo du gerade stehst</h2><div class="grid3">
    <div class="stat"><b>${bf.cur ? fmtNum(Math.round(bf.cur * 10) / 10) : '–'}</b><span>Bank 1RM (Ziel ${bf.goal})</span></div>
    <div class="stat"><b>${si == null ? '–' : (si >= 0 ? '+' : '') + Math.round(si) + ' %'}</b><span>Kraft seit Start</span></div>
    <div class="stat"><b>${streakWeeks()}</b><span>Wochen in Folge</span></div></div></div>`;
  // Abteil 2
  h += `<h2 class="sect">② Nächste Woche · Prognose</h2>`;
  if (fc.need.length) h += `<div class="alert bad">Für eine verlässliche Prognose fehlt noch: ${fc.need.map(esc).join(', ')}. Die Werte unten sind deshalb nur ein erster Anhaltspunkt.</div>`;
  h += `<div class="card"><h2>🎯 Vorschlag: Ziele für nächste Woche</h2>${fc.goals.map(g => `<div class="list-item"><div>☐ ${esc(g)}</div></div>`).join('')}</div>`;
  h += `<div class="card"><h2>Realistisch erreichbar</h2>
    <div class="list-item"><div>Einheiten pro Woche</div><b>${fc.weeks ? `Ø ${fmtNum(Math.round(fc.avg * 10) / 10)} (letzte ${fc.weeks} Wo.)` : `${fc.cur} bisher diese Woche`}</b></div>
    <div class="list-item"><div>Bank 1RM in einer Woche</div><b>${fc.bench ? `${fmtNum(Math.round(fc.bench.cur * 10) / 10)} → ca. ${fmtNum(Math.round(fc.bench.next * 10) / 10)} kg` : 'ab 3 Bank-Einheiten'}</b></div>
    <div class="mute" style="margin-top:6px">Faustregel für Rückkehrer: pro Woche +1 Wdh oder +1,25 bis 2,5 kg bei einer Übung ist realistisch. Mehr ist Glück, nicht Plan. Die Prognose ist keine Garantie.</div></div>`;
  if (fc.ex1.length) h += `<div class="card"><h2>Ziel je Übung (doppelte Progression)</h2>${fc.ex1.map(x => `<div class="list-item"><div><b>${esc(x.name)}</b><div class="mute">${esc(x.day)} · letztes Mal ${esc(x.last)}</div></div><div style="text-align:right;max-width:46%">${x.kind === 'up' ? '⬆️' : x.kind === 'hold' ? '↔️' : '➕'} ${esc(x.goal)}</div></div>`).join('')}</div>`;
  h += `<div class="card"><h2>Damit es klappt (Voraussetzungen)</h2><ul class="plain">
    <li>3 Einheiten mit mindestens 48 h Pause für dieselben Muskeln</li><li>7 bis 8 h Schlaf, vor allem vor Push und Beinen${fc.tired ? ' <b>(letzte Woche ein Problem)</b>' : ''}</li>
    <li>genug essen: dein Meal Prep liegt bei ca. 3.350 kcal und 220 g Protein</li><li>keine Schmerzen ignorieren${fc.pain ? ' <b>(letzte Woche erwähnt)</b>' : ''}</li><li>jeden Satz eintragen, sonst rechnet die Prognose mit Lücken</li></ul></div>`;
  $('#view').innerHTML = h;
  // Diagramme
  const wks = []; for (let i = 7; i >= 0; i--) wks.push(addDays(mon, -7 * i + (weekOff < 0 ? 0 : 0)));
  const vol = wks.map(k => S.sessions.filter(s => weekKey(s.date) === k).reduce((a, s) => a + volume(s), 0) / 1000);
  const cnt = wks.map(k => S.sessions.filter(s => weekKey(s.date) === k).length);
  mk('c-wk', { data: { labels: wks.map(k => fmtDate(k).slice(4)), datasets: [
    { type: 'bar', label: 'Volumen (t)', data: vol, backgroundColor: wks.map(k => k === mon ? '#f5c400' : 'rgba(44,116,224,.5)'), borderRadius: 4, yAxisID: 'y' },
    { type: 'line', label: 'Einheiten', data: cnt, borderColor: '#2fae5f', backgroundColor: '#2fae5f', yAxisID: 'y2', tension: .3 }] },
    options: { scales: { y: { beginAtZero: true }, y2: { position: 'right', beginAtZero: true, suggestedMax: 4, ticks: { stepSize: 1 }, grid: { display: false } } } } });
  if (w.ss.length) mk('c-wkm', { type: 'bar', data: { labels: MUSCLES, datasets: [
    { label: 'Sätze', data: MUSCLES.map(k => w.m[k]), backgroundColor: MUSCLES.map(k => w.m[k] >= WEEK_TARGET[k] ? '#2fae5f' : '#f5c400'), borderRadius: 4 },
    { label: 'Ziel', data: MUSCLES.map(k => WEEK_TARGET[k]), backgroundColor: 'rgba(157,150,138,.25)', borderRadius: 4 }] },
    options: { indexAxis: 'y', scales: { x: { beginAtZero: true } } } });
}

// ---------- Heute: Trend-Diagramm ----------
function trendCard() {
  const real = S.sessions.length; if (!real) return '';
  const weeksWithData = new Set(S.sessions.map(s => weekKey(s.date))).size;
  return `<div class="card"><div class="row between"><h2>📊 Trend · 8 Wochen</h2><button class="btn-sm" data-act="tab" data-v="woche">Woche ›</button></div><div class="chartbox"><canvas id="c-trend"></canvas></div>
    <div class="mute">Balken = Volumen pro Woche, Linie = Kraft-Index (Ø bestes 1RM in % vom Start).${weeksWithData < 3 ? ` <b>Erst ${weeksWithData} ${weeksWithData === 1 ? 'Woche' : 'Wochen'} mit Daten:</b> Der Trend wird ab ca. 3 Wochen aussagekräftig.` : ''}</div></div>`;
}
function drawTrend() {
  if (!document.getElementById('c-trend')) return;
  const wks = weeksBack(8); const first = sorted()[0]?.date;
  const vol = wks.map(w => S.sessions.filter(s => weekKey(s.date) === w).reduce((a, s) => a + volume(s), 0) / 1000);
  const idx = wks.map(w => { if (!first || addDays(w, 6) < first) return null; const end = addDays(w, 6); const vals = [];
    for (const e of S.exercises) { const s = e1rmSeries(e.id); const upto = s.filter(p => p.date <= end); if (s.length && upto.length) vals.push(Math.max(...upto.map(p => p.e)) / s[0].e * 100); }
    return vals.length ? Math.round(vals.reduce((a, b) => a + b) / vals.length * 10) / 10 : null; });
  mk('c-trend', { data: { labels: wks.map(w => fmtDate(w).slice(4)), datasets: [
    { type: 'line', label: 'Kraft-Index %', data: idx, borderColor: '#f5c400', backgroundColor: '#f5c400', yAxisID: 'y', spanGaps: true, tension: .3 },
    { type: 'bar', label: 'Volumen (t)', data: vol, backgroundColor: 'rgba(44,116,224,.5)', yAxisID: 'y2', borderRadius: 4 }] },
    options: { scales: { y: { suggestedMin: 95 }, y2: { position: 'right', beginAtZero: true, grid: { display: false } } } } });
}
