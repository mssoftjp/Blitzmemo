import { formatApiError } from '../shared/apiError';
import type { UiStringKey } from '../shared/i18n';
import type { StatsEntry, UiLanguage } from '../shared/types';
import { formatTimestamp } from './historyView';

type StatsGroupBy = 'day' | 'week' | 'month';

const STATS_GROUP_BY_STORAGE_KEY = 'avi:statsGroupBy';
const STATS_INCLUDE_WAIT_TIME_STORAGE_KEY = 'avi:statsIncludeWaitTime';
const RESET_CONFIRM_TIMEOUT_MS = 4000;

const USAGE_RATES_PER_MINUTE_USD: Record<string, number> = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003
};

const USAGE_MODEL_ORDER = [
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe'
];

type StatsUsageElements = {
  clearUsage: HTMLButtonElement;
  clearStats: HTMLButtonElement;
  usageSummary: HTMLDivElement;
  usageMeta: HTMLDivElement;
  usageTable: HTMLDivElement;
  statsSummary: HTMLDivElement;
  statsMeta: HTMLDivElement;
  statsTable: HTMLDivElement;
  statsGroupBy: HTMLSelectElement;
  statsIncludeWaitTime: HTMLInputElement;
};

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type SetupStatsUsageOptions = {
  els: StatsUsageElements;
  tr: Translator;
  getUiLanguage: () => UiLanguage;
  getActivePage: () => string;
  getKeyboardCharsPerMinute: () => number;
};

export type StatsUsageApi = {
  syncStatsControlsFromPreferences: () => void;
  setupEventListeners: () => void;
  disarmResetButtons: () => void;
  refreshStats: () => Promise<void>;
  refreshUsage: () => Promise<void>;
};

function voidAsync<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    fn(...args).catch((error) => {
      console.error(error);
    });
  };
}

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '-';
  const abs = Math.abs(amount);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `$${amount.toFixed(digits)}`;
}

function formatMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00';
  return (seconds / 60).toFixed(2);
}

function formatRatePerMinute(rate: number | undefined): string {
  if (!rate || !Number.isFinite(rate)) return '-';
  return `$${rate.toFixed(3)}`;
}

function isStatsEntry(value: unknown): value is StatsEntry {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const lang = obj.language;
  const model = obj.model;
  const waitSeconds = obj.waitSeconds;
  const hasValidWaitSeconds =
    waitSeconds === undefined ||
    waitSeconds === null ||
    (typeof waitSeconds === 'number' && Number.isFinite(waitSeconds) && waitSeconds >= 0);
  return (
    typeof obj.id === 'string' &&
    typeof obj.endedAt === 'number' &&
    Number.isFinite(obj.endedAt) &&
    typeof obj.durationSeconds === 'number' &&
    Number.isFinite(obj.durationSeconds) &&
    typeof obj.charCount === 'number' &&
    Number.isFinite(obj.charCount) &&
    hasValidWaitSeconds &&
    typeof lang === 'string' &&
    (lang === 'ja' ||
      lang === 'en' ||
      lang === 'es' ||
      lang === 'it' ||
      lang === 'de' ||
      lang === 'pt' ||
      lang === 'pl' ||
      lang === 'id' ||
      lang === 'fr' ||
      lang === 'ru' ||
      lang === 'vi' ||
      lang === 'nl' ||
      lang === 'uk' ||
      lang === 'ko' ||
      lang === 'ro' ||
      lang === 'ms' ||
      lang === 'tr' ||
      lang === 'th' ||
      lang === 'sv' ||
      lang === 'no' ||
      lang === 'da' ||
      lang === 'zh-hans' ||
      lang === 'zh-hant') &&
    typeof model === 'string' &&
    (model === 'gpt-4o-transcribe' || model === 'gpt-4o-mini-transcribe')
  );
}

function isStatsGroupBy(value: string): value is StatsGroupBy {
  return value === 'day' || value === 'week' || value === 'month';
}

function getStatsGroupByPreference(): StatsGroupBy {
  const raw = localStorage.getItem(STATS_GROUP_BY_STORAGE_KEY) ?? '';
  if (isStatsGroupBy(raw)) return raw;
  return 'day';
}

function setStatsGroupByPreference(value: StatsGroupBy): void {
  localStorage.setItem(STATS_GROUP_BY_STORAGE_KEY, value);
}

function getStatsIncludeWaitTimePreference(): boolean {
  return localStorage.getItem(STATS_INCLUDE_WAIT_TIME_STORAGE_KEY) === '1';
}

function setStatsIncludeWaitTimePreference(value: boolean): void {
  localStorage.setItem(STATS_INCLUDE_WAIT_TIME_STORAGE_KEY, value ? '1' : '0');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatLocalYmd(timeMs: number): string {
  const d = new Date(timeMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatLocalYm(timeMs: number): string {
  const d = new Date(timeMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function startOfLocalDayMs(timeMs: number): number {
  const d = new Date(timeMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfLocalMonthMs(timeMs: number): number {
  const d = new Date(timeMs);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function startOfLocalWeekMondayMs(timeMs: number): number {
  const d = new Date(timeMs);
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  date.setDate(date.getDate() + diff);
  return date.getTime();
}

function formatCharsPerMinute(chars: number, seconds: number): string {
  if (!Number.isFinite(chars) || !Number.isFinite(seconds) || seconds <= 0) return '-';
  return ((chars * 60) / seconds).toFixed(1);
}

function formatMinutesSigned(minutes: number): string {
  if (!Number.isFinite(minutes)) return '-';
  return minutes.toFixed(2);
}

export function setupStatsUsage(opts: SetupStatsUsageOptions): StatsUsageApi {
  const els = opts.els;
  let didSetupEventListeners = false;
  let usageResetArmed = false;
  let usageResetArmTimer: number | null = null;
  let statsResetArmed = false;
  let statsResetArmTimer: number | null = null;

  const setUsageSummary = (message: string): void => {
    els.usageSummary.textContent = message;
  };

  const setUsageMeta = (message: string): void => {
    els.usageMeta.textContent = message;
  };

  const disarmUsageResetButton = (): void => {
    usageResetArmed = false;
    if (usageResetArmTimer !== null) {
      window.clearTimeout(usageResetArmTimer);
      usageResetArmTimer = null;
    }
    els.clearUsage.textContent = opts.tr('common.reset');
  };

  const armUsageResetButton = (): void => {
    usageResetArmed = true;
    els.clearUsage.textContent = opts.tr('common.resetConfirm');
    if (usageResetArmTimer !== null) {
      window.clearTimeout(usageResetArmTimer);
    }
    usageResetArmTimer = window.setTimeout(() => {
      usageResetArmTimer = null;
      disarmUsageResetButton();
    }, RESET_CONFIRM_TIMEOUT_MS);
  };

  const disarmStatsResetButton = (): void => {
    statsResetArmed = false;
    if (statsResetArmTimer !== null) {
      window.clearTimeout(statsResetArmTimer);
      statsResetArmTimer = null;
    }
    els.clearStats.textContent = opts.tr('common.reset');
  };

  const armStatsResetButton = (): void => {
    statsResetArmed = true;
    els.clearStats.textContent = opts.tr('common.resetConfirm');
    if (statsResetArmTimer !== null) {
      window.clearTimeout(statsResetArmTimer);
    }
    statsResetArmTimer = window.setTimeout(() => {
      statsResetArmTimer = null;
      disarmStatsResetButton();
    }, RESET_CONFIRM_TIMEOUT_MS);
  };

  const disarmResetButtons = (): void => {
    disarmUsageResetButton();
    disarmStatsResetButton();
  };

  const renderUsageTable = (audioSecondsByModel: Record<string, number>): void => {
    els.usageTable.replaceChildren();

    const inner = document.createElement('div');
    inner.className = 'avi-table-inner';

    const knownModels = USAGE_MODEL_ORDER;
    const knownSet = new Set(knownModels);
    const extraModels = Object.keys(audioSecondsByModel)
      .filter((model) => !knownSet.has(model))
      .sort((a, b) => a.localeCompare(b));
    const models = [...knownModels, ...extraModels];

    const table = document.createElement('table');
    table.className = 'avi-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const modelTh = document.createElement('th');
    modelTh.textContent = opts.tr('usage.table.model');
    headRow.appendChild(modelTh);

    const minutesTh = document.createElement('th');
    minutesTh.textContent = opts.tr('usage.table.minutes');
    headRow.appendChild(minutesTh);

    const rateTh = document.createElement('th');
    rateTh.textContent = opts.tr('usage.table.rate');
    headRow.appendChild(rateTh);

    const costTh = document.createElement('th');
    costTh.textContent = opts.tr('usage.table.estimatedCost');
    headRow.appendChild(costTh);

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    let totalMinutes = 0;
    let totalCost = 0;

    for (const model of models) {
      const seconds = audioSecondsByModel[model] ?? 0;
      const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : 0;
      const rate = USAGE_RATES_PER_MINUTE_USD[model];
      const cost = rate ? minutes * rate : 0;

      if (rate) {
        totalMinutes += minutes;
        totalCost += cost;
      }

      const tr = document.createElement('tr');

      const modelTd = document.createElement('td');
      modelTd.textContent = model;
      tr.appendChild(modelTd);

      const minutesTd = document.createElement('td');
      minutesTd.textContent = formatMinutes(seconds);
      tr.appendChild(minutesTd);

      const rateTd = document.createElement('td');
      rateTd.textContent = formatRatePerMinute(rate);
      tr.appendChild(rateTd);

      const costTd = document.createElement('td');
      costTd.textContent = rate ? formatUsd(cost) : '-';
      tr.appendChild(costTd);

      tbody.appendChild(tr);
    }

    const totalTr = document.createElement('tr');

    const totalLabelTd = document.createElement('td');
    totalLabelTd.textContent = opts.tr('common.total');
    totalTr.appendChild(totalLabelTd);

    const totalMinutesTd = document.createElement('td');
    totalMinutesTd.textContent = totalMinutes.toFixed(2);
    totalTr.appendChild(totalMinutesTd);

    const totalRateTd = document.createElement('td');
    totalRateTd.textContent = '';
    totalTr.appendChild(totalRateTd);

    const totalCostTd = document.createElement('td');
    totalCostTd.textContent = formatUsd(totalCost);
    totalTr.appendChild(totalCostTd);

    tbody.appendChild(totalTr);

    table.appendChild(tbody);
    inner.appendChild(table);
    els.usageTable.appendChild(inner);
  };

  const setStatsSummary = (message: string): void => {
    els.statsSummary.textContent = message;
  };

  const setStatsMeta = (message: string): void => {
    els.statsMeta.textContent = message;
  };

  const renderStatsTable = (
    rows: {
      label: string;
      segments: number;
      chars: number;
      audioSeconds: number;
      waitSeconds: number;
    }[]
  ): void => {
    els.statsTable.replaceChildren();

    const includeWaitTime = els.statsIncludeWaitTime.checked;

    const inner = document.createElement('div');
    inner.className = 'avi-table-inner';

    const table = document.createElement('table');
    table.className = 'avi-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const periodTh = document.createElement('th');
    periodTh.textContent = opts.tr('stats.table.period');
    headRow.appendChild(periodTh);

    const segmentsTh = document.createElement('th');
    segmentsTh.textContent = opts.tr('stats.table.segments');
    headRow.appendChild(segmentsTh);

    const charsTh = document.createElement('th');
    charsTh.textContent = opts.tr('stats.table.chars');
    headRow.appendChild(charsTh);

    const minutesTh = document.createElement('th');
    minutesTh.textContent = opts.tr('stats.table.minutes');
    headRow.appendChild(minutesTh);

    if (includeWaitTime) {
      const waitTh = document.createElement('th');
      waitTh.textContent = opts.tr('stats.table.waitMinutes');
      headRow.appendChild(waitTh);
    }

    const cpmTh = document.createElement('th');
    cpmTh.textContent = opts.tr('stats.table.cpm');
    headRow.appendChild(cpmTh);

    const keyboardCpm = opts.getKeyboardCharsPerMinute();
    if (keyboardCpm > 0) {
      const savedTh = document.createElement('th');
      savedTh.textContent = opts.tr('stats.table.savedMinutes');
      headRow.appendChild(savedTh);
    }

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    let totalSegments = 0;
    let totalChars = 0;
    let totalAudioSeconds = 0;
    let totalWaitSeconds = 0;

    for (const row of rows) {
      totalSegments += row.segments;
      totalChars += row.chars;
      totalAudioSeconds += row.audioSeconds;
      totalWaitSeconds += row.waitSeconds;

      const tr = document.createElement('tr');
      const secondsForRate = row.audioSeconds + (includeWaitTime ? row.waitSeconds : 0);

      const periodTd = document.createElement('td');
      periodTd.textContent = row.label;
      tr.appendChild(periodTd);

      const segmentsTd = document.createElement('td');
      segmentsTd.textContent = String(row.segments);
      tr.appendChild(segmentsTd);

      const charsTd = document.createElement('td');
      charsTd.textContent = String(row.chars);
      tr.appendChild(charsTd);

      const minutesTd = document.createElement('td');
      minutesTd.textContent = formatMinutes(row.audioSeconds);
      tr.appendChild(minutesTd);

      if (includeWaitTime) {
        const waitTd = document.createElement('td');
        waitTd.textContent = formatMinutes(row.waitSeconds);
        tr.appendChild(waitTd);
      }

      const cpmTd = document.createElement('td');
      cpmTd.textContent = formatCharsPerMinute(row.chars, secondsForRate);
      tr.appendChild(cpmTd);

      if (keyboardCpm > 0) {
        const typedMinutes = row.chars / keyboardCpm;
        const inputMinutes = secondsForRate / 60;
        const savedMinutes = typedMinutes - inputMinutes;
        const savedTd = document.createElement('td');
        savedTd.textContent = formatMinutesSigned(savedMinutes);
        tr.appendChild(savedTd);
      }

      tbody.appendChild(tr);
    }

    const totalTr = document.createElement('tr');

    const totalLabelTd = document.createElement('td');
    totalLabelTd.textContent = opts.tr('common.total');
    totalTr.appendChild(totalLabelTd);

    const totalSegmentsTd = document.createElement('td');
    totalSegmentsTd.textContent = String(totalSegments);
    totalTr.appendChild(totalSegmentsTd);

    const totalCharsTd = document.createElement('td');
    totalCharsTd.textContent = String(totalChars);
    totalTr.appendChild(totalCharsTd);

    const totalMinutesTd = document.createElement('td');
    totalMinutesTd.textContent = formatMinutes(totalAudioSeconds);
    totalTr.appendChild(totalMinutesTd);

    if (includeWaitTime) {
      const totalWaitTd = document.createElement('td');
      totalWaitTd.textContent = formatMinutes(totalWaitSeconds);
      totalTr.appendChild(totalWaitTd);
    }

    const totalSecondsForRate = totalAudioSeconds + (includeWaitTime ? totalWaitSeconds : 0);

    const totalCpmTd = document.createElement('td');
    totalCpmTd.textContent = formatCharsPerMinute(totalChars, totalSecondsForRate);
    totalTr.appendChild(totalCpmTd);

    if (keyboardCpm > 0) {
      const typedMinutes = totalChars / keyboardCpm;
      const inputMinutes = totalSecondsForRate / 60;
      const savedMinutes = typedMinutes - inputMinutes;
      const totalSavedTd = document.createElement('td');
      totalSavedTd.textContent = formatMinutesSigned(savedMinutes);
      totalTr.appendChild(totalSavedTd);
    }

    tbody.appendChild(totalTr);
    table.appendChild(tbody);
    inner.appendChild(table);
    els.statsTable.appendChild(inner);
  };

  const refreshStats = async (): Promise<void> => {
    setStatsSummary(opts.tr('common.loading'));
    setStatsMeta('');
    const res = await window.voiceInput.getStats();
    if (!res.ok) {
      setStatsSummary(formatApiError(opts.getUiLanguage(), res, 'stats.error.failedToLoad'));
      setStatsMeta('');
      renderStatsTable([]);
      return;
    }
    const entries = Array.isArray(res.entries) ? res.entries : [];
    const statsEntries = entries.filter(isStatsEntry).sort((a, b) => b.endedAt - a.endedAt);
    if (typeof res.sinceAt === 'number') {
      setStatsMeta(opts.tr('stats.meta.sinceLastReset', { timestamp: formatTimestamp(res.sinceAt) }));
    } else {
      setStatsMeta(opts.tr('stats.meta.sinceLastResetEmpty'));
    }

    const groupBy = getStatsGroupByPreference();
    if (els.statsGroupBy.value !== groupBy) els.statsGroupBy.value = groupBy;

    const grouped = new Map<
      string,
      { startMs: number; label: string; segments: number; chars: number; audioSeconds: number; waitSeconds: number }
    >();
    for (const entry of statsEntries) {
      const endedAt = entry.endedAt;
      let startMs = 0;
      let label = '';
      if (groupBy === 'day') {
        startMs = startOfLocalDayMs(endedAt);
        label = formatLocalYmd(startMs);
      } else if (groupBy === 'month') {
        startMs = startOfLocalMonthMs(endedAt);
        label = formatLocalYm(startMs);
      } else {
        startMs = startOfLocalWeekMondayMs(endedAt);
        label = formatLocalYmd(startMs);
      }

      const key = `${groupBy}:${label}`;
      const existing = grouped.get(key) ?? { startMs, label, segments: 0, chars: 0, audioSeconds: 0, waitSeconds: 0 };
      existing.segments += 1;
      existing.chars += entry.charCount;
      existing.audioSeconds += entry.durationSeconds;
      existing.waitSeconds += typeof entry.waitSeconds === 'number' ? entry.waitSeconds : 0;
      grouped.set(key, existing);
    }

    const rows = Array.from(grouped.values()).sort((a, b) => b.startMs - a.startMs);
    renderStatsTable(rows);

    if (statsEntries.length === 0) {
      setStatsSummary(opts.tr('stats.summary.noStats'));
      return;
    }
    setStatsSummary('');
  };

  const refreshUsage = async (): Promise<void> => {
    setUsageSummary(opts.tr('common.loading'));
    setUsageMeta('');
    const res = await window.voiceInput.getUsage();
    if (!res.ok) {
      setUsageSummary(formatApiError(opts.getUiLanguage(), res, 'usage.error.failedToLoad'));
      setUsageMeta('');
      renderUsageTable({});
      return;
    }
    const audioSecondsByModel = res.audioSecondsByModel ?? {};
    if (typeof res.sinceAt === 'number') {
      setUsageMeta(opts.tr('usage.meta.sinceLastReset', { timestamp: formatTimestamp(res.sinceAt) }));
    } else {
      setUsageMeta(opts.tr('usage.meta.sinceLastResetEmpty'));
    }
    renderUsageTable(audioSecondsByModel);
    const anyUsage = Object.values(audioSecondsByModel).some((v) => Number.isFinite(v) && v > 0);
    setUsageSummary(anyUsage ? '' : opts.tr('usage.summary.noUsage'));
  };

  const syncStatsControlsFromPreferences = (): void => {
    els.statsGroupBy.value = getStatsGroupByPreference();
    els.statsIncludeWaitTime.checked = getStatsIncludeWaitTimePreference();
  };

  const setupEventListeners = (): void => {
    if (didSetupEventListeners) return;
    didSetupEventListeners = true;

    els.statsIncludeWaitTime.addEventListener('change', () => {
      setStatsIncludeWaitTimePreference(els.statsIncludeWaitTime.checked);
      if (opts.getActivePage() === 'stats') {
        void refreshStats();
      }
    });

    els.statsGroupBy.addEventListener('change', () => {
      const raw = els.statsGroupBy.value;
      if (!isStatsGroupBy(raw)) return;
      setStatsGroupByPreference(raw);
      if (opts.getActivePage() === 'stats') {
        void refreshStats();
      }
    });

    els.clearUsage.addEventListener(
      'click',
      voidAsync(async () => {
        if (!usageResetArmed) {
          armUsageResetButton();
          return;
        }
        disarmUsageResetButton();

        const ok = window.confirm(opts.tr('usage.confirm.reset'));
        if (!ok) return;
        const res = await window.voiceInput.clearUsage();
        if (!res.ok) {
          window.alert(formatApiError(opts.getUiLanguage(), res, 'usage.error.failedToReset'));
          return;
        }
        await refreshUsage();
      })
    );

    els.clearStats.addEventListener(
      'click',
      voidAsync(async () => {
        if (!statsResetArmed) {
          armStatsResetButton();
          return;
        }
        disarmStatsResetButton();

        const ok = window.confirm(opts.tr('stats.confirm.reset'));
        if (!ok) return;
        const res = await window.voiceInput.clearStats();
        if (!res.ok) {
          window.alert(formatApiError(opts.getUiLanguage(), res, 'stats.error.failedToReset'));
          return;
        }
        if (opts.getActivePage() === 'stats') {
          await refreshStats();
        }
      })
    );
  };

  return {
    syncStatsControlsFromPreferences,
    setupEventListeners,
    disarmResetButtons,
    refreshStats,
    refreshUsage
  };
}
