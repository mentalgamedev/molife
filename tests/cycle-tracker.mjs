import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const core = fs.readFileSync('cycle-data.js', 'utf8');
const ui = fs.readFileSync('cycle-tracker.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const cloud = fs.readFileSync('cloud.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

const values = new Map();
const storage = {
  getItem: key => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key)
};
const els = new Map();
function create(tag = 'div') {
  return {
    tag, hidden: false, disabled: false, value: '', dataset: {}, textContent: '',
    children: [], handlers: {}, attrs: {}, open: false,
    addEventListener(name, cb) { this.handlers[name] = cb; },
    trigger(name = 'click') { this.handlers[name]?.({ target: this }); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    click() {},
    remove() {}
  };
}
for (const id of [
  'cycleDialog', 'cycleSettingsButton', 'closeCycleButton',
  'cycleEnableButton', 'cycleDisableButton', 'cycleOptInArea',
  'cycleActiveArea', 'cycleCalendar', 'cycleStart', 'cycleEnd',
  'cycleKind', 'cycleFlow', 'cycleSaveButton', 'cycleNewButton',
  'cycleDeleteEntryButton', 'cycleDeleteAllButton', 'cycleExportButton',
  'cycleEntriesList', 'cycleMessage', 'cycleSettingsStatus'
]) els.set(id, create());
let identity = 'dailyXpGame.v2';
const mockCalendarInstances = [];
class Calendar {
  constructor(target, opts) {
    this.target = target;
    this.opts = opts;
    this.viewDate = new Date();
    mockCalendarInstances.push(this);
  }
  update(opts) { this.opts = { ...this.opts, ...opts }; }
  destroy() { this.destroyed = true; }
}
const window = {
  DalliApp: { getStorageKey: () => identity },
  AirDatepicker: Calendar,
  confirm: () => true,
  setTimeout: () => 0,
  URL: URL
};
const document = {
  querySelector: selector => els.get(selector.slice(1)) || null,
  createElement: tag => create(tag),
  body: { append() {} }
};
const context = { window, document, localStorage: storage, Date, Intl, JSON, URL, Blob, crypto: {
  randomUUID: () => 'known-test-uuid'
}, Uint8Array, console };
vm.runInNewContext(core, context);
const data = window.MoLifeCycleData;
const today = data.dateKey(new Date());
assert.equal(data.dayNumber('2024-02-29') !== null, true);
assert.equal(data.dayNumber('2025-02-29'), null);
assert.equal(data.dayNumber('2024-13-01'), null);
assert.equal(data.dayNumber('2024-00-01'), null);
assert.equal(data.dayNumber('not-a-date'), null);
assert.equal(data.dayNumber('2024-03-01') - data.dayNumber('2024-02-29'), 1);

const entry = { id: 'abcdefgh123', start: '2024-01-01', end: '2024-01-05', kind: 'period', flow: 'medium' };
const valid = data.upsert({ ...data.empty(), enabled: true }, entry);
assert.equal(valid.entries.length, 1);
assert.throws(() => data.upsert(valid, { ...entry, id:'other-uid-xyz', start:'2024-01-05', end:'2024-01-06' }), /overlap/i);
assert.throws(() => data.upsert(valid, { ...entry, id:'other-uid-xyz', start:'2024-02-20', end:'2024-02-19' }), /Invalid/i);
assert.throws(() => data.upsert(valid, { ...entry, id:'other-uid-xyz', flow:'unknown' }), /Invalid/i);
data.write('guest', valid);
assert.equal(data.read('guest').entries.length, 1);
assert.equal(data.read('account-42').entries.length, 0);
assert.notEqual(data.storageKey('guest'), data.storageKey('account-42'));
assert.equal(data.entryForDay(valid, '2024-01-04').id, entry.id);
data.remove('guest');
assert.equal(data.read('guest').entries.length, 0);

vm.runInNewContext(ui, context);
const tracker = window.MoLifeCycle;
assert.ok(tracker);
function trigger(id) { els.get(id).trigger(); }
trigger('cycleSettingsButton');
assert.equal(els.get('cycleDialog').open, true);
assert.equal(els.get('cycleEnableButton').disabled, false);
assert.equal(values.size, 0, 'open does not create or sync records');
trigger('cycleEnableButton');
assert.equal(data.read(identity).enabled, true);
assert.equal(mockCalendarInstances.length, 1);
assert.equal(els.get('cycleActiveArea').hidden, false);

els.get('cycleStart').value = '2024-02-28';
els.get('cycleEnd').value = '2024-03-02';
els.get('cycleKind').value = 'period';
els.get('cycleFlow').value = 'light';
trigger('cycleSaveButton');
assert.equal(data.read(identity).entries.length, 1);
assert.equal(data.read(identity).entries[0].flow, 'light');
assert.equal(els.get('cycleEntriesList').children.length, 1);

// Select an existing shaded date, load editor, and delete just that entry.
mockCalendarInstances[0].opts.onSelect({ date: new Date(2024, 1, 29) });
assert.equal(els.get('cycleStart').value, '2024-02-28');
assert.equal(els.get('cycleDeleteEntryButton').hidden, false);
trigger('cycleDeleteEntryButton');
assert.equal(data.read(identity).entries.length, 0);

// Recorded observations must not leak across guest/cloud account switches.
els.get('cycleStart').value = '2024-04-01';
els.get('cycleEnd').value = '2024-04-03';
trigger('cycleSaveButton');
identity = 'dailyXpGame.user.42';
tracker.onIdentityChanged();
assert.equal(els.get('cycleDialog').open, false);
trigger('cycleSettingsButton');
assert.equal(data.read(identity).entries.length, 0);
assert.equal(els.get('cycleEntriesList').children.length, 1, 'empty-state only');
assert.equal(data.read('dailyXpGame.v2').entries.length, 1, 'guest history is preserved but isolated');
trigger('cycleEnableButton');
trigger('cycleDisableButton');
assert.equal(data.read(identity).enabled, false);
tracker.deleteAccountData(identity);
assert.equal(values.has(data.storageKey(identity)), false);
assert.equal(values.has(data.storageKey('dailyXpGame.v2')), true);

assert.ok(app.includes('window.MoLifeCycle?.onIdentityChanged()'), 'app identity changes must close tracker');
assert.ok(cloud.includes('window.MoLifeCycle?.deleteAccountData(userStorageKey(deletedUserId))'), 'account deletion purges local cycle records');
assert.ok(!html.includes('https://unpkg.com') && !html.includes('cdn.jsdelivr.net'), 'calendar loaded locally');
assert.ok(html.includes('vendor/air-datepicker.js?v=4.32'), 'pinned calendar asset');
assert.ok(!app.includes('molife.cycle.local.v1'), 'sensitive store isolated from normal app state');
assert.ok(!cloud.includes('molife.cycle.local.v1'), 'sensitive store isolated from cloud sync');
assert.ok(!html.includes('cycleCalendar" data-sync'), 'no cycle data attached to sync');
assert.ok(today);
console.log('Cycle Tracker privacy, account isolation, date validation and UI regressions passed');
