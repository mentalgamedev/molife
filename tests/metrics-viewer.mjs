import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('metrics-viewer.js', 'utf8');
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
    close() { this.open = false; }
  };
}
for (const id of [
  'metricsDialog', 'metricsDialogTitle', 'metricsMetricSelect',
  'metricsCustomRange', 'metricsCustomStart', 'metricsCustomEnd',
  'metricsTrendToggle', 'metricsChart', 'metricsChartEmpty',
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
const window = { DalliApp: { getState: () => state }, matchMedia: () => ({ matches: false }), addEventListener() {} };
const document = {
  querySelector: selector => nodes.get(selector.slice(1)) || null,
  querySelectorAll: selector => selector === '[data-metrics-range]' ? ranges : selector === '[data-open-metric]' ? [trigger] : [],
  createElementNS: (_namespace, tag) => node(tag)
};
vm.runInNewContext(source, { window, document, Intl, Date });
const viewer = window.MoLifeMetrics;
assert.ok(viewer, 'viewer initialized');
viewer.open('mood');
const chart = nodes.get('metricsChart');
const rawLine = () => chart.children.find(child => child.attrs.class === 'metrics-series-line');
assert.ok(rawLine()?.attrs.d.includes(' L '), 'mood connects over unlogged date');
assert.equal((rawLine()?.attrs.d.match(/ M /g) || []).length, 0, 'single path segment');
assert.equal(nodes.get('metricsRecordedValue').textContent, '2 / 7', 'missing mood is not imputed');
assert.equal(nodes.get('metricsDialogTitle').textContent, 'Data Terminal');
viewer.open('damage');
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
console.log('Data Terminal rendering and sparse-readings regression checks passed');
