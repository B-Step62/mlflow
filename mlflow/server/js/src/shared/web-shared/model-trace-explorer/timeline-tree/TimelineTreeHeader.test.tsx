import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { DesignSystemProvider } from '@databricks/design-system';
import { IntlProvider } from '@databricks/i18n';

import { TEST_SPAN_FILTER_STATE } from './TimelineTree.test-utils';
import { TimelineTreeHeader } from './TimelineTreeHeader';

const TestWrapper = ({ traceId }: { traceId?: string }) => {
  const [showTimelineInfo, setShowTimelineInfo] = useState<boolean>(false);
  const [spanFilterState, setSpanFilterState] = useState(TEST_SPAN_FILTER_STATE);

  return (
    <IntlProvider locale="en">
      <DesignSystemProvider>
        <TimelineTreeHeader
          showTimelineInfo={showTimelineInfo}
          setShowTimelineInfo={setShowTimelineInfo}
          spanFilterState={spanFilterState}
          setSpanFilterState={setSpanFilterState}
          traceId={traceId}
        />
        <span>{String(showTimelineInfo)}</span>
      </DesignSystemProvider>
    </IntlProvider>
  );
};

describe('TimelineTreeHeader', () => {
  it('should switch the timeline tree view state', async () => {
    render(<TestWrapper />);

    expect(screen.getByText('false')).toBeInTheDocument();

    const timelineButton = screen.getByTestId('show-timeline-info-button');
    await userEvent.click(timelineButton);
    expect(await screen.findByText('true')).toBeInTheDocument();

    await userEvent.click(timelineButton);
    expect(await screen.findByText('false')).toBeInTheDocument();
  });

  it('copies the full trace ID when clicking the trace ID badge', async () => {
    const writeText = jest.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<TestWrapper traceId="tr-1234567890abcdef" />);

    await userEvent.click(screen.getByRole('button', { name: '12345678' }));

    expect(writeText).toHaveBeenCalledWith('tr-1234567890abcdef');
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12345678' })).toBeInTheDocument();
  });
});
