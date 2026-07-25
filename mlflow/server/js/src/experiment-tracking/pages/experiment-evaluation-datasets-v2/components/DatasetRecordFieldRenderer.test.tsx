import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesignSystemProvider } from '@databricks/design-system';
import { IntlProvider } from 'react-intl';
import type { ReactNode } from 'react';
import { DatasetRecordFieldRenderer } from './DatasetRecordFieldRenderer';

const wrap = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en">
    <DesignSystemProvider>{children}</DesignSystemProvider>
  </IntlProvider>
);

const renderChatField = ({
  fieldKey = 'inputs',
  parsed,
  setText = jest.fn(),
  onNavigateRecord,
}: {
  fieldKey?: 'inputs' | 'expectations';
  parsed: Record<string, unknown>;
  setText?: jest.Mock;
  onNavigateRecord?: (direction: -1 | 1) => void;
}) => {
  render(
    <DatasetRecordFieldRenderer
      fieldKey={fieldKey}
      value={{
        text: JSON.stringify(parsed, null, 2),
        setText,
        parsed,
        isValid: true,
      }}
      renderMode="chat"
      editorFormat="json"
      ariaLabel="Dataset record field"
      onSaveShortcut={jest.fn()}
      onNavigateRecord={onNavigateRecord}
    />,
    { wrapper: wrap },
  );
  return { setText };
};

describe('DatasetRecordFieldRenderer chat mode', () => {
  test('uses the trace chat header and writes edited message content back to the record text', () => {
    const { setText } = renderChatField({
      parsed: { messages: [{ role: 'user', content: 'old question' }] },
    });

    expect(screen.getByText('User')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'User message' }), {
      target: { value: 'new question' },
    });

    expect(JSON.parse(setText.mock.calls[0][0])).toEqual({
      messages: [{ role: 'user', content: 'new question' }],
    });
  });

  test('renders empty expectations as an editable assistant message with the expected-output placeholder', () => {
    const { setText } = renderChatField({ fieldKey: 'expectations', parsed: {} });

    const textarea = screen.getByRole('textbox', { name: 'Assistant message' });
    expect(textarea).toHaveAttribute('placeholder', 'type expected output');
    fireEvent.change(textarea, { target: { value: 'expected answer' } });

    expect(JSON.parse(setText.mock.calls[0][0])).toEqual({
      messages: [{ role: 'assistant', content: 'expected answer' }],
    });
  });

  test('arrow keys move between message editors when the cursor is at a boundary', () => {
    const requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    renderChatField({
      parsed: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ],
      },
    });

    const userMessage = screen.getByRole('textbox', { name: 'User message' }) as HTMLTextAreaElement;
    const assistantMessage = screen.getByRole('textbox', { name: 'Assistant message' }) as HTMLTextAreaElement;

    userMessage.focus();
    userMessage.setSelectionRange(userMessage.value.length, userMessage.value.length);
    fireEvent.keyDown(userMessage, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(assistantMessage);
    expect(assistantMessage.selectionStart).toBe(0);

    assistantMessage.setSelectionRange(0, 0);
    fireEvent.keyDown(assistantMessage, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(userMessage);
    expect(userMessage.selectionStart).toBe(userMessage.value.length);

    requestAnimationFrameSpy.mockRestore();
  });

  test('arrow keys navigate records at the first and last message boundaries', () => {
    const onNavigateRecord = jest.fn();
    renderChatField({
      parsed: {
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ],
      },
      onNavigateRecord,
    });

    const userMessage = screen.getByRole('textbox', { name: 'User message' }) as HTMLTextAreaElement;
    const assistantMessage = screen.getByRole('textbox', { name: 'Assistant message' }) as HTMLTextAreaElement;

    userMessage.setSelectionRange(0, 0);
    fireEvent.keyDown(userMessage, { key: 'ArrowUp' });
    expect(onNavigateRecord).toHaveBeenCalledWith(-1);

    assistantMessage.setSelectionRange(assistantMessage.value.length, assistantMessage.value.length);
    fireEvent.keyDown(assistantMessage, { key: 'ArrowDown' });
    expect(onNavigateRecord).toHaveBeenCalledWith(1);
  });
});
