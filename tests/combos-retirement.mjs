import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const take = (a, b) => {
  const start = app.indexOf(a);
  const end = app.indexOf(b, start);
  assert.ok(start >= 0 && end > start, 'Missing source block: ' + a);
  return app.slice(start, end);
};

const clip = (n, min, max, fallback) => {
  const val = Number(n);
  return Number.isFinite(val) ? Math.min(max, Math.max(min, val)) : fallback;
};
const oldSettings = {
  fullEnemyHp: 55,
  categories: [{id:'cat', name:'Work', icon:'*', color:'#aabbcc'}],
  actions: [
    {id:'action-1', name:'Task 1', categoryId:'cat', baseDamage:20, type:'repeatable'},
    {id:'action-2', name:'Task 2', categoryId:'cat', baseDamage:30, type:'repeatable'}
  ],
  combos: [{id:'combo-1', name:'Old chain', enabled:true, multiplier:1.5, actionIds:['action-1','action-2']}],
  medications: []
};
const normalizerSource = take('  function normalizeSettings(', '  function normalizeState(');
const normalizeSettings = vm.runInNewContext([
  '(() => {',
  'const DEFAULT_SETTINGS = ' + JSON.stringify({...oldSettings, combos:[]}) + ';',
  'const DEFAULT_FOCUS_FACTOR = 1.5, LEGACY_RESISTANCE_BUILDUP = 0;',
  'const CHILL_MULTIPLIER_MIN = 1.25, CHILL_MULTIPLIER_MAX = 4, DEFAULT_CHILL_MULTIPLIER = 2;',
  'const DEFAULT_ACTION_NAME_MIGRATIONS = {}, DEFAULT_ACTION_DAMAGE_MIGRATIONS = {};',
  'const UNCATEGORIZED_ID = "uncategorized", REQUIRED_COUNT_MAX = 1000, MEDICATION_LIMIT = 32;',
  'const clampInt = ' + clip.toString() + ';',
  'const clampNumber = ' + clip.toString() + ';',
  'const deepClone = obj => JSON.parse(JSON.stringify(obj));',
  'const normalizeHexColor = value => value;',
  'const fallbackCategoryColor = () => "#999999";',
  'const ensureUncategorizedCategory = categories => [...categories, {id:"uncategorized", name:"Uncategorized"}];',
  'const makeId = kind => kind + "-new";',
  normalizerSource,
  'return normalizeSettings;',
  '})()'
].join('\n'));
const normalized = normalizeSettings(oldSettings);
assert.equal(normalized.combos.length, 0, 'old profile definitions are discarded');
assert.equal(normalized.actions.length, 2, 'Actions are retained');
assert.equal(normalized.categories.length, 2, 'Categories are retained');
assert.equal(normalizeSettings({...oldSettings, combos:undefined}).combos.length, 0,
  'new Combo-free profile formats normalize for v14');
assert.deepEqual(Array.from(normalized.actions.map(x=>x.baseDamage)), [20,30]);

const transactionsSource = take('  function normalizeTransactions(', '  function normalizeDayCard(');
const normalizeTransactions = vm.runInNewContext([
  '(() => {',
  'const COMBO_MIN_MULTIPLIER = 1.05, COMBO_MAX_MULTIPLIER = 3;',
  'const COMBO_DEFAULT_MULTIPLIER = 1.25, COMBO_MAX_STEPS = 8;',
  'const UNCATEGORIZED_ID = "uncategorized";',
  'const clampInt = ' + clip.toString() + ';',
  'const clampNumber = ' + clip.toString() + ';',
  'const normalizeTimestamp = n => Number(n) > 0 ? Math.round(Number(n)) : null;',
  'const makeId = name => name + "-missing";',
  transactionsSource,
  'return normalizeTransactions;',
  '})()'
].join('\n'));
const now = Date.now();
const oldTx = [
  {type:'action', id:'tx-1', actionId:'action-1', categoryId:'cat',
   actionName:'Task 1', categoryName:'Work', baseDamage:20, damage:20, efficiency:1, timestamp:now},
  {type:'action', id:'tx-2', actionId:'action-2', categoryId:'cat',
   actionName:'Task 2', categoryName:'Work', baseDamage:30, damage:30, efficiency:1, timestamp:now+1},
  {type:'combo', id:'bonus-1', comboId:'combo-1', comboName:'Old chain',
   damage:10, multiplier:1.5, sourceTransactionIds:['tx-1','tx-2'], timestamp:now+2}
];
const restored = normalizeTransactions(oldTx);
assert.equal(restored.length, 3);
assert.equal(restored[2].type, 'combo', 'earned bonus survives normalized legacy state');
assert.equal(restored[2].damage, 10);

const summarySource = take('  function getSummary() {', '  function calculateDamage(');
const undoSource = take('  function undoTransaction(', '  function categoryColor(');
const combat = vm.runInNewContext([
  '(() => {',
  'const state = {',
  '  current: {maxHp:55, transactions: ' + JSON.stringify(restored) + ', requiredActions:[]},',
  '  oneOffs:[], progression:{victoryXp:20}',
  '};',
  'const settings = ' + JSON.stringify(normalized) + ';',
  'const activeSettings = () => settings;',
  'const currentCategoryIdForTransaction = tx => tx.categoryId;',
  'const clampInt = ' + clip.toString() + ';',
  'const REQUIRED_COUNT_MAX = 1000, UNCATEGORIZED_ID = "uncategorized";',
  'const getEnemyHp = () => 55;',
  'const finalizeVictoryIfNeeded = () => null;',
  'const saveState = () => {};',
  'const render = () => {};',
  summarySource,
  undoSource,
  'return {state,getSummary,undoTransaction};',
  '})()'
].join('\n'));
assert.equal(combat.getSummary().totalDamage, 60, 'existing bonus still counts toward the fight');
assert.equal(combat.getSummary().isVictory, true, 'past earned victory is retained');
combat.undoTransaction('tx-1');
assert.equal(combat.state.current.transactions.length, 1, 'Undo removes a legacy bonus linked to its source');
assert.equal(combat.getSummary().totalDamage, 30, 'dependent legacy bonus cannot become orphan damage');

assert.ok(!app.includes('function processCombosForAction('), 'no order-aware bonus engine');
assert.ok(!app.includes('function renderCombosEditor('), 'no Combo editor');
assert.ok(!app.includes('function renderCombos('), 'no Combo gameplay panel');
assert.ok(!html.includes('id="combosPanel"') && !html.includes('id="combosEditor"')
  && !html.includes('id="addComboButton"'), 'Combo user interface removed');
assert.ok(!html.includes('id="dayCardCombos"') && !html.includes('id="attackReportComboRow"'),
  'new reports do not advertise Combo scores');
assert.ok(!css.includes('.combo-editor-card'), 'retired CSS removed');
assert.ok(readme.includes('Bureau of Retroactive Productivity'), 'release notes updated');
assert.ok(app.includes("combos: []"), 'v14 cloud format retains compatible empty Combos field');
assert.ok(app.includes("next.current.comboProgress = {}"), 'old partial sequence progress discarded');
console.log('Combo retirement checks passed: no new engine; old damage remains; Undo and profile migration safe.');
