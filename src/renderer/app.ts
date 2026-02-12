import { initDictionaryAdd } from './dictionaryAdd';
import { initHistory } from './history';
import { initMemo } from './memo';
import { initOverlay } from './overlay';
import { initPreferences } from './renderer';

function getCurrentHtmlFileName(): string {
  const raw = window.location.pathname || '';
  const last = raw.split('/').pop() || '';
  try {
    return decodeURIComponent(last).toLowerCase();
  } catch {
    return last.toLowerCase();
  }
}

async function init(): Promise<void> {
  const fileName = getCurrentHtmlFileName() || 'index.html';
  switch (fileName) {
    case 'history.html':
      await initHistory();
      return;
    case 'memo.html':
      await initMemo();
      return;
    case 'dictionaryadd.html':
      await initDictionaryAdd();
      return;
    case 'overlay.html':
      initOverlay();
      return;
    default:
      await initPreferences();
  }
}

void init();
