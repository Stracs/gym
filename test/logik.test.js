// Tests für die Rechen-Logik der Gym-App. Start: node test/logik.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const any = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : any, apply: () => any, set: () => true });
const store = {};
const ctx = {
  console, Date, Math, JSON, Set, Object, Array, String, Number, Promise, structuredClone, setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  document: { querySelector: () => any, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {}, createElement: () => any },
  navigator: {}, location: { protocol: 'file:' }, scrollTo: () => {}, confirm: () => true, prompt: () => '60',
  Chart: Object.assign(function () { return { destroy() {} }; }, { defaults: { plugins: { legend: { labels: {} } }, font: {} } }),
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), ctx);
const run = code => vm.runInContext(code, ctx);
const J = x => JSON.stringify(x);

// Hilfe: Einheit anlegen. sets = [[kg, wdh], …]
run(`function mkSess(id, date, dayId, entries) { return { id, date, dayId, start: 0, durationMin: 60, entries: entries.map(([exId, sets]) => ({ exId, target: '', sets: sets.map(([w, r]) => ({ w, r, done: true, warm: false })) })) }; }`);
const reset = () => run('S = freshState(); S.sessions = [];');

let ok = 0; const t = (name, fn) => { reset(); try { fn(); ok++; console.log('✓', name); } catch (e) { console.log('✗', name, '\n ', e.message); process.exitCode = 1; } };

t('1RM nach Epley', () => {
  assert.strictEqual(run('e1rm(100, 1)'), 100); assert.strictEqual(Math.round(run('e1rm(60, 8)')), 76); assert.strictEqual(run('e1rm(50, 0)'), 0);
});
t('Gewichte mit zwei Nachkommastellen', () => {
  assert.strictEqual(run('fmtNum(63.75)'), '63,75'); assert.strictEqual(run('fmtNum(1.25)'), '1,25'); assert.strictEqual(run('fmtNum(12303.75)'), '12.303,75');
});
t('Steigerung: alle Sätze oben → +2,5 kg, Wdh unten', () => {
  run(`S.sessions.push(mkSess('a', '2026-10-20', 'push', [['bank', [[70, 8], [70, 8], [70, 9]]]]))`);
  assert.strictEqual(run(`nextWeight('bank', '3 × 6-8')`), 72.5);
  assert.strictEqual(J(run(`prefill('bank', '3 × 6-8').map(s => [s.w, s.r])`)), J([[72.5, 6], [72.5, 6], [72.5, 6]]));
});
t('Steigerung: leichte Übung → +1,25 kg; nicht geschafft → gleich bleiben', () => {
  run(`S.sessions.push(mkSess('a', '2026-10-20', 'push', [['seitkabel', [[10, 15], [10, 15], [10, 15]]], ['pushdown', [[25, 12], [25, 10], [25, 9]]]]))`);
  assert.strictEqual(run(`nextWeight('seitkabel', '3 × 12-15')`), 11.25);
  assert.strictEqual(run(`nextWeight('pushdown', '3 × 10-12')`), null);
  assert.strictEqual(J(run(`prefill('pushdown', '3 × 10-12').map(s => [s.w, s.r])`)), J([[25, 12], [25, 10], [25, 9]]));
});
t('Rekorde werden der Reihe nach erkannt', () => {
  run(`S.sessions.push(mkSess('a', '2026-10-01', 'push', [['bank', [[60, 8]]]]), mkSess('b', '2026-10-08', 'push', [['bank', [[62.5, 8]]]]), mkSess('c', '2026-10-15', 'push', [['bank', [[60, 6]]]])); recomputePRs();`);
  assert.strictEqual(J(run(`sorted().map(s => s.prs)`)), J([0, 1, 0]));
});
t('Tagesreihenfolge Push → Pull → Beine → Push, Tag 4 wenn Woche voll', () => {
  assert.strictEqual(run('nextDay().id'), 'push');
  const d = run('today()'); const wk = run(`ymd(mondayOf(new Date()))`);
  run(`S.sessions.push(mkSess('a', '${wk}', 'push', [['bank', [[60, 8]]]]))`); assert.strictEqual(run('nextDay().id'), 'pull');
  run(`S.sessions.push(mkSess('b', '${wk}', 'pull', [['latzug', [[50, 10]]]]))`); assert.strictEqual(run('nextDay().id'), 'beine');
  run(`S.sessions.push(mkSess('c', '${wk}', 'beine', [['presse', [[100, 10]]]]))`); assert.strictEqual(run('nextDay().id'), 'schwach');
});
t('Scheiben-Rechner 82,5 kg', () => {
  assert.strictEqual(J(run('plates(82.5).out.map(p => p[0])')), J([25, 5, 1.25]));
  assert.strictEqual(run('plates(15)'), null);
});
t('Schwächen: ohne Beine sind Beine am schwächsten, Smart-Tag nimmt sie', () => {
  const d = run('today()');
  run(`S.sessions.push(mkSess('a', '${d}', 'push', [['bank', [[60, 8], [60, 8], [60, 8]]], ['seitkabel', [[10, 12], [10, 12], [10, 12]]]]), mkSess('b', '${d}', 'pull', [['latzug', [[50, 10], [50, 10], [50, 10]]]]))`);
  const w = run('weakest(14).slice(0, 3).map(x => x.k)');
  assert.ok(w.every(k => !['Brust', 'Rücken', 'Schultern'].includes(k)), 'trainierte Muskeln dürfen nicht vorn sein: ' + w);
  assert.strictEqual(run('smartWeakItems().length') >= 3, true);
});
t('Aufwärmsätze zählen nicht', () => {
  run(`const s = mkSess('a', '2026-10-01', 'push', [['bank', [[40, 10], [60, 8]]]]); s.entries[0].sets[0].warm = true; S.sessions.push(s);`);
  assert.strictEqual(run(`workSets(S.sessions[0]).length`), 1); assert.strictEqual(run(`volume(S.sessions[0])`), 480);
});
console.log(`\n${ok} Tests bestanden`);
