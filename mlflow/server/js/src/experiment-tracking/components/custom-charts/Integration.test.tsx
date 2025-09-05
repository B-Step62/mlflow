import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { RunViewMetricCharts } from '../run-page/RunViewMetricCharts';

// Mock the custom chart components
jest.mock('./CustomChartGenerator', () => ({
  CustomChartGenerator: ({ onGenerate, isGenerating }: any) => (
    <div data-testid="custom-chart-generator">
      <button 
        onClick={() => onGenerate('test prompt')} 
        disabled={isGenerating}
      >
        {isGenerating ? 'Generating...' : 'Generate Chart'}
      </button>
    </div>
  ),
}));

jest.mock('./CustomChartDisplay', () => ({
  CustomChartDisplay: ({ chartCode, isLoading, error, onViewCode, onSave }: any) => (
    <div data-testid="custom-chart-display">
      {isLoading && <div>Loading...</div>}
      {error && <div>Error: {error}</div>}
      {chartCode && (
        <div>
          <div>Chart: {chartCode}</div>
          <button onClick={onViewCode}>View Code</button>
          <button onClick={onSave}>Save Chart</button>
        </div>
      )}
    </div>
  ),
}));

// Mock the hook
jest.mock('../run-page/hooks/useCustomChartGeneration', () => ({
  useCustomChartGeneration: () => ({
    isGenerating: false,
    chartCode: null,
    error: null,
    progress: null,
    generateCustomChart: jest.fn(),
    reset: jest.fn(),
  }),
}));

// Mock other dependencies
jest.mock('../runs-charts/components/RunsChartsSectionAccordion', () => ({
  RunsChartsSectionAccordion: () => <div data-testid="charts-section">Charts Section</div>,
}));

jest.mock('../runs-charts/components/RunsChartsConfigureModal', () => ({
  RunsChartsConfigureModal: () => <div data-testid="configure-modal">Configure Modal</div>,
}));

jest.mock('../runs-charts/components/RunsChartsFullScreenModal', () => ({
  RunsChartsFullScreenModal: () => <div data-testid="fullscreen-modal">Fullscreen Modal</div>,
}));

jest.mock('../runs-charts/components/RunsChartsFilterInput', () => ({
  RunsChartsFilterInput: () => <input data-testid="filter-input" />,
}));

jest.mock('../runs-charts/components/RunsChartsGlobalChartSettingsDropdown', () => ({
  RunsChartsGlobalChartSettingsDropdown: () => <div data-testid="settings-dropdown">Settings</div>,
}));

jest.mock('../runs-charts/hooks/useRunsChartsTooltip', () => ({
  RunsChartsTooltipWrapper: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('../runs-charts/components/RunsChartsDraggableCardsGridContext', () => ({
  RunsChartsDraggableCardsGridContextProvider: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('../runs-charts/hooks/useRunsChartsUIConfiguration', () => ({
  RunsChartsUIConfigurationContextProvider: ({ children }: any) => <div>{children}</div>,
  useConfirmChartCardConfigurationFn: () => jest.fn(),
  useInsertRunsChartsFn: () => jest.fn(),
  useRemoveRunsChartFn: () => jest.fn(),
  useReorderRunsChartsFn: () => jest.fn(),
}));

jest.mock('../../../common/hooks/useIsTabActive', () => ({
  useIsTabActive: () => true,
}));

jest.mock('../experiment-page/hooks/usePopulateImagesByRunUuid', () => ({
  usePopulateImagesByRunUuid: () => {},
}));

// Create a mock Redux store
const mockStore = createStore((state = {
  entities: {
    sampledMetricsByRunUuid: {},
    imagesByRunUuid: {},
  },
}) => state);

describe('Integration Tests - Custom Charts in Run Page', () => {
  const mockRunInfo = {
    runUuid: 'run-123',
    runName: 'Test Run',
    experimentId: 'exp-456',
    status: 'FINISHED',
    artifactUri: 'artifacts/',
  };

  const mockChartUIState = {
    compareRunCharts: [],
    compareRunSections: [],
    chartsSearchFilter: '',
    isAccordionReordered: false,
    autoRefreshEnabled: false,
    globalLineChartConfig: {
      xAxisKey: 'STEP',
      lineSmoothness: 0,
      selectedXAxisMetricKey: '',
    },
  };

  const defaultProps = {
    runInfo: mockRunInfo,
    metricKeys: ['accuracy', 'loss'],
    mode: 'model' as const,
    chartUIState: mockChartUIState,
    updateChartsUIState: jest.fn(),
    latestMetrics: { accuracy: { value: 0.95 }, loss: { value: 0.05 } },
    params: { learning_rate: { value: '0.001' } },
    tags: { version: { value: '1.0' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders custom charts section in run page', () => {
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
    expect(screen.getByTestId('custom-chart-generator')).toBeInTheDocument();
    expect(screen.getByTestId('custom-chart-display')).toBeInTheDocument();
  });

  it('integrates custom charts with existing charts section', () => {
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    // Both existing charts and custom charts should be present
    expect(screen.getByTestId('charts-section')).toBeInTheDocument();
    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
  });

  it('maintains proper layout with filter and settings', () => {
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    expect(screen.getByTestId('filter-input')).toBeInTheDocument();
    expect(screen.getByTestId('settings-dropdown')).toBeInTheDocument();
    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
  });

  it('handles chart generation flow integration', () => {
    const mockGenerateChart = jest.fn();
    
    // Mock the hook to return our controlled function
    jest.doMock('../run-page/hooks/useCustomChartGeneration', () => ({
      useCustomChartGeneration: () => ({
        isGenerating: false,
        chartCode: null,
        error: null,
        progress: null,
        generateCustomChart: mockGenerateChart,
        reset: jest.fn(),
      }),
    }));

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    const generateButton = screen.getByText('Generate Chart');
    fireEvent.click(generateButton);

    expect(mockGenerateChart).toHaveBeenCalledWith('test prompt');
  });

  it('handles different modes (model vs system)', () => {
    const { rerender } = render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} mode="model" />
      </Provider>
    );

    expect(screen.getByText('Custom Charts')).toBeInTheDocument();

    rerender(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} mode="system" />
      </Provider>
    );

    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
  });

  it('provides correct context to custom chart components', () => {
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    // The custom chart generator should receive run and experiment IDs
    const generator = screen.getByTestId('custom-chart-generator');
    expect(generator).toBeInTheDocument();
  });

  it('handles responsive layout correctly', () => {
    // Mock window size
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1200,
    });

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('Custom Charts')).toBeInTheDocument();

    // Test mobile layout
    Object.defineProperty(window, 'innerWidth', {
      value: 600,
    });
    window.dispatchEvent(new Event('resize'));

    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
  });

  it('integrates with auto-refresh functionality', () => {
    const propsWithAutoRefresh = {
      ...defaultProps,
      chartUIState: {
        ...mockChartUIState,
        autoRefreshEnabled: true,
      },
    };

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...propsWithAutoRefresh} />
      </Provider>
    );

    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
    // Custom charts should not interfere with auto-refresh
  });

  it('handles error states in integration', () => {
    jest.doMock('../run-page/hooks/useCustomChartGeneration', () => ({
      useCustomChartGeneration: () => ({
        isGenerating: false,
        chartCode: null,
        error: 'Generation failed',
        progress: null,
        generateCustomChart: jest.fn(),
        reset: jest.fn(),
      }),
    }));

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('Error: Generation failed')).toBeInTheDocument();
  });

  it('handles loading states in integration', () => {
    jest.doMock('../run-page/hooks/useCustomChartGeneration', () => ({
      useCustomChartGeneration: () => ({
        isGenerating: true,
        chartCode: null,
        error: null,
        progress: 'Generating...',
        generateCustomChart: jest.fn(),
        reset: jest.fn(),
      }),
    }));

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.getByText('Generating...')).toBeInTheDocument();
  });

  it('handles successful chart generation in integration', () => {
    const mockChartCode = 'const chart = () => <div>Generated Chart</div>;';
    
    jest.doMock('../run-page/hooks/useCustomChartGeneration', () => ({
      useCustomChartGeneration: () => ({
        isGenerating: false,
        chartCode: mockChartCode,
        error: null,
        progress: null,
        generateCustomChart: jest.fn(),
        reset: jest.fn(),
      }),
    }));

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    expect(screen.getByText(`Chart: ${mockChartCode}`)).toBeInTheDocument();
    expect(screen.getByText('View Code')).toBeInTheDocument();
    expect(screen.getByText('Save Chart')).toBeInTheDocument();
  });

  it('maintains scroll position with custom charts section', () => {
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    const customChartsSection = screen.getByText('Custom Charts').closest('div');
    expect(customChartsSection).toHaveStyle({
      borderTop: expect.stringContaining('1px solid'),
      paddingTop: expect.any(String),
      marginTop: expect.any(String),
    });
  });

  it('integrates with existing chart modals', () => {
    const propsWithModal = {
      ...defaultProps,
      chartUIState: {
        ...mockChartUIState,
        // Simulate having a configured chart
      },
    };

    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...propsWithModal} />
      </Provider>
    );

    // Should have both existing modals and custom charts
    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
    expect(screen.getByTestId('fullscreen-modal')).toBeInTheDocument();
  });

  it('handles theme integration correctly', () => {
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} />
      </Provider>
    );

    const customChartsHeading = screen.getByText('Custom Charts');
    expect(customChartsHeading).toHaveStyle({
      fontWeight: expect.any(String),
      color: expect.any(String),
    });
  });

  it('preserves existing functionality with custom charts added', () => {
    const mockUpdateChartsUIState = jest.fn();
    
    render(
      <Provider store={mockStore}>
        <RunViewMetricCharts {...defaultProps} updateChartsUIState={mockUpdateChartsUIState} />
      </Provider>
    );

    // Existing charts functionality should still work
    expect(screen.getByTestId('charts-section')).toBeInTheDocument();
    expect(screen.getByTestId('filter-input')).toBeInTheDocument();
    expect(screen.getByTestId('settings-dropdown')).toBeInTheDocument();
    
    // Custom charts should be added without breaking existing functionality
    expect(screen.getByText('Custom Charts')).toBeInTheDocument();
  });
});