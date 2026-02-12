import type { AboutInfo } from '../voiceInputApi';
import type { UiStringKey } from '../../shared/i18n';

type AboutElements = {
  aboutVersion: HTMLDivElement;
  aboutCheckUpdates: HTMLButtonElement;
  aboutCopyright: HTMLDivElement;
  aboutGithubLink: HTMLAnchorElement;
  aboutWebsiteLink: HTMLAnchorElement;
  aboutAuthorWebsiteLink: HTMLAnchorElement;
  aboutDonationLink: HTMLAnchorElement;
};

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type SetupAboutSectionOptions = {
  els: AboutElements;
  tr: Translator;
};

export type AboutSection = {
  refreshAbout: () => Promise<void>;
  setupExternalLinkHandlers: () => void;
  setupUpdateCheckHandler: () => void;
};

const AUTHOR_WEBSITE_URL = 'https://ms-soft.jp';
const DONATION_URL = 'https://buymeacoffee.com/mssoft';

function voidAsync<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    fn(...args).catch((error) => {
      console.error(error);
    });
  };
}

function normalizeAboutInfo(value: unknown): AboutInfo | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const appVersion = typeof obj.appVersion === 'string' ? obj.appVersion.trim() : '';
  const electron = typeof obj.electron === 'string' ? obj.electron.trim() : '';
  const chromium = typeof obj.chromium === 'string' ? obj.chromium.trim() : '';
  const node = typeof obj.node === 'string' ? obj.node.trim() : '';
  const v8 = typeof obj.v8 === 'string' ? obj.v8.trim() : '';
  const os = typeof obj.os === 'string' ? obj.os.trim() : '';
  const copyright = typeof obj.copyright === 'string' ? obj.copyright.trim() : '';
  const githubUrl = typeof obj.githubUrl === 'string' ? obj.githubUrl.trim() : '';
  const websiteUrl = typeof obj.websiteUrl === 'string' ? obj.websiteUrl.trim() : '';
  const privacyPolicyUrl = typeof obj.privacyPolicyUrl === 'string' ? obj.privacyPolicyUrl.trim() : '';
  const lastUpdateCheckAtRaw = obj.lastUpdateCheckAt;
  const lastUpdateCheckAt =
    typeof lastUpdateCheckAtRaw === 'number' && Number.isFinite(lastUpdateCheckAtRaw) ? lastUpdateCheckAtRaw : null;
  if (!copyright || !githubUrl || !websiteUrl) {
    return null;
  }
  return {
    appVersion,
    electron,
    chromium,
    node,
    v8,
    os,
    copyright,
    githubUrl,
    websiteUrl,
    privacyPolicyUrl,
    lastUpdateCheckAt
  };
}

function applyAboutInfo(els: AboutElements, info: AboutInfo): void {
  els.aboutVersion.textContent = info.appVersion;
  els.aboutCopyright.textContent = info.copyright;
  els.aboutGithubLink.href = info.githubUrl;
  els.aboutGithubLink.textContent = info.githubUrl;
  els.aboutWebsiteLink.href = info.websiteUrl;
  els.aboutWebsiteLink.textContent = info.websiteUrl;
}

function applyFixedLinks(els: AboutElements): void {
  els.aboutAuthorWebsiteLink.href = AUTHOR_WEBSITE_URL;
  els.aboutAuthorWebsiteLink.textContent = AUTHOR_WEBSITE_URL;
  els.aboutDonationLink.href = DONATION_URL;
  els.aboutDonationLink.textContent = DONATION_URL;
}

export function setupAboutSection(opts: SetupAboutSectionOptions): AboutSection {
  const { els, tr } = opts;

  const refreshAbout = async (): Promise<void> => {
    try {
      // user-note: Do not apply these at setup time because this module is instantiated during app.js evaluation,
      // even in non-preferences windows (e.g. memo/history) where the About DOM is not present.
      applyFixedLinks(els);
      const res = await window.voiceInput.getAboutInfo();
      if (!res.ok) return;
      const info = normalizeAboutInfo(res.info);
      if (!info) return;
      applyAboutInfo(els, info);
    } catch {
      // ignore
    }
  };

  const setupExternalLinkHandlers = (): void => {
    applyFixedLinks(els);

    const setupLink = (el: HTMLAnchorElement): void => {
      el.addEventListener(
        'click',
        voidAsync(async (event) => {
          event.preventDefault();
          const url = el.href ?? '';
          const res = await window.voiceInput.openExternal(url);
          if (!res.ok) {
            window.alert(res.error || tr('common.failed'));
          }
        })
      );
    };

    setupLink(els.aboutGithubLink);
    setupLink(els.aboutWebsiteLink);
    setupLink(els.aboutAuthorWebsiteLink);
    setupLink(els.aboutDonationLink);
  };

  const setupUpdateCheckHandler = (): void => {
    els.aboutCheckUpdates.addEventListener(
      'click',
      voidAsync(async () => {
        els.aboutCheckUpdates.disabled = true;
        try {
          const res = await window.voiceInput.checkForUpdates();
          if (!res.ok) {
            window.alert(res.error || tr('prefs.about.updateCheck.failed'));
            return;
          }

          const currentVersion = res.currentVersion || tr('common.unknown');
          const latestVersion = res.latestVersion || tr('common.unknown');

          if (res.status === 'updateAvailable') {
            const confirmed = window.confirm(
              tr('prefs.about.updateCheck.updateAvailable.confirm', { currentVersion, latestVersion })
            );
            if (!confirmed) return;
            const openRes = await window.voiceInput.openExternal(res.latestUrl);
            if (!openRes.ok) {
              window.alert(openRes.error || tr('common.failed'));
            }
            return;
          }

          if (res.status === 'upToDate') {
            window.alert(tr('prefs.about.updateCheck.upToDate', { currentVersion, latestVersion }));
            return;
          }

          window.alert(tr('prefs.about.updateCheck.cannotCompare', { currentVersion, latestVersion }));
        } finally {
          els.aboutCheckUpdates.disabled = false;
        }
      })
    );
  };

  return { refreshAbout, setupExternalLinkHandlers, setupUpdateCheckHandler };
}
