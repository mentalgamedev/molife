import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync('app.js', 'utf8');
function between(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Source block not found: ' + start);
  return app.slice(a, b);
}

const logging = between('  function medicationTakenEntry(', '  function archiveCurrentDay() {');
const script = [
  '(() => {',
  'const MEDICATION_LIMIT = 32;',
  'const state = { current: { medicationsTaken: [], transactions: [], date: "2026-10-19" }, progression: { victoryXp: 100 } };',
  'const activeSettings = () => ({medications: [{id:"med-am", name:"Morning entry", dose:"original label"}]});',
  'let saves = 0;',
  'const ensureToday = () => {};',
  'const makeId = () => "med-tx-one";',
  'const saveState = () => {saves += 1};',
  'const render = () => {};',
  logging,
  'return {state, markMedicationTaken, undoMedicationTaken, saves: () => saves};',
  '})()'
].join('\n');
const h = vm.runInNewContext(script);
h.markMedicationTaken('med-am');
assert.equal(h.state.current.medicationsTaken.length, 1);
assert.equal(h.state.current.medicationsTaken[0].dose, 'original label');
assert.equal(h.state.current.transactions.length, 0, 'Medication must not produce damage');
assert.equal(h.state.progression.victoryXp, 100, 'Medication must not award XP');
h.markMedicationTaken('med-am');
assert.equal(h.state.current.medicationsTaken.length, 1, 'Second tap must not double count');
h.undoMedicationTaken('med-am');
assert.equal(h.state.current.medicationsTaken.length, 0);
assert.equal(h.saves(), 2);

const normalizer = between('  function normalizeMedicationRecords(value) {', '  function normalizeTransactions(value) {');
const normalize = vm.runInNewContext([
  '(() => {',
  'const MEDICATION_LIMIT = 32;',
  'const normalizeTimestamp = value => Number(value) > 0 && Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;',
  normalizer,
  'return normalizeMedicationRecords;',
  '})()'
].join('\n'));
const valid = {id:'med-tx-one', medicationId:'med-am', name:'Morning entry', dose:'label', takenAt:1790000000000};
const records = normalize([valid, {...valid, id:'med-tx-two'}, {...valid, medicationId:'<invalid>'},
  {...valid, medicationId:'other', takenAt:-1}]);
assert.equal(records.length, 1, 'Invalid and duplicate entries should not survive normalization');
assert.equal(records[0].name, 'Morning entry');
assert.equal(normalize(Array.from({length:100}, (_,i) => ({...valid, id:'tx-'+i, medicationId:'med-'+i}))).length, 32);
console.log('Medication checks passed: one-per-day, undo, no combat side effects, bounded history.');
