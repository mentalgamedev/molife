import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('metrics-viewer.js', 'utf8');
const cycleDataSource = fs.readFileSync('cycle-data.js', 'utf8');
const nodes = new Map();
function node(tag = 'div') {
  return {
    tag, attrs: {}, children: [], style: {}, handlers: {}, dataset: {}, hidden: false,
    value: '', textContent: '', checked: false, open: false,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.handlers[name] = callback; },
    showModal() { this.open = true; },
    close() { this.open = false; this.handlers.close?.(); },
    hasAttribute(name) { return name === 'open' && this.open; }
  };
}
for (const id of [
  'metricsDialog', 'metricsDialogTitle', 'metricsMetricSelect',
  'metricsCustomRange', 'metricsCustomStart', 'metricsCustomEnd',
  'metricsTrendToggle', 'metricsCycleOptions', 'metricsCycleToggle',
  'metricsCycleLegendPeriod', 'metricsCycleLegendSpotting',
  'metricsChart', 'metricsChartEmpty',
  'metricsChartCaption', 'metricsRecordedValue', 'metricsAverageValue',
  'metricsLowValue', 'metricsHighValue', 'metricsRangeNote',
  'metricsBaselineLabel', 'metricsDisclaimer', 'closeMetricsButton'
]) nodes.set(id, node());
const ranges = ['week', 'month', 'year', 'custom'].map(range => {
  const button = node('button');
  button.dataset.metricsRange = range;
  button.classList = { toggle() {} };
  return button;
});
const trigger = node('button');
trigger.dataset.openMetric = 'mood';
const dateKey = (offset = 0) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
const state = {
  current: { date: dateKey(), transactions: [{ type: 'action', damage: 60 }, { type: 'combo', damage: 10 }] },
  history: [{ date: dateKey(-2), damage: 25 }, { date: dateKey(-1), damage: 0 }],
  metrics: { daily: { [dateKey(-2)]: { mood: -25 }, [dateKey()]: { mood: 70 } } }
};
let identity = 'test-user-1';
const window = {
  DalliApp: {
    getState: () => state,
    getStorageKey: () => identity
  },
  matchMedia: () => ({ matches: false }),
  addEventListener() {}
};
const stored = new Map();
const localStorage = {
  getItem: key => stored.has(key) ? stored.get(key) : null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: key => stored.delete(key)
};
const document = {
  querySelector: selector => nodes.get(selector.slice(1)) || null,
  querySelectorAll: selector => selector === '[data-metrics-range]' ? ranges : selector === '[data-open-metric]' ? [trigger] : [],
  createElementNS: (_namespace, tag) => node(tag)
};
const context = { window, document, localStorage, Intl, Date };
vm.runInNewContext(cycleDataSource, context);
const cycle = window.MoLifeCycleData;
const cycleData = {
  schemaVersion: 1, enabled: true,
  entries: [
    { id: 'record-period-1', start: dateKey(-8), end: dateKey(-4), kind: 'period', flow: 'light' },
    { id: 'record-spotting-1', start: dateKey(-1), end: dateKey(-1), kind: 'spotting', flow: 'unspecified' }
  ]
};
cycle.write(identity, cycleData);
const stateBefore = JSON.stringify(state);
vm.runInNewContext(source, context);
const viewer = window.MoLifeMetrics;
assert.ok(viewer, 'viewer initialized');
viewer.open('mood');
const chart = nodes.get('metricsChart');
const overlayToggle = nodes.get('metricsCycleToggle');
const overlayOptions = nodes.get('metricsCycleOptions');
const band = name => chart.children.filter(child => child.attrs.class === name);
assert.equal(overlayOptions.hidden, false, 'enabled local cycle records offer the Mood overlay');
assert.equal(overlayToggle.checked, false, 'health context is never visible without explicit reveal');
assert.equal(band('metrics-cycle-period').length, 0, 'no cycle dates leaked by default');

overlayToggle.checked = true;
overlayToggle.handlers.change();
assert.equal(band('metrics-cycle-period').length, 1);
assert.equal(band('metrics-cycle-spotting').length, 1);
assert.equal(chart.children[0].attrs.class, 'metrics-cycle-period', 'cycle bands render behind Mood grid and lines');
assert.ok(Number(band('metrics-cycle-period')[0].attrs.width) > 0, 'clipped interval has visible width');
assert.match(nodes.get('metricsRangeNote').textContent, /3 period, 1 spotting/);
assert.equal(nodes.get('metricsRecordedValue').textContent, '2 / 7', 'overlay must not fabricate Mood readings');
assert.match(chart.attrs['aria-label'], /Observed period days: 3; spotting days: 1/);
assert.equal(nodes.get('metricsCycleLegendPeriod').hidden, false);
assert.equal(nodes.get('metricsCycleLegendSpotting').hidden, false);
assert.equal(JSON.stringify(state), stateBefore, 'cycle overlay does not touch syncable app state');

viewer.open('mood');
assert.equal(overlayToggle.checked, false, 'reopening terminal explicitly resets reveal');
assert.equal(band('metrics-cycle-period').length, 0);
const rawLine = () => chart.children.find(child => child.attrs.class === 'metrics-series-line');
assert.ok(rawLine()?.attrs.d.includes(' L '), 'mood connects over unlogged date');
assert.equal((rawLine()?.attrs.d.match(/ M /g) || []).length, 0, 'single path segment');
assert.equal(nodes.get('metricsRecordedValue').textContent, '2 / 7', 'missing mood is not imputed');
assert.equal(nodes.get('metricsDialogTitle').textContent, 'Data Terminal');
overlayToggle.checked = true;
overlayToggle.handlers.change();
viewer.open('damage');
assert.equal(overlayOptions.hidden, true, 'cycle overlay is Mood-only');
assert.equal(overlayToggle.checked, false, 'switch to damage resets sensitive reveal');
assert.equal(band('metrics-cycle-period').length, 0, 'damage chart never renders cycle data');
assert.ok(rawLine()?.attrs.d.includes(' L '), 'damage observations connect');
assert.equal(nodes.get('metricsRecordedValue').textContent, '3 / 7', 'zero-damage day is recorded');
assert.match(nodes.get('metricsAverageValue').textContent, /DMG/);
assert.match(nodes.get('metricsBaselineLabel').textContent, /zero damage/i);
assert.match(nodes.get('metricsDisclaimer').textContent, /Damage includes Actions/);
assert.ok(chart.children.some(child => child.textContent?.includes('DMG')), 'damage axis displayed');
viewer.open('mood');
assert.equal(nodes.get('metricsRecordedValue').textContent, '2 / 7');
nodes.get('metricsTrendToggle').checked = true;
viewer.render();
assert.ok(chart.children.some(child => child.attrs.class === 'metrics-trend-line'), 'optional trend renders');

overlayToggle.checked = true;
overlayToggle.handlers.change();
assert.equal(band('metrics-cycle-period').length, 1);
identity = 'test-user-2';
viewer.onIdentityChanged();
assert.equal(nodes.get('metricsDialog').open, false, 'identity change closes sensitive view');
assert.equal(chart.children.length, 0, 'all previously visible cycle data cleared');
assert.doesNotMatch(nodes.get('metricsRangeNote').textContent, /period, .*spotting/);
assert.doesNotMatch(chart.attrs['aria-label'], /Observed period/);
assert.equal(overlayToggle.checked, false);
viewer.open('mood');
assert.equal(overlayOptions.hidden, true, 'a different account cannot see earlier cycle records');
assert.equal(band('metrics-cycle-period').length, 0);

// An opted-out local tracker must never expose a toggle.
cycle.write(identity, { ...cycleData, enabled: false });
viewer.render();
assert.equal(overlayOptions.hidden, true);
cycle.write(identity, cycleData);
viewer.render();
assert.equal(overlayOptions.hidden, false);
stored.set(cycle.storageKey(identity), '{invalid json');
viewer.render();
assert.equal(overlayOptions.hidden, true, 'corrupted local storage fails closed without throwing');
assert.equal(stored.get(cycle.storageKey(identity)), '{invalid json', 'corrupted records not overwritten');

identity = 'test-user-1';
viewer.open('mood');
overlayToggle.checked = true;
overlayToggle.handlers.change();
assert.equal(band('metrics-cycle-period').length, 1);
nodes.get('metricsDialog').close();
assert.equal(chart.children.length, 0, 'escape/native dialog closure erases sensitive SVG nodes');
assert.doesNotMatch(nodes.get('metricsRangeNote').textContent, /period, .*spotting/);
assert.doesNotMatch(chart.attrs['aria-label'], /Observed period/);
assert.equal(overlayToggle.checked, false);

console.log('Data Terminal sparse Mood readings, cycle clipping, privacy and identity isolation passed');
