import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the production sync functions with controllable server responses.
// This catches timing regressions that static markup smoke checks cannot.
const cloud = fs.readFileSync('cloud.js', 'utf8');
const start = cloud.indexOf('  async function saveNow(snapshot) {');
const end = cloud.indexOf('  // ---------------------------------------------------------------------------\n  // Events / startup', start);
assert.ok(start >= 0 && end > start, 'Cloud sync functions must be present');
const syncFunctions = cloud.slice(start, end);

function harness() {
  const requests = [];
  const replacements = [];
  const statuses = [];
  const context = {
    apiRequest(path, options) {
      return new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
    },
    setSyncStatus(label, kind) { statuses.push({ label, kind }); },
    setTimeout() { return 1; }, // Explicitly flush saves; no background timers in this test.
    clearTimeout() {},
    window: {
      DalliApp: { replaceState(value, key) { replacements.push({ value, key }); } },
      alert() { throw new Error('Unexpected alert'); },
      confirm() { throw new Error('Unexpected conflict prompt'); }
    }
  };

  const instance = vm.runInNewContext(`(() => {
    const SAVE_DELAY_MS = 450;
    const RETRY_DELAY_MS = 5000;
    let user = { id: 1 };
    let csrfToken = 'csrf';
    let revision = 0;
    let cloudReady = true;
    let conflict = false;
    let saveTimer = null;
    let retryTimer = null;
    let saving = false;
    let inFlightSave = null;
    let queuedState = null;
    let sessionGeneration = 1;
    class ApiError extends Error {}
    const userStorageKey = id => 'user.' + id;
    ${syncFunctions}
    return {
      queueSave, flushSave, flushPendingSaves, pullCloudState,
      snapshot() { return { revision, queuedState, saving, conflict }; },
      switchUser(id) {
        sessionGeneration += 1;
        user = { id };
        revision = 0;
        saving = false;
        inFlightSave = null;
        queuedState = null;
      }
    };
  })()`, context);
  return { ...instance, requests, replacements, statuses };
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

// A sign-out drain must wait for the first write, then send edits queued mid-flight.
{
  const h = harness();
  h.queueSave({ marker: 'first' });
  const first = h.flushSave();
  assert.equal(h.requests.length, 1);
  h.queueSave({ marker: 'second' });
  const drain = h.flushPendingSaves();
  h.requests[0].resolve({ revision: 1 });
  assert.equal(await first, true);
  await tick();
  assert.equal(h.requests.length, 2, 'Second write must follow the first');
  const secondBody = JSON.parse(h.requests[1].options.body);
  assert.equal(secondBody.expectedRevision, 1, 'Second write uses updated revision');
  assert.equal(secondBody.state.marker, 'second');
  h.requests[1].resolve({ revision: 2 });
  assert.equal(await drain, true);
  assert.equal(h.snapshot().revision, 2);
  assert.equal(h.snapshot().queuedState, null);
}

// A refresh begun before a local action must not replace the unsaved local state.
{
  const h = harness();
  const read = h.pullCloudState();
  assert.equal(h.requests.length, 1);
  h.queueSave({ marker: 'new local edit' });
  h.requests[0].resolve({ state: { marker: 'old cloud state' }, revision: 100 });
  await read;
  assert.equal(h.replacements.length, 0);
  assert.equal(h.snapshot().revision, 0);
  assert.equal(h.snapshot().queuedState.marker, 'new local edit');
}

// A write response from the previous account must not update the next account.
{
  const h = harness();
  h.queueSave({ marker: 'old account' });
  const oldWrite = h.flushSave();
  h.switchUser(2);
  h.requests[0].resolve({ revision: 37 });
  assert.equal(await oldWrite, false);
  assert.equal(h.snapshot().revision, 0);
  assert.equal(h.statuses.some(status => status.label === 'Synced'), false);
}

// A failed old upload must not replace a newer state queued during the request.
{
  const h = harness();
  h.queueSave({ marker: 'old snapshot' });
  const first = h.flushSave();
  h.queueSave({ marker: 'newer snapshot' });
  h.requests[0].reject(new Error('Temporary outage'));
  assert.equal(await first, false);
  assert.equal(h.snapshot().queuedState.marker, 'newer snapshot');
}

// Failed requests must retain the unsynced snapshot instead of losing it.
{
  const h = harness();
  h.queueSave({ marker: 'offline edit' });
  const pending = h.flushSave();
  h.requests[0].reject(new Error('Network offline'));
  assert.equal(await pending, false);
  assert.equal(h.snapshot().queuedState.marker, 'offline edit');
  assert.equal(h.statuses.at(-1).kind, 'warning');
}

console.log('Cloud sync race tests passed: serial writes, stale pulls, session fences, newer queued edits, offline retries.');
