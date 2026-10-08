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
const manifest = read('manifest.webmanifest');
const deleteAccountApi = read('api/delete-account.php');
const cssFiles = [
  'styles.css',
  'pawnshop.css',
  'mood.css',
  'metrics.css',
  'settings.css',
  'info.css'
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

if (!serviceWorker.includes('STATIC_ASSET_URLS.has(url.href)')
    || !serviceWorker.includes('key.startsWith(\'molife-\')')
    || !serviceWorker.includes('url.pathname !== APP_PATH && url.pathname !== INDEX_PATH')) {
  fail('Service worker must restrict caching to known MoLife assets and app shell routes');
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
  '.weight-row',
  '.efficiency-row',
  '.category-meter'
];
const expectedDefaultDamage = new Map([
  ['wellbeing-workout-30', 30],
  ['wellbeing-walk-20', 15],
  ['wellbeing-mobility-10', 10],
  ['wellbeing-good-meal', 15],
  ['work-focus-25', 25],
  ['work-focus-50', 45],
  ['work-practice-20', 15],
  ['work-admin', 15],
  ['chores-small', 10],
  ['chores-medium', 20],
  ['chores-laundry', 15],
  ['chores-big', 30]
]);

const defaultActionDamage = new Map();
for (const match of app.matchAll(/\{ id: '([^']+)', categoryId: '[^']+', name: '[^']+', baseDamage: (\d+), type:/g)) {
  defaultActionDamage.set(match[1], Number(match[2]));
}
for (const [id, expected] of expectedDefaultDamage) {
  if (defaultActionDamage.get(id) !== expected) {
    fail(`Unexpected predefined damage for ${id}: expected ${expected}, got ${defaultActionDamage.get(id)}`);
  }
}

const expectedDamageMigrations = new Map([
  ['wellbeing-workout-30', [20, 30]],
  ['wellbeing-walk-20', [10, 15]],
  ['wellbeing-mobility-10', [5, 10]],
  ['wellbeing-good-meal', [10, 15]],
  ['work-focus-25', [15, 25]],
  ['work-focus-50', [30, 45]],
  ['work-practice-20', [10, 15]],
  ['work-admin', [10, 15]],
  ['chores-small', [5, 10]],
  ['chores-medium', [10, 20]],
  ['chores-laundry', [10, 15]],
  ['chores-big', [20, 30]]
]);
const damageMigrations = new Map(
  [...app.matchAll(/'([^']+)': Object\.freeze\(\[(\d+), (\d+)\]\)/g)]
    .map(match => [match[1], [Number(match[2]), Number(match[3])]])
);
for (const [id, expected] of expectedDamageMigrations) {
  const actual = damageMigrations.get(id);
  if (!actual || actual[0] !== expected[0] || actual[1] !== expected[1]) {
    fail(`Missing or incorrect default-damage migration for ${id}`);
  }
}
if (!app.includes('baseDamage === damageMigration[0]')) {
  fail('Default-damage migration must only touch actions that still have their stock damage');
}

if (!app.includes('const STATE_VERSION = 13;')
    || !app.includes("const DEFAULT_PROFILE_ID = 'profile-default';")
    || !app.includes('const PROFILE_MIN = 1;')
    || !app.includes('const PROFILE_MAX = 5;')
    || !app.includes("name: 'Default'")
    || !app.includes('onboarding: {')
    || !app.includes('infoSeen: false')) {
  fail('v13 dynamic-profile defaults are incomplete');
}

if (app.includes('state.settings')) {
  fail('v13 must not keep a second persistent state.settings source beside profile settings');
}

if (!app.includes('function normalizeSettings(')
    || !app.includes('settings: normalizeSettings(sourceProfile?.settings, shouldMigrateDefaultActionDamage)')
    || !app.includes('return normalizeSettings(migratedSettings, sourceStateVersion < 11);')) {
  fail('Profiles and templates must share the same settings normalization path');
}

if (!app.includes('sourceVersion >= 2 && sourceVersion < 11')
    || !app.includes('function migrateV11State(candidate)')
    || !app.includes('function migrateV12State(candidate)')
    || !app.includes('slice(0, PROFILE_MAX)')
    || !app.includes("activeId: DEFAULT_PROFILE_ID")
    || !app.includes('settings: deepClone(legacySettings)')) {
  fail('v11/v12-to-v13 profile migration is incomplete');
}

if (!app.includes('const LEGACY_TEMPLATE_VERSION = 1;')
    || !app.includes('const TEMPLATE_VERSION = 2;')
    || !app.includes('stateVersion: STATE_VERSION')) {
  fail('Settings-template v2 metadata is incomplete');
}
if (!app.includes('[LEGACY_TEMPLATE_VERSION, TEMPLATE_VERSION].includes(payload.version)')
    || !app.includes('sourceStateVersion < 11')
    || !app.includes('Number(action?.baseDamage) === damageMigration[0]')) {
  fail('Legacy template migration support is incomplete');
}

const expectedTemplateSettings = [
  'fullEnemyHp',
  'focusCategoryId',
  'focusFactor',
  'resistanceBuildup',
  'chillModeEnabled',
  'chillMultiplier',
  'categories',
  'actions',
  'combos'
];
const buildSettingsStart = app.indexOf('function buildSettingsFromDraft()');
const buildSettingsEnd = app.indexOf('function commitSettingsDraft', buildSettingsStart);
const buildSettingsSource = app.slice(buildSettingsStart, buildSettingsEnd);
const missingTemplateSettings = expectedTemplateSettings.filter(key => !buildSettingsSource.includes(key));
if (missingTemplateSettings.length) {
  fail(`Template-backed settings missing from settings builder: ${missingTemplateSettings.join(', ')}`);
}
if (!html.includes('Actions (type, damage, order, visibility and Required counts)')
    || !html.includes('onboarding state')
    || !html.includes('id="profilesEditor"')
    || !html.includes('id="addProfileButton"')
    || html.includes('id="profileSwitcher"')
    || !html.includes('id="removeAllCategoriesButton"')
    || !html.includes('id="removeAllActionsButton"')
    || !html.includes('id="removeAllCategoriesActionsButton"')) {
  fail('v4.27 settings-only profile/template/cleanup UI contract is incomplete');
}

if (app.includes('profileSwitcher')
    || !app.includes('function addProfile()')
    || !app.includes('function removeProfile(profileId)')
    || !app.includes('state.profiles.slots.length >= PROFILE_MAX')
    || !app.includes('state.profiles.slots.length <= PROFILE_MIN')
    || !app.includes("settings: deepClone(activeSettings())")) {
  fail('Dynamic profile add/remove behavior is incomplete');
}

if (!app.includes("clearActiveProfileConfiguration('categories')")
    || !app.includes("clearActiveProfileConfiguration('actions')")
    || !app.includes("clearActiveProfileConfiguration('all')")
    || !app.includes('settingsDraft.categories = [uncategorizedCategory()]')
    || !app.includes('settingsDraft.actions = []')
    || !app.includes('settingsDraft.combos = []')) {
  fail('Active-profile bulk cleanup operations are incomplete');
}

if (!app.includes('function effectiveOneOffCategoryId(')
    || !app.includes('effectiveOneOffCategoryId(oneOff) === category.id')) {
  fail('Shared One-offs must fall back non-destructively when a profile lacks their category');
}

if (!cloud.includes("apiRequest('delete-account.php'")
    || !cloud.includes('localStorage.removeItem(userStorageKey(deletedUserId))')
    || !cloud.includes('user.isOwner')
    || !cloud.includes('customizedProfiles')) {
  fail('Account deletion/profile-aware cloud state wiring is incomplete');
}

if (!deleteAccountApi.includes("password_verify($password")
    || !deleteAccountApi.includes("role <> 'owner'")
    || !deleteAccountApi.includes('dalli_require_csrf()')
    || !deleteAccountApi.includes('dalli_clear_remember_cookie()')) {
  fail('Account deletion endpoint is missing required re-authentication or session safeguards');
}

if (/questionable|suspiciously/i.test(html) || /suspiciously/i.test(manifest)) {
  fail('Retired user-facing questionable/suspiciously copy returned');
}

if (/resistance/i.test(html)
    || html.includes('id="resistanceBuildupInput"')
    || app.includes('CATEGORY_RESISTANCE')
    || app.includes('categoryResistanceForCount')
    || app.includes('getCategoryEfficiency')) {
  fail('Removed category Resistance mechanic or UI returned');
}

if (!app.includes('const ITEM_DROP_CHANCE = 0.50;')
    || html.includes('40% chance')
    || !html.includes('<strong>MAKE IT YOURS.</strong>')) {
  fail('v4.27 loot chance or onboarding guidance is incomplete');
}

const settingsCss = read('settings.css');
if (!settingsCss.includes('.profile-settings-section .settings-section-head {\n    flex-direction: column;\n    align-items: stretch;')) {
  fail('Mobile profile header must stack vertically instead of retaining the desktop flex row');
}

const mainCss = read('styles.css');
if (mainCss.includes('.profile-switcher') || mainCss.includes('.profile-switch-button')) {
  fail('Main-screen profile switcher styles should be removed');
}
const returnedLegacy = retiredSelectors.filter(selector => mainCss.includes(selector));
if (returnedLegacy.length) {
  fail(`Retired CSS selectors returned: ${returnedLegacy.join(', ')}`);
}

console.log(`Frontend smoke checks passed: ${ids.length} unique ids, ${queriedIds.size} queried ids, ${localAssets.size} local assets.`);
