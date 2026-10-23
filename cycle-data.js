(() => {
  'use strict';

  // Cycle records never enter DalliApp state, profiles, templates or cloud sync.
  const PREFIX = 'molife.cycle.local.v1:';
  const MAX_ENTRIES = 240;
  const KINDS = new Set(['period', 'spotting']);
  const FLOWS = new Set(['unspecified', 'light', 'medium', 'heavy']);

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dayNumber(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const value = new Date(Date.UTC(y, m - 1, d));
    if (value.getUTCFullYear() !== y || value.getUTCMonth() + 1 !== m || value.getUTCDate() !== d) return null;
    return Math.floor(value.getTime() / 86400000);
  }

  function storageKey(identity) {
    if (typeof identity !== 'string' || !identity || identity.length > 200) throw new Error('Account identity unavailable');
    return PREFIX + encodeURIComponent(identity);
  }

  function validate(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || candidate.schemaVersion !== 1 || typeof candidate.enabled !== 'boolean'
        || !Array.isArray(candidate.entries) || candidate.entries.length > MAX_ENTRIES) {
      throw new Error('Cycle storage is incompatible or damaged. Export the stored data before replacing it.');
    }

    const used = new Set();
    const entries = candidate.entries.map(raw => {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid cycle entry');
      const { id, start, end, kind, flow } = raw;
      const first = dayNumber(start);
      const last = dayNumber(end);
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(id) || used.has(id)
          || first === null || last === null || last < first || last - first > 59
          || !KINDS.has(kind) || !FLOWS.has(flow)) {
        throw new Error('Invalid or overlapping cycle record; nothing was saved.');
      }
      used.add(id);
      return { id, start, end, kind, flow };
    }).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    for (let i = 1; i < entries.length; i++) {
      if (entries[i].start <= entries[i - 1].end) {
        throw new Error('Period or spotting records cannot overlap. Edit the existing entry.');
      }
    }
    return { schemaVersion: 1, enabled: candidate.enabled, entries };
  }

  function empty() { return { schemaVersion: 1, enabled: false, entries: [] }; }

  function read(identity) {
    const key = storageKey(identity);
    const raw = localStorage.getItem(key);
    return raw === null ? empty() : validate(JSON.parse(raw));
  }

  function write(identity, data) {
    const clean = validate(data);
    localStorage.setItem(storageKey(identity), JSON.stringify(clean));
    return clean;
  }

  function remove(identity) { localStorage.removeItem(storageKey(identity)); }

  function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  }

  function upsert(data, entry) {
    const next = { ...data, entries: data.entries.filter(item => item.id !== entry.id).concat(entry) };
    return validate(next);
  }

  function entryForDay(data, day) {
    return data.entries.find(entry => entry.start <= day && day <= entry.end) || null;
  }

  window.MoLifeCycleData = Object.freeze({
    read, write, remove, validate, empty, upsert, entryForDay, dateKey, dayNumber, storageKey, newId
  });
})();
