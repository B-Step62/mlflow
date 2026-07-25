import { describe, expect, test } from '@jest/globals';
import {
  getChatMessagesFromRecordValue,
  getDatasetRecordValuePreview,
  parseRecordObject,
  stringifyRecordObject,
} from './datasetRecordRendering';

describe('datasetRecordRendering', () => {
  test('extracts the latest user message from OpenAI-style message objects', () => {
    expect(
      getDatasetRecordValuePreview({
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'What is retrieval augmented generation?' },
          { role: 'assistant', content: 'RAG combines retrieval with generation.' },
        ],
      }),
    ).toBe('What is retrieval augmented generation?');
  });

  test('extracts chat messages from raw message arrays', () => {
    const messages = getChatMessagesFromRecordValue([
      { role: 'user', content: 'Summarize this trace' },
      { role: 'assistant', content: 'The trace timed out.' },
    ]);
    expect(messages).toHaveLength(2);
    expect(getDatasetRecordValuePreview(messages)).toBe('Summarize this trace');
  });

  test('uses common scalar keys before falling back to compact JSON', () => {
    expect(getDatasetRecordValuePreview({ question: 'How do I reset a cluster?' })).toBe('How do I reset a cluster?');
    expect(getDatasetRecordValuePreview({ expected_response: 'Restart the cluster.' })).toBe('Restart the cluster.');
    expect(getDatasetRecordValuePreview({ unknown: { nested: true } })).toBe('{"unknown":{"nested":true}}');
  });

  test('parses and stringifies YAML record objects', () => {
    const yamlText = stringifyRecordObject({ question: 'What is MLflow?', metadata: { difficulty: 'easy' } }, 'yaml');
    expect(yamlText).toContain('question: What is MLflow?');
    expect(parseRecordObject(yamlText, 'yaml').value).toEqual({
      question: 'What is MLflow?',
      metadata: { difficulty: 'easy' },
    });
  });

  test('rejects array YAML because dataset fields must be objects', () => {
    const parsed = parseRecordObject('- one\n- two\n', 'yaml');
    expect(parsed.value).toBeUndefined();
    expect(parsed.error).toMatch(/object/i);
  });
});
