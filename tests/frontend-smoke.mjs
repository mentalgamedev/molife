import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function fail(message) {
  throw new Error(message);
}

const html = read('index.html');
const app = read('app.js');
const cloud = read('cloud.js');
const metrics = read('metrics-viewer.js');
const serviceWorker = read('service-worker.js');
const cssFiles = [
  'styles.css',
  'pawnshop.css',
  'mood.css',
  'metrics.css',
  'settings.css'
];

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const idCounts = new Map();
ids.forEach(id => idCounts.set(id, (idCounts.get(id) || 0) + 1));
const duplicateIds = [...idCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([id]) => id);
if (duplicateIds.length) {
  fail(`Duplicate DOM ids: ${duplicateIds.join(', ')}`);
}

const knownIds = new Set(ids);
const scripts = [app, cloud, metrics];
const queriedIds = new Set();
scripts.forEach(source => {
  for (const match of source.matchAll(/querySelector\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) {
    queriedIds.add(match[1]);
  }
});
const missingIds = [...queriedIds].filter(id => !knownIds.has(id));
if (missingIds.length) {
  fail(`JavaScript queries missing DOM ids: ${missingIds.join(', ')}`);
}

const localAssets = new Set();
for (const match of html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"[^>]*>/g)) {
  const asset = match[1];
  if (!asset.startsWith('./') && !asset.startsWith('/') && !asset.startsWith('http')) {
    localAssets.add(`./${asset}`);
  } else if (asset.startsWith('./')) {
    localAssets.add(asset);
  }
}
const cacheAssets = new Set(
  [...serviceWorker.matchAll(/['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter(value => value.startsWith('./'))
);
const uncachedAssets = [...localAssets]
  .filter(asset => /\.(?:css|js)(?:\?|$)/.test(asset))
  .filter(asset => !cacheAssets.has(asset));
if (uncachedAssets.length) {
  fail(`CSS/JS assets missing from service-worker cache: ${uncachedAssets.join(', ')}`);
}

function bracesBalanced(source) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let inComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1] || '';

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }

    if (!quote && char === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) return false;
  }

  return depth === 0 && !quote && !inComment;
}

cssFiles.forEach(path => {
  const css = read(path);
  if (!bracesBalanced(css)) {
    fail(`Unbalanced CSS structure in ${path}`);
  }
});

const retiredSelectors = [
  '.xp-orb',
  '.progression-grid',
  '.weapon-card',
  '.inventory-detail',
  '.weight-row'
];
const mainCss = read('styles.css');
const returnedLegacy = retiredSelectors.filter(selector => mainCss.includes(selector));
if (returnedLegacy.length) {
  fail(`Retired CSS selectors returned: ${returnedLegacy.join(', ')}`);
}

console.log(`Frontend smoke checks passed: ${ids.length} unique ids, ${queriedIds.size} queried ids, ${localAssets.size} local assets.`);
