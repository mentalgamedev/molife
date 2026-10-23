(() => {
  'use strict';

  const dialog = document.querySelector('#metricsDialog');
  if (!dialog || !window.DalliApp) return;

  const dialogTitle = document.querySelector('#metricsDialogTitle');
  const metricSelect = document.querySelector('#metricsMetricSelect');
  const rangeButtons = [...document.querySelectorAll('[data-metrics-range]')];
  const customRange = document.querySelector('#metricsCustomRange');
  const customStart = document.querySelector('#metricsCustomStart');
  const customEnd = document.querySelector('#metricsCustomEnd');
  const trendToggle = document.querySelector('#metricsTrendToggle');
  const cycleOptions = document.querySelector('#metricsCycleOptions');
  const cycleToggle = document.querySelector('#metricsCycleToggle');
  const cycleLegendPeriod = document.querySelector('#metricsCycleLegendPeriod');
  const cycleLegendSpotting = document.querySelector('#metricsCycleLegendSpotting');
  const chart = document.querySelector('#metricsChart');
  const chartEmpty = document.querySelector('#metricsChartEmpty');
  const chartCaption = document.querySelector('#metricsChartCaption');
  const recordedValue = document.querySelector('#metricsRecordedValue');
  const averageValue = document.querySelector('#metricsAverageValue');
  const lowValue = document.querySelector('#metricsLowValue');
  const highValue = document.querySelector('#metricsHighValue');
  const rangeNote = document.querySelector('#metricsRangeNote');
  const baselineLabel = document.querySelector('#metricsBaselineLabel');
  const disclaimer = document.querySelector('#metricsDisclaimer');
  const closeButton = document.querySelector('#closeMetricsButton');

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_CUSTOM_DAYS = 3660;
  let rangeMode = 'week';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function dateFromKey(dateKey) {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function addDays(dateKey, amount) {
    const date = dateFromKey(dateKey);
    date.setDate(date.getDate() + amount);
    return localDateKey(date);
  }

  function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function formatShortDate(dateKey) {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    }).format(dateFromKey(dateKey));
  }

  function formatLongDate(dateKey) {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(dateFromKey(dateKey));
  }

  function moodBand(value) {
    const mood = clamp(value, -100, 100);
    if (mood <= -60) return 'Very Low';
    if (mood <= -20) return 'Low';
    if (mood < 20) return 'Balanced';
    if (mood < 60) return 'Elevated';
    return 'Very High';
  }

  const METRICS = Object.freeze({
    mood: Object.freeze({
      id: 'mood',
      label: 'Mood',
      min: -100,
      max: 100,
      baseline: 0,
      baselineLabel: 'BALANCED',
      ticks: [
        { value: 100, label: 'VERY HIGH' },
        { value: 50, label: 'ELEVATED' },
        { value: 0, label: 'BALANCED' },
        { value: -50, label: 'LOW' },
        { value: -100, label: 'VERY LOW' }
      ],
      read(state, dateKey) {
        const raw = state?.metrics?.daily?.[dateKey]?.mood;
        const value = Number(raw);
        return Number.isFinite(value) ? clamp(value, -100, 100) : null;
      },
      format(value, { compact = false } = {}) {
        if (!Number.isFinite(value)) return '—';
        const rounded = Math.round(value * 10) / 10;
        const signed = rounded > 0 ? `+${rounded}` : String(rounded);
        return compact ? signed : `${moodBand(value)} · ${signed}`;
      },
      disclaimer: 'Mood is a self-reported daily signal, not a diagnosis.'
    }),
    damage: Object.freeze({
      id: 'damage',
      label: 'Damage dealt',
      baseline: 0,
      baselineLabel: 'ZERO DAMAGE',
      dynamicAxis: true,
      read(state, dateKey, historyByDate) {
        if (state?.current?.date === dateKey) {
          return (state.current.transactions || []).reduce(
            (total, tx) => total + Math.max(0, Number(tx.damage) || 0), 0
          );
        }
        const day = historyByDate.get(dateKey);
        return day && Number.isFinite(Number(day.damage)) ? Math.max(0, Number(day.damage)) : null;
      },
      format(value) {
        return Number.isFinite(value) ? `${Math.round(value).toLocaleString()} DMG` : '—';
      },
      disclaimer: 'Damage includes Actions, previously awarded bonuses and items. Recorded fight days with no damage count as zero; missing archives remain unrecorded.'
    })
  });

  function activeMetric() {
    return METRICS[metricSelect?.value] || METRICS.mood;
  }

  function enumerateDates(start, end) {
    if (!isDateKey(start) || !isDateKey(end)) return [];
    const dates = [];
    let cursor = start;
    for (let i = 0; i < MAX_CUSTOM_DAYS && cursor <= end; i += 1) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  function resolvedRange() {
    const today = localDateKey();

    if (rangeMode === 'week') {
      return { start: addDays(today, -6), end: today, clipped: false };
    }
    if (rangeMode === 'month') {
      return { start: addDays(today, -29), end: today, clipped: false };
    }
    if (rangeMode === 'year') {
      return { start: addDays(today, -364), end: today, clipped: false };
    }

    let start = isDateKey(customStart?.value) ? customStart.value : addDays(today, -29);
    let end = isDateKey(customEnd?.value) ? customEnd.value : today;
    if (start > end) [start, end] = [end, start];
    if (end > today) end = today;
    if (start > today) start = today;
    if (start > end) start = end;

    let clipped = false;
    const earliestAllowed = addDays(end, -(MAX_CUSTOM_DAYS - 1));
    if (start < earliestAllowed) {
      start = earliestAllowed;
      clipped = true;
    }

    if (customStart) customStart.value = start;
    if (customEnd) customEnd.value = end;
    return { start, end, clipped };
  }

  function svgNode(tag, attributes = {}, text = '') {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text) node.textContent = text;
    return node;
  }

  function yFor(value, axis, top, height) {
    const ratio = (axis.max - value) / Math.max(1, axis.max - axis.min);
    return top + (ratio * height);
  }

  function xFor(index, count, left, width) {
    if (count <= 1) return left + (width / 2);
    return left + ((index / (count - 1)) * width);
  }

  // Connect recorded observations even when intermediate dates were not logged.
  // X positions remain date-based: missing measurements are not interpolated or saved.
  function rawPath(points) {
    return points
      .filter(point => point.value !== null)
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');
  }

  function resolvedAxis(metric, recorded, trend) {
    if (!metric.dynamicAxis) return metric;
    const peak = Math.max(4, ...recorded, ...trend.filter(value => value !== null));
    const roughStep = peak / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const multiplier = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= roughStep) || 10;
    const step = multiplier * magnitude;
    return {
      min: 0,
      max: step * 4,
      baseline: 0,
      ticks: [4, 3, 2, 1, 0].map(index => ({
        value: index * step,
        label: `${Math.round(index * step).toLocaleString()} DMG`
      }))
    };
  }

  function trendSeries(state, metric, dates, historyByDate) {
    return dates.map(dateKey => {
      const values = [];
      for (let offset = -6; offset <= 0; offset += 1) {
        const value = metric.read(state, addDays(dateKey, offset), historyByDate);
        if (value !== null) values.push(value);
      }
      if (values.length < 2) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });
  }

  // The Cycle Tracker lives in its own browser-only storage, never in DalliApp's
  // syncable state. Do not cache these entries or pass them to telemetry/cloud APIs.
  function availableCycleRecords(metric) {
    if (metric.id !== 'mood' || !cycleOptions || !cycleToggle) return null;
    try {
      const api = window.MoLifeCycleData;
      const identity = window.DalliApp.getStorageKey();
      if (!api || !identity) return null;
      const data = api.read(identity);
      return data.enabled && data.entries.length ? data.entries : null;
    } catch (_) {
      // Inaccessible or invalid local health data fails closed. It is never overwritten.
      return null;
    }
  }

  function renderCycleBands(entries, dates, range, left, top, plotWidth, plotHeight) {
    if (!entries || !dates.length) return { period: 0, spotting: 0 };
    const api = window.MoLifeCycleData;
    const first = api.dayNumber(range.start);
    const last = api.dayNumber(range.end);
    if (first === null || last === null) return { period: 0, spotting: 0 };
    const step = dates.length > 1 ? plotWidth / (dates.length - 1) : plotWidth;
    const counts = { period: 0, spotting: 0 };

    entries.forEach(entry => {
      const entryFirst = api.dayNumber(entry.start);
      const entryLast = api.dayNumber(entry.end);
      if (entryFirst === null || entryLast === null) return;
      const from = Math.max(first, entryFirst);
      const to = Math.min(last, entryLast);
      if (from > to) return;
      const firstIndex = from - first;
      const lastIndex = to - first;
      const startX = Math.max(left, xFor(firstIndex, dates.length, left, plotWidth) - step / 2);
      const endX = Math.min(left + plotWidth, xFor(lastIndex, dates.length, left, plotWidth) + step / 2);
      const band = svgNode('rect', {
        x: startX.toFixed(2),
        y: top,
        width: Math.max(0, endX - startX).toFixed(2),
        height: plotHeight,
        class: entry.kind === 'spotting' ? 'metrics-cycle-spotting' : 'metrics-cycle-period'
      });
      band.append(svgNode('title', {},
        `Recorded ${entry.kind}: ${formatLongDate(entry.start)} – ${formatLongDate(entry.end)} (actual dates)`));
      chart.append(band);
      counts[entry.kind] += to - from + 1;
    });

    return counts;
  }

  function selectedTickIndexes(count) {
    if (count <= 1) return [0];
    const desired = count <= 8 ? count : 6;
    const indexes = new Set([0, count - 1]);
    for (let i = 1; i < desired - 1; i += 1) {
      indexes.add(Math.round((i / (desired - 1)) * (count - 1)));
    }
    return [...indexes].sort((a, b) => a - b);
  }

  function renderGraph() {
    if (!chart) return;

    const state = window.DalliApp.getState();
    const metric = activeMetric();
    const range = resolvedRange();
    const dates = enumerateDates(range.start, range.end);
    const historyByDate = new Map((state.history || []).map(day => [day.date, day]));
    const values = dates.map(dateKey => metric.read(state, dateKey, historyByDate));
    const recorded = values.filter(value => value !== null);
    const trend = trendToggle?.checked ? trendSeries(state, metric, dates, historyByDate) : [];
    const axis = resolvedAxis(metric, recorded, trend);
    const cycleEntries = availableCycleRecords(metric);
    if (cycleOptions) cycleOptions.hidden = !cycleEntries;
    if (!cycleEntries && cycleToggle) cycleToggle.checked = false;
    const showCycle = Boolean(cycleEntries && cycleToggle?.checked);
    if (cycleLegendPeriod) cycleLegendPeriod.hidden = !showCycle;
    if (cycleLegendSpotting) cycleLegendSpotting.hidden = !showCycle;

    chart.replaceChildren();

    const compact = window.matchMedia('(max-width: 600px)').matches;
    const viewWidth = compact ? 640 : 900;
    const viewHeight = compact ? 420 : 360;
    const left = compact ? 84 : 92;
    const right = 24;
    const top = 26;
    const bottom = 54;
    const plotWidth = viewWidth - left - right;
    const plotHeight = viewHeight - top - bottom;

    chart.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
    chart.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    chart.style.aspectRatio = `${viewWidth} / ${viewHeight}`;
    if (dialogTitle) dialogTitle.textContent = 'Data Terminal';
    if (baselineLabel) baselineLabel.textContent = `${metric.baselineLabel.toLowerCase()} baseline`;
    if (disclaimer) disclaimer.textContent = `${metric.disclaimer} NOTICE 04:20: the Joint Committee confirms these statistics may be slightly elevated.`;

    // Draw observed local calendar intervals first, behind grids and readings.
    // Bands indicate where an entry exists, NOT a predicted phase or missing Mood value.
    const cycleCounts = showCycle
      ? renderCycleBands(cycleEntries, dates, range, left, top, plotWidth, plotHeight)
      : { period: 0, spotting: 0 };

    axis.ticks.forEach(tick => {
      const y = yFor(tick.value, axis, top, plotHeight);
      const baseline = tick.value === axis.baseline;
      chart.append(
        svgNode('line', {
          x1: left,
          x2: viewWidth - right,
          y1: y,
          y2: y,
          class: baseline ? 'metrics-baseline' : 'metrics-grid-line'
        }),
        svgNode('text', {
          x: left - 12,
          y: y + 4,
          class: baseline ? 'metrics-y-label is-baseline' : 'metrics-y-label',
          'text-anchor': 'end'
        }, tick.label)
      );
    });

    const points = dates.map((dateKey, index) => {
      const value = values[index];
      return {
        dateKey,
        value,
        x: xFor(index, dates.length, left, plotWidth),
        y: value === null ? null : yFor(value, axis, top, plotHeight)
      };
    });

    const rawD = rawPath(points);
    if (rawD) {
      chart.append(svgNode('path', {
        d: rawD,
        class: 'metrics-series-line'
      }));
    }

    if (trendToggle?.checked) {
      const trendPoints = dates.map((dateKey, index) => {
        const value = trend[index];
        return {
          dateKey,
          value,
          x: xFor(index, dates.length, left, plotWidth),
          y: value === null ? null : yFor(value, axis, top, plotHeight)
        };
      });
      const trendD = rawPath(trendPoints);
      if (trendD) {
        chart.append(svgNode('path', {
          d: trendD,
          class: 'metrics-trend-line'
        }));
      }
    }

    if (dates.length <= 62) {
      points.forEach(point => {
        if (point.value === null) return;
        const circle = svgNode('circle', {
          cx: point.x,
          cy: point.y,
          r: 4,
          class: 'metrics-point'
        });
        circle.append(svgNode('title', {}, `${formatLongDate(point.dateKey)}: ${metric.format(point.value)}`));
        chart.append(circle);
      });
    } else {
      const pointCloud = points
        .filter(point => point.value !== null)
        .map(point => `M ${point.x.toFixed(2)} ${point.y.toFixed(2)} l 0 0.01`)
        .join(' ');
      if (pointCloud) {
        chart.append(svgNode('path', {
          d: pointCloud,
          class: 'metrics-point-cloud'
        }));
      }
    }

    selectedTickIndexes(dates.length).forEach(index => {
      const dateKey = dates[index];
      const x = xFor(index, dates.length, left, plotWidth);
      chart.append(
        svgNode('line', {
          x1: x,
          x2: x,
          y1: viewHeight - bottom + 5,
          y2: viewHeight - bottom + 10,
          class: 'metrics-x-tick'
        }),
        svgNode('text', {
          x,
          y: viewHeight - 20,
          class: 'metrics-x-label',
          'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'
        }, formatShortDate(dateKey))
      );
    });

    chartEmpty.hidden = recorded.length > 0 || (showCycle && cycleCounts.period + cycleCounts.spotting > 0);

    const average = recorded.length
      ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length
      : null;
    const low = recorded.length ? Math.min(...recorded) : null;
    const high = recorded.length ? Math.max(...recorded) : null;

    recordedValue.textContent = `${recorded.length} / ${dates.length}`;
    averageValue.textContent = average === null ? '—' : metric.format(average);
    lowValue.textContent = low === null ? '—' : metric.format(low);
    highValue.textContent = high === null ? '—' : metric.format(high);

    const missingCount = dates.length - recorded.length;
    chartCaption.textContent = recorded.length
      ? `${formatLongDate(range.start)} – ${formatLongDate(range.end)} · ${missingCount} day${missingCount === 1 ? '' : 's'} without readings; lines bridge missing days`
      : `${formatLongDate(range.start)} – ${formatLongDate(range.end)} · no readings recorded in this range`;

    const readingsNote = trendToggle?.checked
      ? 'Dashed 7-day trend averages available Mood readings only; lines bridge missing dates without imputing readings.'
      : 'Lines connect recorded points across unrecorded dates; no missing values are filled in.';
    const clippedNote = range.clipped
      ? 'Custom views are limited to 3,660 calendar days. The earliest part of this range was clipped. '
      : '';
    const cycleNote = showCycle
      ? ` Locally recorded cycle days in range: ${cycleCounts.period} period, ${cycleCounts.spotting} spotting. Unshaded dates do not establish a cycle phase or absence of bleeding. No prediction or causal inference.`
      : '';
    rangeNote.textContent = clippedNote + readingsNote + cycleNote;

    chart.setAttribute(
      'aria-label',
      recorded.length
        ? `${metric.label} chart from ${formatLongDate(range.start)} to ${formatLongDate(range.end)}. ${recorded.length} of ${dates.length} days recorded. Average ${metric.format(average)}. Lowest ${metric.format(low)}. Highest ${metric.format(high)}.${showCycle ? ` Observed period days: ${cycleCounts.period}; spotting days: ${cycleCounts.spotting}. No phase estimates.` : ''}`
        : `${metric.label} chart from ${formatLongDate(range.start)} to ${formatLongDate(range.end)}. No readings recorded.${showCycle ? ` Observed period days: ${cycleCounts.period}; spotting days: ${cycleCounts.spotting}.` : ''}`
    );
  }

  function setRange(nextRange) {
    rangeMode = ['week', 'month', 'year', 'custom'].includes(nextRange) ? nextRange : 'week';
    rangeButtons.forEach(button => {
      const active = button.dataset.metricsRange === rangeMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    customRange.hidden = rangeMode !== 'custom';
    renderGraph();
  }

  function openMetric(metricId = null) {
    // Deliberately require an explicit reveal each time the terminal is opened.
    if (cycleToggle) cycleToggle.checked = false;
    if (METRICS[metricId]) metricSelect.value = metricId;

    const today = localDateKey();
    if (!customStart.value) customStart.value = addDays(today, -29);
    if (!customEnd.value) customEnd.value = today;
    customStart.max = today;
    customEnd.max = today;

    setRange(rangeMode);
    dialog.scrollTop = 0;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeMetrics() {
    if (cycleToggle) cycleToggle.checked = false;
    if (!dialog.open && !dialog.hasAttribute('open')) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  document.querySelectorAll('[data-open-metric]').forEach(button => {
    button.addEventListener('click', () => openMetric(button.dataset.openMetric || null));
  });

  rangeButtons.forEach(button => {
    button.addEventListener('click', () => setRange(button.dataset.metricsRange));
  });

  metricSelect?.addEventListener('change', () => {
    if (cycleToggle) cycleToggle.checked = false;
    renderGraph();
  });
  cycleToggle?.addEventListener('change', renderGraph);
  trendToggle?.addEventListener('change', renderGraph);
  customStart?.addEventListener('change', renderGraph);
  customEnd?.addEventListener('change', renderGraph);
  closeButton?.addEventListener('click', closeMetrics);

  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeMetrics();
  });

  window.addEventListener('resize', () => {
    if (dialog.open) renderGraph();
  }, { passive: true });

  function onIdentityChanged() {
    // An account/session switch must not leave a previous person's health overlay visible.
    if (cycleToggle) cycleToggle.checked = false;
    chart?.replaceChildren();
    if (cycleOptions) cycleOptions.hidden = true;
    if (cycleLegendPeriod) cycleLegendPeriod.hidden = true;
    if (cycleLegendSpotting) cycleLegendSpotting.hidden = true;
    if (dialog.open) closeMetrics();
  }

  window.MoLifeMetrics = Object.freeze({
    open: openMetric,
    render: renderGraph,
    onIdentityChanged
  });
})();
