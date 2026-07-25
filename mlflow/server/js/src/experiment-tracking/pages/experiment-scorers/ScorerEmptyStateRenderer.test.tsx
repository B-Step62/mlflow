import userEvent from '@testing-library/user-event';
import { describe, expect, it, jest } from '@jest/globals';
import { renderWithDesignSystem, screen } from '../../../common/utils/TestUtils.react18';
import ScorerEmptyStateRenderer from './ScorerEmptyStateRenderer';
import { ScorerEvaluationScope } from './constants';
import { LLM_TEMPLATE } from './types';

const renderComponent = () => {
  const onUseBuiltInJudgeClick = jest.fn();
  const onAddLLMScorerClick = jest.fn();
  const onAddCustomCodeScorerClick = jest.fn();

  renderWithDesignSystem(
    <ScorerEmptyStateRenderer
      onUseBuiltInJudgeClick={onUseBuiltInJudgeClick}
      onAddLLMScorerClick={onAddLLMScorerClick}
      onAddCustomCodeScorerClick={onAddCustomCodeScorerClick}
    />,
  );

  return { onUseBuiltInJudgeClick, onAddLLMScorerClick, onAddCustomCodeScorerClick };
};

describe('ScorerEmptyStateRenderer', () => {
  it('renders built-in judge catalog sections and custom judge actions', () => {
    renderComponent();

    expect(screen.getByText('Use a judge to evaluate your GenAI app')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByText('Retrieval')).toBeInTheDocument();
    expect(screen.getByText('Safety and policy')).toBeInTheDocument();
    expect(screen.getByText('Agent and tools')).toBeInTheDocument();
    expect(screen.getByText('Conversations')).toBeInTheDocument();
    expect(screen.getByText('Custom LLM judge')).toBeInTheDocument();
    expect(screen.getByText('Custom code judge')).toBeInTheDocument();
  });

  it('passes the selected built-in judge when a catalog row is clicked', async () => {
    const user = userEvent.setup();
    const { onUseBuiltInJudgeClick } = renderComponent();

    await user.click(screen.getByText('Correctness'));

    expect(onUseBuiltInJudgeClick).toHaveBeenCalledWith(
      expect.objectContaining({
        template: LLM_TEMPLATE.CORRECTNESS,
        defaultName: 'correctness',
        scope: ScorerEvaluationScope.TRACES,
      }),
    );
  });

  it('starts custom judge flows from the custom catalog card', async () => {
    const user = userEvent.setup();
    const { onAddLLMScorerClick, onAddCustomCodeScorerClick } = renderComponent();

    await user.click(screen.getByText('Custom LLM judge'));
    await user.click(screen.getByText('Custom code judge'));

    expect(onAddLLMScorerClick).toHaveBeenCalledTimes(1);
    expect(onAddCustomCodeScorerClick).toHaveBeenCalledTimes(1);
  });
});
