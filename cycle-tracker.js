(() => {
  'use strict';

  const dataApi = window.MoLifeCycleData;
  const app = window.DalliApp;
  const dialog = document.querySelector('#cycleDialog');
  if (!dataApi || !app || !dialog) return;

  const $ = selector => document.querySelector(selector);
  const elements = {
    openSettings: $('#cycleSettingsButton'),
    close: $('#closeCycleButton'),
    enable: $('#cycleEnableButton'),
    disable: $('#cycleDisableButton'),
    optIn: $('#cycleOptInArea'),
    active: $('#cycleActiveArea'),
    calendar: $('#cycleCalendar'),
    start: $('#cycleStart'),
    end: $('#cycleEnd'),
    kind: $('#cycleKind'),
    flow: $('#cycleFlow'),
    save: $('#cycleSaveButton'),
    newEntry: $('#cycleNewButton'),
    deleteEntry: $('#cycleDeleteEntryButton'),
    clearAll: $('#cycleDeleteAllButton'),
    export: $('#cycleExportButton'),
    list: $('#cycleEntriesList'),
    message: $('#cycleMessage'),
    overview: $('#cycleSettingsStatus')
  };

  let identity = null;
  let records = dataApi.empty();
  let calendar = null;
  let editingId = null;
  let choosingEnd = false;
  let blocked = false;

  function notify(text, error = false) {
    elements.message.textContent = text;
    elements.message.dataset.kind = error ? 'error' : 'ok';
  }

  function currentIdentity() { return app.getStorageKey(); }

  function load() {
    identity = currentIdentity();
    blocked = false;
    try {
      records = dataApi.read(identity);
    } catch (error) {
      blocked = true;
      records = dataApi.empty();
      notify('Could not read local cycle records. Nothing has been overwritten. ' + error.message, true);
    }
    render();
  }

  function persist(next, successText) {
    if (blocked || !identity || identity !== currentIdentity()) {
      notify('Account changed or local storage is unavailable. Reopen the tracker.', true);
      return false;
    }
    try {
      records = dataApi.write(identity, next);
      notify(successText);
      render();
      return true;
    } catch (error) {
      notify('Not saved: ' + error.message, true);
      return false;
    }
  }

  function localDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function friendly(key) {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(localDate(key));
  }

  function dateAtToday() { return dataApi.dateKey(new Date()); }

  function clearEditor() {
    editingId = null;
    choosingEnd = false;
    elements.start.value = '';
    elements.end.value = '';
    elements.kind.value = 'period';
    elements.flow.value = 'unspecified';
    elements.deleteEntry.hidden = true;
  }

  function editEntry(entry) {
    editingId = entry.id;
    choosingEnd = false;
    elements.start.value = entry.start;
    elements.end.value = entry.end;
    elements.kind.value = entry.kind;
    elements.flow.value = entry.flow;
    elements.deleteEntry.hidden = false;
    notify('Editing ' + friendly(entry.start) + ' – ' + friendly(entry.end) + '. Save changes or delete this entry.');
  }

  function calendarDay({ date, cellType }) {
    if (cellType !== 'day') return {};
    const key = dataApi.dateKey(date);
    const entry = dataApi.entryForDay(records, key);
    if (!entry) return {};
    return {
      classes: entry.kind === 'spotting' ? 'cycle-calendar-spotting' : 'cycle-calendar-period',
      attrs: { title: (entry.kind === 'spotting' ? 'Spotting' : 'Period') + ': ' + friendly(entry.start) + ' – ' + friendly(entry.end),
        'aria-label': friendly(key) + ', recorded ' + entry.kind }
    };
  }

  function selectDay({ date }) {
    if (!(date instanceof Date) || blocked || !records.enabled) return;
    const key = dataApi.dateKey(date);
    const previous = dataApi.entryForDay(records, key);
    if (previous) {
      editEntry(previous);
      return;
    }
    if (!choosingEnd || editingId) {
      clearEditor();
      elements.start.value = key;
      elements.end.value = key;
      choosingEnd = true;
      notify('Start selected. Tap another day for the end, or use the date fields.');
      return;
    }
    const start = elements.start.value;
    elements.start.value = key < start ? key : start;
    elements.end.value = key < start ? start : key;
    choosingEnd = false;
    notify('Date range selected. Confirm and save the entry.');
  }

  function ensureCalendar() {
    if (calendar || !records.enabled || blocked) return;
    if (typeof window.AirDatepicker !== 'function') {
      notify('The offline calendar could not load. Reload MoLife and try again.', true);
      return;
    }
    calendar = new window.AirDatepicker(elements.calendar, {
      inline: true,
      firstDay: 1,
      fixedHeight: true,
      startDate: new Date(),
      maxDate: new Date(),
      classes: 'cycle-air-calendar',
      onRenderCell: calendarDay,
      onSelect: selectDay
    });
  }

  function redrawCalendar() {
    if (!records.enabled || blocked) {
      if (calendar) { calendar.destroy(); calendar = null; }
      return;
    }
    ensureCalendar();
    if (calendar) calendar.update({ onRenderCell: calendarDay, maxDate: new Date() });
  }

  function buildEntryRow(entry) {
    const row = document.createElement('div');
    row.className = 'cycle-entry';
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = friendly(entry.start) + ' – ' + friendly(entry.end);
    const detail = document.createElement('span');
    detail.textContent = (entry.kind === 'spotting' ? 'Spotting' : 'Period')
      + (entry.flow !== 'unspecified' ? ' · ' + entry.flow + ' flow' : '');
    text.append(name, detail);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary-button';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', 'Edit cycle record ' + friendly(entry.start));
    edit.addEventListener('click', () => { editEntry(entry); elements.start.focus(); });
    row.append(text, edit);
    return row;
  }

  function render() {
    elements.optIn.hidden = records.enabled && !blocked;
    elements.active.hidden = !records.enabled || blocked;
    elements.enable.disabled = blocked;
    elements.disable.disabled = blocked;
    elements.clearAll.disabled = blocked || !records.entries.length;
    elements.export.disabled = blocked || !records.entries.length;
    elements.overview.textContent = blocked ? 'LOCAL DATA UNAVAILABLE' :
      records.enabled ? 'ENABLED · THIS DEVICE ONLY' : 'NOT ENABLED';
    elements.list.replaceChildren();
    records.entries.slice().reverse().forEach(entry => elements.list.append(buildEntryRow(entry)));
    if (!records.entries.length) {
      const empty = document.createElement('p');
      empty.className = 'cycle-empty';
      empty.textContent = 'No entries recorded. Select dates on the calendar or enter them below.';
      elements.list.append(empty);
    }
    redrawCalendar();
  }

  function open() {
    load();
    clearEditor();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.scrollTop = 0;
  }

  function close() {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function onIdentityChanged() {
    // Never show the previous account's sensitive records after login/logout.
    close();
    if (calendar) { calendar.destroy(); calendar = null; }
    records = dataApi.empty();
    identity = null;
    clearEditor();
    elements.overview.textContent = 'OPEN TO VIEW LOCAL STATUS';
  }

  function saveEntry() {
    const start = elements.start.value;
    const end = elements.end.value || start;
    const first = dataApi.dayNumber(start);
    const last = dataApi.dayNumber(end);
    const today = dataApi.dayNumber(dateAtToday());
    if (first === null || last === null || first > last || last > today || last - first > 59) {
      notify('Choose actual dates (no future dates), in order, with a range of 60 days or less.', true);
      return;
    }
    const entry = {
      id: editingId || dataApi.newId(),
      start, end,
      kind: elements.kind.value,
      flow: elements.flow.value
    };
    try {
      const next = dataApi.upsert(records, entry);
      if (persist(next, editingId ? 'Entry updated on this device.' : 'Entry saved on this device.')) clearEditor();
    } catch (error) {
      notify(error.message, true);
    }
  }

  function exportRecords() {
    if (blocked || !records.entries.length) return;
    const body = JSON.stringify(records, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'molife-cycle-local-' + dateAtToday() + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Sensitive data exported to an unencrypted local file. Keep it private.');
  }

  elements.openSettings.addEventListener('click', open);
  elements.close.addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  elements.enable.addEventListener('click', () => {
    if (persist({ ...records, enabled: true }, 'Cycle Tracker enabled on this device.')) clearEditor();
  });
  elements.disable.addEventListener('click', () => {
    if (persist({ ...records, enabled: false }, 'Tracker disabled. Local records are kept until you delete them.')) clearEditor();
  });
  elements.save.addEventListener('click', saveEntry);
  elements.newEntry.addEventListener('click', () => { clearEditor(); notify('New entry: select dates or enter them below.'); });
  elements.deleteEntry.addEventListener('click', () => {
    if (!editingId) return;
    const entry = records.entries.find(item => item.id === editingId);
    if (!entry || !window.confirm('Delete the selected cycle entry from this device?')) return;
    if (persist({ ...records, entries: records.entries.filter(item => item.id !== editingId) }, 'Entry deleted.')) clearEditor();
  });
  elements.clearAll.addEventListener('click', () => {
    if (blocked || !records.entries.length || !window.confirm('Delete ALL period and spotting records stored on this device for this account? This cannot be undone.')) return;
    if (persist({ ...records, entries: [] }, 'All local cycle records deleted.')) clearEditor();
  });
  elements.export.addEventListener('click', exportRecords);
  elements.start.addEventListener('input', () => { choosingEnd = false; });
  elements.end.addEventListener('input', () => { choosingEnd = false; });
  elements.kind.addEventListener('change', () => { elements.flow.disabled = elements.kind.value === 'spotting'; if (elements.flow.disabled) elements.flow.value = 'unspecified'; });

  window.MoLifeCycle = Object.freeze({
    onIdentityChanged,
    deleteAccountData(accountStorageKey) {
      try { dataApi.remove(accountStorageKey); } catch (error) {
        console.warn('Could not remove device-only cycle data for deleted account:', error);
      }
      onIdentityChanged();
    }
  });
})();
