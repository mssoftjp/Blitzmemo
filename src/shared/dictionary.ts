import { t } from './i18n';

// user-note: Dictionary rules now support "protect" entries to prevent replacements inside specific phrases.
// This is to support cases like "テキスト -> テクスト" while keeping "テキストエディタ" unchanged.

export type DictionaryReplaceRule = {
  type: 'replace';
  from: string[];
  to: string;
};

export type DictionaryProtectRule = {
  type: 'protect';
  from: string[];
};

export type DictionaryRule = DictionaryReplaceRule | DictionaryProtectRule;

export type DictionaryParseResult = {
  rules: DictionaryRule[];
  errors: string[];
};

export type DictionaryValidateResult = { ok: true } | { ok: false; errors: string[] };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseDictionaryRules(text: string): DictionaryParseResult {
  const rules: DictionaryRule[] = [];
  const errors: string[] = [];

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const protectMatch = line.match(/^protect\s*:\s*(.+)$/i);
    if (protectMatch) {
      const fromRaw = (protectMatch[1] ?? '').trim();
      if (!fromRaw) {
        errors.push(t('en', 'dictionary.detail.parse.emptyProtectPatterns', { line: index + 1 }));
        continue;
      }

      const from = fromRaw
        .split(/[|,]/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (from.length === 0) {
        errors.push(t('en', 'dictionary.detail.parse.emptyProtectPatterns', { line: index + 1 }));
        continue;
      }

      rules.push({ type: 'protect', from });
      continue;
    }

    const replaceMatch = line.match(/^(.+?)(?:->|=>|→)(.*)$/);
    if (!replaceMatch) {
      errors.push(t('en', 'dictionary.detail.parse.expectedFromTo', { line: index + 1 }));
      continue;
    }

    const fromRaw = (replaceMatch[1] ?? '').trim();
    const to = (replaceMatch[2] ?? '').trim();
    if (!fromRaw || !to) {
      // spec-note: We currently treat "from ->" as invalid to avoid silent mistakes.
      // If you'd like "from ->" to mean "protect", we can change this behavior.
      errors.push(t('en', 'dictionary.detail.parse.emptyFromOrTo', { line: index + 1 }));
      continue;
    }

    const from = fromRaw
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (from.length === 0) {
      errors.push(t('en', 'dictionary.detail.parse.emptyFromPatterns', { line: index + 1 }));
      continue;
    }

    rules.push({ type: 'replace', from, to });
  }

  return { rules, errors };
}

export function validateDictionaryRules(rules: DictionaryRule[]): DictionaryValidateResult {
  const errors: string[] = [];
  const seenReplace = new Map<string, { to: string; ruleIndex: number }>();
  const seenProtect = new Map<string, { ruleIndex: number }>();

  for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
    const rule = rules[ruleIndex];
    const kind = rule?.type;
    const patterns = Array.isArray(rule?.from) ? rule.from : [];

    const localSeen = new Set<string>();
    for (const pattern of patterns) {
      const normalized = String(pattern ?? '');
      if (!normalized) continue;
      if (localSeen.has(normalized)) continue;
      localSeen.add(normalized);

      if (kind === 'protect') {
        const prevProtect = seenProtect.get(normalized);
        if (prevProtect && prevProtect.ruleIndex !== ruleIndex) {
          errors.push(
            t('en', 'dictionary.detail.validate.duplicatePattern', {
              pattern: normalized,
              row1: prevProtect.ruleIndex + 1,
              row2: ruleIndex + 1
            })
          );
          continue;
        }

        const prevReplace = seenReplace.get(normalized);
        if (prevReplace && prevReplace.ruleIndex !== ruleIndex) {
          // spec-note: We currently treat exact conflicts as invalid rules.
          // If you want "protect" to override an identical replace rule, we can relax this validation.
          errors.push(
            t('en', 'dictionary.detail.validate.conflictingProtectPattern', {
              pattern: normalized,
              protectRow: ruleIndex + 1,
              replaceRow: prevReplace.ruleIndex + 1,
              replaceTo: prevReplace.to
            })
          );
          continue;
        }

        seenProtect.set(normalized, { ruleIndex });
        continue;
      }

      const to = String(rule.to ?? '');
      const prevProtect = seenProtect.get(normalized);
      if (prevProtect && prevProtect.ruleIndex !== ruleIndex) {
        errors.push(
          t('en', 'dictionary.detail.validate.conflictingProtectPattern', {
            pattern: normalized,
            protectRow: prevProtect.ruleIndex + 1,
            replaceRow: ruleIndex + 1,
            replaceTo: to
          })
        );
        continue;
      }

      const prevReplace = seenReplace.get(normalized);
      if (!prevReplace) {
        seenReplace.set(normalized, { to, ruleIndex });
        continue;
      }
      if (prevReplace.ruleIndex === ruleIndex) continue;

      if (prevReplace.to === to) {
        errors.push(
          t('en', 'dictionary.detail.validate.duplicatePattern', {
            pattern: normalized,
            row1: prevReplace.ruleIndex + 1,
            row2: ruleIndex + 1
          })
        );
        continue;
      }

      errors.push(
        t('en', 'dictionary.detail.validate.conflictingPattern', {
          pattern: normalized,
          row1: prevReplace.ruleIndex + 1,
          to1: prevReplace.to,
          row2: ruleIndex + 1,
          to2: to
        })
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function consolidateDictionaryRulesByTo(rules: DictionaryReplaceRule[]): DictionaryReplaceRule[] {
  const groups = new Map<string, { to: string; from: string[]; fromSet: Set<string> }>();
  const toOrder: string[] = [];

  for (const rule of rules) {
    const to = String(rule?.to ?? '').trim();
    if (!to) continue;

    let group = groups.get(to);
    if (!group) {
      group = { to, from: [], fromSet: new Set() };
      groups.set(to, group);
      toOrder.push(to);
    }

    const patterns = Array.isArray(rule?.from) ? rule.from : [];
    for (const pattern of patterns) {
      const normalized = String(pattern ?? '').trim();
      if (!normalized) continue;
      if (group.fromSet.has(normalized)) continue;
      group.fromSet.add(normalized);
      group.from.push(normalized);
    }
  }

  return toOrder.map((to) => {
    const group = groups.get(to);
    return { type: 'replace', from: group?.from ?? [], to };
  });
}

type TextSpan = { start: number; end: number };

function buildPatternsByFirstChar(patterns: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of patterns) {
    const pattern = String(p ?? '').trim();
    if (!pattern) continue;
    const first = pattern[0];
    if (!first) continue;
    const list = map.get(first);
    if (list) {
      list.push(pattern);
    } else {
      map.set(first, [pattern]);
    }
  }
  for (const [first, list] of map) {
    const unique = Array.from(new Set(list));
    unique.sort((a, b) => b.length - a.length);
    map.set(first, unique);
  }
  return map;
}

function findProtectedSpans(text: string, protectPatterns: string[]): TextSpan[] {
  const normalized = protectPatterns.map((p) => String(p ?? '').trim()).filter(Boolean);
  if (text.length === 0 || normalized.length === 0) return [];

  const byFirstChar = buildPatternsByFirstChar(normalized);
  const spans: TextSpan[] = [];

  for (let i = 0; i < text.length; i++) {
    const first = text[i];
    const candidates = byFirstChar.get(first);
    if (!candidates) continue;

    for (const pattern of candidates) {
      if (text.startsWith(pattern, i)) {
        spans.push({ start: i, end: i + pattern.length });
        break;
      }
    }
  }

  if (spans.length === 0) return [];
  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: TextSpan[] = [];
  let current = spans[0];
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i];
    if (!span) continue;
    if (span.start <= current.end) {
      current.end = Math.max(current.end, span.end);
      continue;
    }
    merged.push(current);
    current = span;
  }
  merged.push(current);
  return merged;
}

function replaceAllOutsideProtectedSpans(
  text: string,
  pattern: string,
  replacement: string,
  protectedSpans: TextSpan[]
): string {
  if (protectedSpans.length === 0) {
    return text.replace(new RegExp(escapeRegExp(pattern), 'g'), replacement);
  }

  const starts: number[] = [];
  let index = text.indexOf(pattern);
  while (index !== -1) {
    starts.push(index);
    index = text.indexOf(pattern, index + pattern.length);
  }
  if (starts.length === 0) return text;

  const kept: number[] = [];
  let protectIndex = 0;
  for (const start of starts) {
    const end = start + pattern.length;
    while (protectIndex < protectedSpans.length && protectedSpans[protectIndex].end <= start) {
      protectIndex++;
    }
    const span = protectedSpans[protectIndex];
    const overlaps = Boolean(span && span.start < end && span.end > start);
    if (!overlaps) kept.push(start);
  }
  if (kept.length === 0) return text;

  let out = '';
  let lastIndex = 0;
  for (const start of kept) {
    out += text.slice(lastIndex, start);
    out += replacement;
    lastIndex = start + pattern.length;
  }
  out += text.slice(lastIndex);
  return out;
}

function splitDictionaryRules(rules: DictionaryRule[]): { protectPatterns: string[]; replaceRules: DictionaryReplaceRule[] } {
  const protectPatterns: string[] = [];
  const replaceRules: DictionaryReplaceRule[] = [];

  for (const rule of rules) {
    if (!rule) continue;
    if (rule.type === 'protect') {
      protectPatterns.push(...(Array.isArray(rule.from) ? rule.from : []));
      continue;
    }
    if (rule.type === 'replace') {
      replaceRules.push(rule);
    }
  }

  return { protectPatterns, replaceRules };
}

export function applyDictionaryRules(text: string, rules: DictionaryRule[]): string {
  const { protectPatterns, replaceRules } = splitDictionaryRules(rules);

  let result = text;
  for (const rule of replaceRules) {
    const to = String(rule?.to ?? '');
    for (const rawPattern of rule.from) {
      const pattern = String(rawPattern ?? '');
      if (!pattern) continue;
      if (!result.includes(pattern)) continue;

      const protectedSpans = findProtectedSpans(result, protectPatterns);
      result = replaceAllOutsideProtectedSpans(result, pattern, to, protectedSpans);
    }
  }
  return result;
}

export function serializeDictionaryRules(rules: DictionaryRule[]): string {
  return rules
    .map((rule) => {
      const from = (rule.from ?? []).map((p) => String(p ?? '').trim()).filter(Boolean);
      if (from.length === 0) return '';
      if (rule.type === 'protect') {
        return `protect: ${from.join(' | ')}`;
      }

      const to = String(rule.to ?? '').trim();
      if (!to) return '';
      return `${from.join(' | ')} -> ${to}`;
    })
    .filter(Boolean)
    .join('\n');
}
