import { parseAnchor, stringifyAnchor, resolvePointer, toCodepointRange, ensureSnippet, hashString, buildAnchor } from '../anchorUtils';

describe('anchorUtils', () => {
  test('stringify/parse roundtrip', () => {
    const anchor = buildAnchor({ level: 'SPAN_FIELD', span_id: 'sp-1', field_path: '/outputs/answer', text_range: { start: 2, end: 5, unit: 'CODEPOINT' } });
    const s = stringifyAnchor(anchor);
    const p = parseAnchor(s);
    expect(p).toEqual(anchor);
  });

  test('resolvePointer works with arrays and objects', () => {
    const root = { outputs: { messages: [ { content: 'a' }, { content: 'b' } ] } };
    expect(resolvePointer(root, '/outputs/messages/1/content')).toBe('b');
  });

  test('toCodepointRange handles surrogate pairs', () => {
    const text = 'A🙂BC'; // code units: A (1) + 🙂 (2) + B (1) + C (1)
    // select first three code units (A + first half of emoji) -> should count codepoints up to boundary correctly
    const { start, end } = toCodepointRange(text, 0, 3);
    // up to 3 code units we cover A (1 cp) + 🙂 (1 cp) = 2 cps
    expect(start).toBe(0);
    expect(end).toBe(2);
  });

  test('ensureSnippet length and content', () => {
    const text = 'Hello world';
    const snip = ensureSnippet(text, 6, 11);
    expect(snip).toBe('world');
  });

  test('hashString produces stable prefix', () => {
    expect(hashString('abc')).toMatch(/^fnv1a32:/);
  });
});

