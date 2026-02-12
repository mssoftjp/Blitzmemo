import { TranscriptionLanguage } from '../shared/types';
import { extractChatCompletionText, extractErrorMessage, requestTextWithElectronNet } from './openaiClient';

const CHAT_COMPLETIONS_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TRANSLATION_MODEL = 'gpt-4.1-mini';

const LANGUAGE_LABELS: Record<TranscriptionLanguage, string> = {
  ja: 'Japanese',
  en: 'English',
  es: 'Spanish',
  it: 'Italian',
  de: 'German',
  pt: 'Portuguese',
  pl: 'Polish',
  id: 'Indonesian',
  fr: 'French',
  ru: 'Russian',
  vi: 'Vietnamese',
  nl: 'Dutch',
  uk: 'Ukrainian',
  ko: 'Korean',
  ro: 'Romanian',
  ms: 'Malay',
  tr: 'Turkish',
  th: 'Thai',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  'zh-hans': 'Chinese (Simplified)',
  'zh-hant': 'Chinese (Traditional)'
};

async function requestTranslationWithOpenAI(opts: {
  apiKey: string;
  payload: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const bodyText = JSON.stringify(opts.payload);
  const res = await requestTextWithElectronNet({
    url: CHAT_COMPLETIONS_ENDPOINT,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json'
    },
    bodyParts: [Buffer.from(bodyText, 'utf-8')],
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
  return extractChatCompletionText(json).trim();
}

export async function translateWithOpenAI(opts: {
  apiKey: string;
  inputText: string;
  sourceLanguage: TranscriptionLanguage;
  targetLanguage: TranscriptionLanguage;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const sourceLabel = LANGUAGE_LABELS[opts.sourceLanguage];
  const targetLabel = LANGUAGE_LABELS[opts.targetLanguage];

  const payload = {
    model: TRANSLATION_MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a professional translator. Translate the given text faithfully while preserving line breaks and punctuation. Output only the translated text.'
      },
      {
        role: 'user',
        content: `Source language: ${sourceLabel}\nTarget language: ${targetLabel}\n\nText:\n${opts.inputText}`
      }
    ]
  };

  return await requestTranslationWithOpenAI({
    apiKey: opts.apiKey,
    payload,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs
  });
}

export async function translateWithOpenAIAutoDetectSource(opts: {
  apiKey: string;
  inputText: string;
  targetLanguage: TranscriptionLanguage;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const targetLabel = LANGUAGE_LABELS[opts.targetLanguage];

  const payload = {
    model: TRANSLATION_MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a professional translator. Translate the given text into the target language while preserving line breaks and punctuation. The source language may be any language and should be detected automatically. If the text is already in the target language, output it unchanged. Output only the resulting text.'
      },
      {
        role: 'user',
        content: `Target language: ${targetLabel}\n\nText:\n${opts.inputText}`
      }
    ]
  };

  return await requestTranslationWithOpenAI({
    apiKey: opts.apiKey,
    payload,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs
  });
}
