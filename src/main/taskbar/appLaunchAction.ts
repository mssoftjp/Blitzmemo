export const APP_LAUNCH_ACTION_FLAG = '--blitzmemo-action';

export type AppLaunchAction =
  | 'toggle-recording'
  | 'cancel-recording'
  | 'open-memo-pad'
  | 'open-history'
  | 'open-preferences'
  | 'quit';

const APP_LAUNCH_ACTIONS = new Set<AppLaunchAction>([
  'toggle-recording',
  'cancel-recording',
  'open-memo-pad',
  'open-history',
  'open-preferences',
  'quit'
]);

export function getArgvForAppLaunchAction(action: AppLaunchAction): string {
  return `${APP_LAUNCH_ACTION_FLAG}=${action}`;
}

export function parseAppLaunchActionFromArgv(argv: string[]): AppLaunchAction | null {
  let raw: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === APP_LAUNCH_ACTION_FLAG) {
      raw = argv[i + 1] ?? null;
      break;
    }
    if (arg.startsWith(`${APP_LAUNCH_ACTION_FLAG}=`)) {
      raw = arg.slice(`${APP_LAUNCH_ACTION_FLAG}=`.length);
      break;
    }
  }

  if (!raw) return null;
  const normalized = raw.trim();
  if (!normalized) return null;
  if (!APP_LAUNCH_ACTIONS.has(normalized as AppLaunchAction)) return null;
  return normalized as AppLaunchAction;
}

