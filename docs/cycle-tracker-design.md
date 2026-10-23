# MoLife — Menstrual-cycle tracking design

**Status:** the manual local-only calendar is implemented in v4.32. Mood overlays, phase estimates and encrypted cloud sync are deferred. No reproductive-health records leave the browser.

## Product and accessibility

Offer a fully opt-in **Cycle Tracker** for anyone who menstruates, independently of gender and of the app's five configurable activity profiles. It never changes damage, XP, ranks or required Actions. Provide a clear off switch and easy data deletion.

First release: a monthly calendar supporting manual entry, editing and deletion of the *actual* start/end of bleeding, plus optional spotting and flow intensity. Keep a real-day view and a clear distinction between observed dates and estimates. Calendar history should never silently assume a regular 28-day cycle; hormonal contraception, irregular/missed cycles, pregnancy and perimenopause require unknown/disabled estimation states. The calendar must work offline, on small screens, with keyboard/screen readers, and without color as the only indicator.

## Reuse an existing calendar

The original candidate was **FullCalendar Standard v7** (vanilla JavaScript month/dayGrid plus interaction modules), licensed MIT: https://fullcalendar.io/license and https://fullcalendar.io/docs/vanilla-js. It provides a mature UI for month navigation, event display and date selection; it does *not* supply cycle logic, medical predictions or privacy controls. Only use Standard plugins, not Premium/Scheduler.

**Shipped implementation:** [Air Datepicker v3.6.0](https://air-datepicker.com/), a smaller, dependency-free MIT calendar, pinned to local `vendor/` assets. Shaded day cells show recorded periods/spotting. Native date inputs provide keyboard editing.

This repo is a dependency-light, frameworkless PWA. Compare the actual distribution footprint against smaller MIT calendars before choosing. Pin a supported version, preserve license notices, ship the needed build locally (no runtime CDN), load lazily only for opted-in users, and add the assets to the service-worker cache for offline use.

## Sensitive-data handling: implementation prerequisite

Reproductive-health dates are unusually sensitive. MoLife's existing cloud state is stored on a PHP server; it must **not** be described as end-to-end encrypted. Do not put cycle data into generic `metrics.daily`, fight history, profiles/templates, cloud state, URL parameters, analytics, error logs or notifications by default.

Start with **local-only, separately stored, account-scoped cycle data** and an unambiguous disclosure that it stays on the current device. Model and test account switching, sign-out, storage clearing, shared devices, device loss, export/backup, and account deletion. Offer delete-all-cycle-data and a portable local export. Never automatically migrate or upload cycle information upon login or cloud synchronization.

If cross-device sync is wanted, make it a separate security-reviewed opt-in feature with meaningful client-side encryption, key/recovery design, conflict handling and deletion semantics before sending anything to the server. An open-source calendar does not solve storage confidentiality.

## Minimal local schema

```js
cycle = {
  schemaVersion: 1,
  enabled: true,
  entries: [
    { id: 'opaque-random-id', start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', kind: 'period' }
  ]
};
```

Use local calendar dates rather than UTC timestamps. Validate real dates, ordering, range lengths, duplicated/overlapping entries, counts and payload sizes. Store actual observations, not predicted days, as primary records; keep projections derived and discardable. The tracker belongs to a person/account, not to their switchable action-settings profile.

## Link to the Data Terminal (follow-up)

Add **Show cycle context** as an optional overlay on the existing Mood chart once the user has cycle data. Mark *observed bleeding* with modest vertical calendar bands aligned to graph dates. If estimated phases are offered later, make the distinction visually and verbally explicit, show uncertainty and allow phase predictions to be disabled. Do not present ovulation/fertility estimates as contraception guidance.

Show descriptive mood breakdowns by phase only when there are enough actual paired mood/cycle observations, label sample counts clearly and avoid claims of causation or diagnosis. A calendar-based phase estimate is not proof of a hormone concentration, ovulation or an individual's symptoms. Never fabricate missing Mood readings.

## Suggested implementation order

1. Dependency evaluation, threat model, mobile and accessible month-grid prototype.
2. Separate opt-in local-only cycle store, manual logging, editing, deleting, exporting and privacy tests.
3. Mood chart overlay for observed bleeding dates, then cautiously specified phase estimation and descriptive summaries.
4. Optional encrypted cross-device sync as a distinct review and release, never an implicit addition.

Acceptance tests: leap days, DST, cross-year ranges, overlapping corrections, irregular periods, no-period users, account/device isolation, offline calendar, missing mood data, mobile interactions, keyboard access, and leak scans of outgoing HTTP/saved cloud payloads. No pregnancy prevention, ovulation confirmation or medical advice is in scope.
