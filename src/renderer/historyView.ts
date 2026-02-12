import type { HistoryEntry, UiLanguage } from '../shared/types';
import { getTranscriptionLanguageLabel } from '../shared/i18n';

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.createdAt === 'number' &&
    typeof obj.language === 'string' &&
    typeof obj.model === 'string' &&
    typeof obj.transcript === 'string' &&
    typeof obj.text === 'string' &&
    typeof obj.translated === 'boolean'
  );
}

export function formatTimestamp(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function renderHistoryList(opts: {
  container: HTMLElement;
  entries: HistoryEntry[];
  emptyMessage: string;
  copyLabel?: string;
  deleteLabel?: string;
  uiLanguage?: UiLanguage;
  onItemClick?: (entry: HistoryEntry) => void;
  onDeleteClick?: (entry: HistoryEntry) => void;
}): void {
  const inner = document.createElement('div');
  inner.className = 'avi-history-inner';
  opts.container.replaceChildren(inner);

  if (opts.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'avi-help';
    empty.textContent = opts.emptyMessage;
    inner.appendChild(empty);
    return;
  }

  for (const entry of opts.entries) {
    const row = document.createElement('div');
    row.className = 'avi-history-item';

    const main =
      typeof opts.onItemClick === 'function'
        ? document.createElement('button')
        : document.createElement('div');
    if (main instanceof HTMLButtonElement) {
      main.type = 'button';
    } else {
      main.classList.add('avi-history-main-static');
    }
    main.classList.add('avi-history-main');

    const title = document.createElement('div');
    title.className = 'avi-history-title';
    title.textContent = entry.text.replace(/\s+/g, ' ').slice(0, 140);

    const meta = document.createElement('div');
    meta.className = 'avi-history-meta';
    const uiLanguage = opts.uiLanguage ?? 'en';
    const translatePart =
      entry.translated && entry.translationTarget
        ? ` • → ${getTranscriptionLanguageLabel(uiLanguage, entry.translationTarget)}`
        : '';
    meta.textContent = `${formatTimestamp(entry.createdAt)} • ${getTranscriptionLanguageLabel(uiLanguage, entry.language)}${translatePart}`;

    main.appendChild(title);
    main.appendChild(meta);
    if (typeof opts.onItemClick === 'function') {
      main.addEventListener('click', () => {
        opts.onItemClick?.(entry);
      });
    }

    const copyLabel = opts.copyLabel ?? 'Copy';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'avi-button avi-button-secondary avi-button-icon';
    copyButton.title = copyLabel;
    copyButton.setAttribute('aria-label', copyLabel);
    copyButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
      </svg>
    `;
    copyButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void navigator.clipboard.writeText(entry.text);
    });

    const deleteLabel = opts.deleteLabel ?? 'Delete';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'avi-button avi-button-danger avi-button-icon';
    deleteButton.title = deleteLabel;
    deleteButton.setAttribute('aria-label', deleteLabel);
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h18"></path>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
      </svg>
    `;
    if (typeof opts.onDeleteClick === 'function') {
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onDeleteClick?.(entry);
      });
    } else {
      deleteButton.disabled = true;
    }

    row.appendChild(main);
    row.appendChild(copyButton);
    row.appendChild(deleteButton);
    inner.appendChild(row);
  }
}
