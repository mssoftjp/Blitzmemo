import crypto from 'node:crypto';
import { buildTranscriptionPrompt, getTranscriptionPromptConstants } from '../shared/i18n';
import { SilenceProcessingMode, TranscriptionLanguage, TranscriptionModel } from '../shared/types';
import { extractErrorMessage, requestTextWithElectronNet } from './openaiClient';

const TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

const MIN_PARTIAL_PROMPT_LEAK_LENGTH = 6;

function normalizeAudioMimeType(value: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const base = trimmed.split(';')[0]?.trim().toLowerCase() ?? '';
  return base;
}

function getAudioUploadMeta(mimeType: string): { mimeType: string; fileName: string } {
  const normalized = normalizeAudioMimeType(mimeType);
  if (normalized.includes('ogg')) return { mimeType: normalized || 'audio/ogg', fileName: 'audio.ogg' };
  if (normalized.includes('webm')) return { mimeType: normalized || 'audio/webm', fileName: 'audio.webm' };
  if (normalized.includes('wav')) return { mimeType: normalized || 'audio/wav', fileName: 'audio.wav' };
  if (normalized.includes('mpeg') || normalized.includes('mp3') || normalized.includes('mpga')) {
    return { mimeType: normalized || 'audio/mpeg', fileName: 'audio.mp3' };
  }
  if (normalized.includes('mp4') || normalized.includes('m4a')) return { mimeType: normalized || 'audio/mp4', fileName: 'audio.m4a' };
  return { mimeType: normalized || 'audio/webm', fileName: 'audio.webm' };
}

function normalizePromptLeakLine(text: string): string {
  return text.replace(/[()（）]/g, '').replace(/[.。!?！:：]+$/g, '').trim();
}

function getNormalizedPromptLeakLines(language: TranscriptionLanguage): string[] {
  const c = getTranscriptionPromptConstants(language);
  return [
    normalizePromptLeakLine(c.instruction1),
    normalizePromptLeakLine(c.instruction2),
    normalizePromptLeakLine(c.instruction3),
    normalizePromptLeakLine(c.outputFormat),
    normalizePromptLeakLine(c.speakerOnly)
  ].filter(Boolean);
}

function isLikelyPromptLeakLine(normalizedLine: string, normalizedPromptLines: string[]): boolean {
  if (!normalizedLine) return false;
  if (normalizedPromptLines.includes(normalizedLine)) return true;
  if (normalizedLine.length < MIN_PARTIAL_PROMPT_LEAK_LENGTH) return false;
  return normalizedPromptLines.some((promptLine) => promptLine.includes(normalizedLine));
}

function preStripTranscriptWrappers(text: string): string {
  let result = text;
  const completeMatch = result.match(/<TRANSCRIPT[^>]*>\s*([\s\S]*?)\s*<\/TRANSCRIPT>/i);
  if (completeMatch) {
    result = completeMatch[1] ?? '';
  } else {
    const openingMatch = result.match(/<TRANSCRIPT[^>]*>\s*([\s\S]*)/i);
    if (openingMatch) {
      result = openingMatch[1] ?? '';
    }
  }
  result = result.replace(/<\/?TRANSCRIPT[^>]*>/gi, '');
  result = result.replace(/<\/?transcription[^>]*>/gi, '');
  return result;
}

function shouldCleanLine(index: number, totalLines: number, lines: string[]): boolean {
  if (index < 3) return true;
  if (index > 0 && index < totalLines) {
    const previous = lines[index - 1]?.trim() ?? '';
    if (previous === '<TRANSCRIPT>' || previous.includes('<TRANSCRIPT>')) return true;
  }
  return false;
}

function stripPromptContamination(text: string, language: TranscriptionLanguage): string {
  const c = getTranscriptionPromptConstants(language);
  const normalizedPromptLines = getNormalizedPromptLeakLines(language);
  const speakerOnlyPlain = normalizePromptLeakLine(c.speakerOnly);
  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const normalizedTrimmed = normalizePromptLeakLine(trimmed);

    if (shouldCleanLine(index, lines.length, lines) && isLikelyPromptLeakLine(normalizedTrimmed, normalizedPromptLines)) {
      continue;
    }

    let cleanedLine = line;
    if (shouldCleanLine(index, lines.length, lines)) {
      cleanedLine = cleanedLine.replaceAll(c.speakerOnly, '');
      if (speakerOnlyPlain) {
        cleanedLine = cleanedLine.replaceAll(speakerOnlyPlain, '');
      }
    }
    cleaned.push(cleanedLine);
  }

  return cleaned.join('\n');
}

function stripPromptLeakLines(text: string, language: TranscriptionLanguage): string {
  const normalizedPromptLines = getNormalizedPromptLeakLines(language);
  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const normalizedTrimmed = normalizePromptLeakLine(trimmed);
    if (isLikelyPromptLeakLine(normalizedTrimmed, normalizedPromptLines)) continue;
    cleaned.push(line);
  }

  return cleaned.join('\n');
}

function cleanTranscriptionText(rawText: string, language: TranscriptionLanguage): string {
  let text = preStripTranscriptWrappers(rawText);
  text = stripPromptContamination(text, language);
  text = stripPromptLeakLines(text, language);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return '';
  return text;
}

function extractTextFromResponse(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const obj = response as Record<string, unknown>;
  const text = obj.text;
  if (typeof text === 'string') return text;
  return '';
}

function toOpenAiTranscriptionLanguage(language: TranscriptionLanguage): string {
  if (language === 'zh-hans' || language === 'zh-hant') return 'zh';
  return language;
}

export async function transcribeWithOpenAI(opts: {
  apiKey: string;
  audioData: ArrayBuffer;
  mimeType: string;
  model: TranscriptionModel;
  language: TranscriptionLanguage;
  silenceProcessingMode?: SilenceProcessingMode;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const uploadMeta = getAudioUploadMeta(opts.mimeType || 'audio/webm');
  const boundary = `blitzmemo-${crypto.randomBytes(16).toString('hex')}`;
  const parts: Buffer[] = [];

  const pushText = (text: string) => {
    parts.push(Buffer.from(text, 'utf-8'));
  };

  const pushField = (name: string, value: string) => {
    pushText(`--${boundary}\r\n`);
    pushText(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    pushText(`${value}\r\n`);
  };

  // user-note: On some platforms MediaRecorder falls back to OGG. Always align the upload filename/Content-Type
  // with the actual MIME type to avoid OpenAI rejecting the file as an unsupported format.
  pushText(`--${boundary}\r\n`);
  pushText(`Content-Disposition: form-data; name="file"; filename="${uploadMeta.fileName}"\r\n`);
  pushText(`Content-Type: ${uploadMeta.mimeType}\r\n\r\n`);
  parts.push(Buffer.from(opts.audioData));
  pushText('\r\n');

  pushField('model', opts.model);
  pushField('response_format', 'json');
  pushField('temperature', '0');
  pushField('language', toOpenAiTranscriptionLanguage(opts.language));

  if (opts.silenceProcessingMode === 'server') {
    pushField('chunking_strategy', 'auto');
  }

  const prompt = buildTranscriptionPrompt(opts.language);
  if (prompt) {
    // IMPORTANT: Sending a per-language prompt with the audio is a core quality mechanism
    // (format control via <TRANSCRIPT>...</TRANSCRIPT> + reduced instruction leakage).
    // Do not remove unless replaced with an equivalent mechanism and verified across languages.
    pushField('prompt', prompt);
  }

  pushText(`--${boundary}--\r\n`);

  const res = await requestTextWithElectronNet({
    url: TRANSCRIPTION_ENDPOINT,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    bodyParts: parts,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs
  });

  const json = (() => {
    try {
      return res.bodyText ? (JSON.parse(res.bodyText) as unknown) : null;
    } catch {
      return null;
    }
  })();
  if (res.status < 200 || res.status >= 300) {
    const message = extractErrorMessage(json);
    const suffixRaw = message && message !== 'Request failed' ? message : res.bodyText.trim();
    const suffix = suffixRaw.length > 400 ? `${suffixRaw.slice(0, 400).trimEnd()}…` : suffixRaw;
    const detail = suffix ? `: ${suffix}` : '';
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  const rawText = extractTextFromResponse(json);
  return cleanTranscriptionText(rawText, opts.language);
}
