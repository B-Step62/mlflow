import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import userEvent from '@testing-library/user-event';
import { renderWithDesignSystem, screen } from '../../../../../common/utils/TestUtils.react18';
import { IssueDetectionModelDropdown, type IssueDetectionModelSelection } from './IssueDetectionModelDropdown';
import { useModelsQuery } from '../../../../../gateway/hooks/useModelsQuery';

jest.mock('../../../../../gateway/hooks/useModelsQuery', () => ({
  useModelsQuery: jest.fn(),
}));

const OPENAI_SELECTION: IssueDetectionModelSelection = {
  mode: 'direct',
  provider: 'openai',
  model: 'gpt-5.5',
};

describe('IssueDetectionModelDropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Return models only for the expanded provider (component passes provider when expanded)
    jest.mocked(useModelsQuery).mockImplementation(({ provider } = {}) => ({
      data: provider === 'anthropic' ? [{ model: 'claude-sonnet-4-6' }, { model: 'claude-opus-4-8' }] : undefined,
      error: undefined,
      isLoading: false,
      refetch: jest.fn(),
    })) as any;
  });

  test('shows the current selection on the trigger card', () => {
    renderWithDesignSystem(
      <IssueDetectionModelDropdown endpoints={[]} value={OPENAI_SELECTION} onChange={jest.fn()} />,
    );

    const trigger = screen.getByTestId('model-dropdown-trigger');
    expect(trigger).toHaveTextContent('OpenAI');
    expect(trigger).toHaveTextContent('gpt-5.5');
  });

  test('lists AI Gateway endpoints and selects one', async () => {
    const onChange = jest.fn();
    renderWithDesignSystem(
      <IssueDetectionModelDropdown
        endpoints={[{ name: 'my-endpoint' } as any]}
        value={OPENAI_SELECTION}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByTestId('model-dropdown-trigger'));
    expect(screen.getByText('AI Gateway')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('model-option-endpoint-my-endpoint'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'endpoint', endpointName: 'my-endpoint' }));
  });

  test('providers are collapsed until expanded, then list their models', async () => {
    const onChange = jest.fn();
    renderWithDesignSystem(<IssueDetectionModelDropdown endpoints={[]} value={OPENAI_SELECTION} onChange={onChange} />);

    await userEvent.click(screen.getByTestId('model-dropdown-trigger'));

    // Anthropic's models are hidden until its group is expanded
    expect(screen.queryByTestId('model-option-anthropic-claude-sonnet-4-6')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('model-provider-anthropic'));
    expect(screen.getByTestId('model-option-anthropic-claude-sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByTestId('model-option-anthropic-claude-opus-4-8')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('model-option-anthropic-claude-opus-4-8'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'direct', provider: 'anthropic', model: 'claude-opus-4-8' });
  });

  test('falls back to the recommended model when the gateway returns none', async () => {
    renderWithDesignSystem(
      <IssueDetectionModelDropdown endpoints={[]} value={OPENAI_SELECTION} onChange={jest.fn()} />,
    );

    await userEvent.click(screen.getByTestId('model-dropdown-trigger'));
    // OpenAI's group is expanded by default (matches the current selection); no models returned -> default shown
    expect(screen.getByTestId('model-option-openai-gpt-5.5')).toBeInTheDocument();
  });
});
