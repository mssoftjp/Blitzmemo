import { net } from 'electron';

const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;

type AbortControllerWithCleanup = {
  controller: AbortController;
  cleanup: () => void;
};

export function createAbortControllerWithTimeout(opts: {
  timeoutMs?: number;
  signal?: AbortSignal;
}): AbortControllerWithCleanup {
  const controller = new AbortController();
  const timeoutMsRaw = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(MIN_TIMEOUT_MS, Math.floor(timeoutMsRaw)) : DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = opts.signal;
  const onAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onAbort);
  };

  return { controller, cleanup };
}

export function extractChatCompletionText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const obj = response as Record<string, unknown>;
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first: unknown = (choices as unknown[])[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== 'string') return '';
  return content;
}

export function extractErrorMessage(response: unknown): string {
  if (!response || typeof response !== 'object') return 'Request failed';
  const obj = response as Record<string, unknown>;
  const error = obj.error;
  if (error && typeof error === 'object') {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }
  return 'Request failed';
}

export type ElectronNetTextResponse = {
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  bodyText: string;
};

export async function requestTextWithElectronNet(opts: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  bodyParts?: Buffer[];
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ElectronNetTextResponse> {
  const { controller, cleanup } = createAbortControllerWithTimeout({
    timeoutMs: opts.timeoutMs,
    signal: opts.signal
  });

  const requestSignal = controller.signal;

  try {
    return await new Promise<ElectronNetTextResponse>((resolve, reject) => {
      let settled = false;
      let req: Electron.ClientRequest | null = null;

      const abortRequest = () => {
        if (!req) return;
        try {
          req.abort();
        } catch {
          // ignore
        }
      };

      const cleanupListeners = () => {
        requestSignal.removeEventListener('abort', onAbort);
      };

      const finishOk = (value: ElectronNetTextResponse) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        resolve(value);
      };

      const finishErr = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        reject(error);
      };

      const onAbort = () => {
        abortRequest();
        finishErr(new Error('Request aborted'));
      };

      try {
        req = net.request({ method: opts.method, url: opts.url });
      } catch (error) {
        finishErr(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      requestSignal.addEventListener('abort', onAbort, { once: true });

      req.on('error', (error) => {
        finishErr(error);
      });

      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('error', (error) => {
          finishErr(error);
        });
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf-8');
          finishOk({
            status: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? '',
            headers: res.headers,
            bodyText
          });
        });
      });

      for (const [key, value] of Object.entries(opts.headers ?? {})) {
        if (!value) continue;
        try {
          req.setHeader(key, value);
        } catch {
          // ignore
        }
      }

      // user-note: Electron's net.request restricts setting `Content-Length` manually.
      // Prefer streaming via chunked encoding when a request body is present.
      if ((opts.bodyParts?.length ?? 0) > 0) {
        try {
          req.chunkedEncoding = true;
        } catch {
          // ignore
        }
      }

      if (requestSignal.aborted) {
        onAbort();
        return;
      }

      for (const part of opts.bodyParts ?? []) {
        try {
          req.write(part);
        } catch (error) {
          finishErr(error instanceof Error ? error : new Error(String(error)));
          return;
        }
      }

      try {
        req.end();
      } catch (error) {
        finishErr(error instanceof Error ? error : new Error(String(error)));
      }
    });
  } finally {
    cleanup();
  }
}
