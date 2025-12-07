import { useEffect, useMemo, useState, useRef, useCallback } from 'react';

import {
  AssistantIcon,
  Alert,
  Button,
  ChartLineIcon,
  CheckCircleIcon,
  Input,
  Modal,
  QuestionMarkIcon,
  ClockIcon,
  SimpleSelect,
  SimpleSelectOption,
  Typography,
  useDesignSystemTheme,
  FilterIcon,
  Popover,
} from '@databricks/design-system';
import AiLogoUrl from '../../../pages/experiment-insights/components/ai-logo.svg';
import { useParams, useSearchParams } from '../../../../common/utils/RoutingUtils';
import {
  getAbsoluteStartEndTime,
  START_TIME_LABEL_QUERY_PARAM_KEY,
  DEFAULT_START_TIME_LABEL,
} from '@mlflow/mlflow/src/experiment-tracking/hooks/useMonitoringFilters';
import { MlflowService } from '../../../sdk/MlflowService';
import { useFilters as useTraceFilters, getEvalTabTotalTracesLimit } from '@databricks/web-shared/genai-traces-table';
import { searchMlflowTracesQueryFn } from '@databricks/web-shared/genai-traces-table/hooks/useMlflowTraces';
import {
  CUSTOM_METADATA_COLUMN_ID,
  EXECUTION_DURATION_COLUMN_ID,
  LOGGED_MODEL_COLUMN_ID,
  RUN_NAME_COLUMN_ID,
  SOURCE_COLUMN_ID,
  SPAN_CONTENT_COLUMN_ID,
  SPAN_NAME_COLUMN_ID,
  SPAN_TYPE_COLUMN_ID,
  STATE_COLUMN_ID,
  TRACE_NAME_COLUMN_ID,
  USER_COLUMN_ID,
} from '@databricks/web-shared/genai-traces-table/hooks/useTableColumns';
import { FilterOperator, TracesTableColumnGroup, type TableFilter } from '@databricks/web-shared/genai-traces-table';
import { getCustomMetadataKeyFromColumnId } from '@databricks/web-shared/genai-traces-table/utils/TraceUtils';


const { TextArea } = Input;

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT';

type TraceInsightsLaunchModalProps = {
  visible: boolean;
  initialPrompt: string;
  onCancel: () => void;
};

const formatDuration = (seconds?: number) => {
  if (!seconds || Number.isNaN(seconds)) {
    return '~1 minute';
  }
  if (seconds < 60) {
    return '<1 minute';
  }
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
};

const StatTile = ({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
        borderRadius: theme.borders.borderRadiusSm,
        backgroundColor: theme.colors.backgroundTertiary,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <Typography.Text css={{ color: theme.colors.textSecondary }}>{label}</Typography.Text>
        {extra}
      </div>
      <Typography.Title level={5} css={{ margin: 0 }}>
        {value}
      </Typography.Title>
    </div>
  );
};

const BenefitRow = ({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: theme.spacing.sm,
        alignItems: 'flex-start',
      }}
    >
      <span
        css={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.colors.textSecondary,
        }}
      >
        {icon}
      </span>
      <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text color="secondary">
          {description}
        </Typography.Text>
      </div>
    </div>
  );
};

const buildTraceSearchFilterString = (
  filters: TableFilter[],
  timeRange?: { startTime?: string; endTime?: string },
): string | undefined => {
  const networkFilters = filters.filter((filter) => filter.column !== TracesTableColumnGroup.ASSESSMENT);

  const clauses: string[] = [];

  if (timeRange) {
    const timestampField = 'attributes.timestamp_ms';
    if (timeRange.startTime) {
      clauses.push(`${timestampField} > ${timeRange.startTime}`);
    }
    if (timeRange.endTime) {
      clauses.push(`${timestampField} < ${timeRange.endTime}`);
    }
  }

  networkFilters.forEach((filter) => {
    switch (filter.column) {
      case TracesTableColumnGroup.TAG: {
        if (filter.key) {
          const tagField = 'tags';
          const fieldName =
            filter.key.includes('.') || filter.key.includes(' ')
              ? `${tagField}.\`${filter.key}\``
              : `${tagField}.${filter.key}`;
          clauses.push(`${fieldName} ${filter.operator} '${filter.value}'`);
        }
        break;
      }
      case EXECUTION_DURATION_COLUMN_ID: {
        clauses.push(`attributes.execution_time_ms ${filter.operator} ${filter.value}`);
        break;
      }
      case STATE_COLUMN_ID: {
        clauses.push(`attributes.status = '${filter.value}'`);
        break;
      }
      case USER_COLUMN_ID: {
        clauses.push(`request_metadata."mlflow.trace.user" = '${filter.value}'`);
        break;
      }
      case RUN_NAME_COLUMN_ID: {
        clauses.push(`attributes.run_id = '${filter.value}'`);
        break;
      }
      case LOGGED_MODEL_COLUMN_ID: {
        clauses.push(`request_metadata."mlflow.modelId" = '${filter.value}'`);
        break;
      }
      case TRACE_NAME_COLUMN_ID: {
        clauses.push(`attributes.name ${filter.operator} '${filter.value}'`);
        break;
      }
      case SOURCE_COLUMN_ID: {
        clauses.push(`request_metadata."mlflow.source.name" ${filter.operator} '${filter.value}'`);
        break;
      }
      case TracesTableColumnGroup.EXPECTATION: {
        clauses.push(`expectation.\`${filter.key}\` ${filter.operator} '${filter.value}'`);
        break;
      }
      case SPAN_NAME_COLUMN_ID: {
        if (filter.operator === '=') {
          clauses.push(`span.name ILIKE '${filter.value}'`);
        } else if (filter.operator === FilterOperator.CONTAINS) {
          clauses.push(`span.name ILIKE '%${filter.value}%'`);
        } else {
          clauses.push(`span.name ${filter.operator} '${filter.value}'`);
        }
        break;
      }
      case SPAN_TYPE_COLUMN_ID: {
        if (filter.operator === '=') {
          clauses.push(`span.type ILIKE '${filter.value}'`);
        } else if (filter.operator === FilterOperator.CONTAINS) {
          clauses.push(`span.type ILIKE '%${filter.value}%'`);
        } else {
          clauses.push(`span.type ${filter.operator} '${filter.value}'`);
        }
        break;
      }
      case SPAN_CONTENT_COLUMN_ID: {
        if (filter.operator === FilterOperator.CONTAINS) {
          clauses.push(`span.content ILIKE '%${filter.value}%'`);
        }
        break;
      }
      default: {
        if (filter.column.startsWith(CUSTOM_METADATA_COLUMN_ID)) {
          const columnKey = `request_metadata.${getCustomMetadataKeyFromColumnId(filter.column)}`;
          if (filter.operator === FilterOperator.CONTAINS) {
            clauses.push(`${columnKey} ILIKE '%${filter.value}%'`);
          } else {
            clauses.push(`${columnKey} ${filter.operator} '${filter.value}'`);
          }
        }
        break;
      }
    }
  });

  return clauses.length ? clauses.join(' AND ') : undefined;
};

export const TraceInsightsLaunchModal = ({
  visible,
  initialPrompt,
  onCancel,
}: TraceInsightsLaunchModalProps) => {
  const { theme } = useDesignSystemTheme();
  const { experimentId } = useParams();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [model, setModel] = useState('openai:/gpt-5');
  const [searchParams] = useSearchParams();
  const [filters] = useTraceFilters();
  const [jobId, setJobId] = useState<string>();
  const [jobStatus, setJobStatus] = useState<JobStatus>();
  const [jobError, setJobError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [traceCount, setTraceCount] = useState<number>();
  const [traceCountLoading, setTraceCountLoading] = useState(false);
  const [traceCountError, setTraceCountError] = useState<string>();
  const [insightRunId, setInsightRunId] = useState<string>();
  const pollingIntervalRef = useRef<number>();

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = undefined;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const filterList = useMemo(() => {
    const filterParams = searchParams.getAll('filter');
    const filters = filterParams.map((raw) => {
      const [column, operator, value, key] = raw.split('::');
      return {
        label: key || column || 'filter',
        text: `${operator ?? '='} ${value ?? ''}`.trim(),
        icon: 'filter' as const,
      };
    });

    const startTimeLabel =
      (searchParams.get(START_TIME_LABEL_QUERY_PARAM_KEY) as any) || DEFAULT_START_TIME_LABEL;
    const start = searchParams.get('startTime') || undefined;
    const end = searchParams.get('endTime') || undefined;
    const absolute = getAbsoluteStartEndTime(new Date(), {
      startTimeLabel,
      startTime: start,
      endTime: end,
    });
    if (absolute.startTime || absolute.endTime) {
      const summary = `${absolute.startTime ? new Date(absolute.startTime).toLocaleString() : '—'} → ${
        absolute.endTime ? new Date(absolute.endTime).toLocaleString() : '—'
      }`;
      filters.unshift({ label: '', text: summary, icon: 'clock' as const });
    }
    return filters;
  }, [searchParams]);

  const timeRange = useMemo(() => {
    const startTimeLabel =
      (searchParams.get(START_TIME_LABEL_QUERY_PARAM_KEY) as any) || DEFAULT_START_TIME_LABEL;
    const start = searchParams.get('startTime') || undefined;
    const end = searchParams.get('endTime') || undefined;
    return getAbsoluteStartEndTime(new Date(), {
      startTimeLabel,
      startTime: start,
      endTime: end,
    });
  }, [searchParams]);

  const timeRangeMs = useMemo(
    () => ({
      startTime: timeRange.startTime ? `${new Date(timeRange.startTime).getTime()}` : undefined,
      endTime: timeRange.endTime ? `${new Date(timeRange.endTime).getTime()}` : undefined,
    }),
    [timeRange],
  );

  const searchFilterString = useMemo(
    () => buildTraceSearchFilterString(filters, timeRangeMs),
    [filters, timeRangeMs],
  );

  const statusToProgress = useCallback((status?: JobStatus) => {
    switch (status) {
      case 'PENDING':
        return 25;
      case 'RUNNING':
        return 65;
      case 'SUCCEEDED':
      case 'FAILED':
      case 'TIMEOUT':
        return 100;
      default:
        return 0;
    }
  }, []);

  const jobProgress = useMemo(() => statusToProgress(jobStatus), [jobStatus, statusToProgress]);

  const isJobTerminal = jobStatus === 'SUCCEEDED' || jobStatus === 'FAILED' || jobStatus === 'TIMEOUT';
  const isJobStarted = Boolean(submitting || jobId || jobStatus);
  const isBusy = Boolean(submitting || (jobStatus && !isJobTerminal));

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt, visible]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const abortController = new AbortController();
    let isUnmounted = false;

    const fetchTraceCount = async () => {
      setTraceCountLoading(true);
      setTraceCountError(undefined);

      try {
        const traces = await searchMlflowTracesQueryFn({
          signal: abortController.signal,
          locations: [{ type: 'MLFLOW_EXPERIMENT' as const, mlflow_experiment: { experiment_id: experimentId! } }],
          filter: searchFilterString,
          limit: getEvalTabTotalTracesLimit(),
        });

        if (!isUnmounted && !abortController.signal.aborted) {
          setTraceCount(traces.length);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setTraceCount(undefined);
          setTraceCountError((error as Error).message);
        }
      } finally {
        if (!isUnmounted && !abortController.signal.aborted) {
          setTraceCountLoading(false);
        }
      }
    };

    fetchTraceCount();

    return () => {
      isUnmounted = true;
      abortController.abort();
    };
  }, [visible, searchFilterString, experimentId]);

  const statValues = useMemo(() => {
    const count = traceCount ?? 0;
    return {
      traces: traceCountLoading ? '…' : count.toLocaleString(),
      cost: traceCountLoading ? '…' : `$${(count * 0.0001).toFixed(2)}`, // TODO: Update
      time: traceCountLoading ? '…' : formatDuration(count * 0.0001), // TODO: Update
    };
  }, [traceCount, traceCountLoading]);

  const benefits = useMemo(
    () => [
      {
        title: 'Issue Discovery',
        description: 'Automatically identify and categorize problems by severity',
        icon: <QuestionMarkIcon />,
      },
      {
        title: 'Impact Visualization',
        description: 'Understand which issues affect the most traces',
        icon: <ChartLineIcon />,
      },
      {
        title: 'Actionable Recommendations',
        description: 'Get suggested next steps to improve quality',
        icon: <AssistantIcon />,
      },
    ],
    [],
  );

  const handleAnalyze = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (traceCountLoading) {
      setJobError('Trace count is still loading. Please wait a moment and try again.');
      return;
    }
    if (traceCountError) {
      setJobError('Unable to fetch trace count. Please try again.');
      return;
    }
    if (!traceCount || traceCount <= 0) {
      setJobError('No traces found for the current filters.');
      return;
    }

    setJobError(undefined);
    setSubmitting(true);
    setJobStatus('PENDING');

    MlflowService.submitJob({
      name: 'generate-insight-report',
      params: {
        filter_string: searchFilterString,
        experiment_id: experimentId!,
        user_question: trimmedPrompt,
        model,
      },
    })
      .then((submitResponse: any) => {
        setJobId(submitResponse.job_id);
        setJobStatus(submitResponse.status as JobStatus);
        if (submitResponse.run_id) {
          setInsightRunId(submitResponse.run_id as string);
        }

        stopPolling();
        pollingIntervalRef.current = window.setInterval(async () => {
          try {
            const job = (await MlflowService.getJob(submitResponse.job_id)) as { status: JobStatus; run_id?: string };
            setJobStatus(job.status);
            if (job.run_id) {
              setInsightRunId(job.run_id);
            }
            if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'TIMEOUT') {
              stopPolling();
            }
          } catch (error) {
            setJobError((error as Error).message);
            stopPolling();
          }
        }, 2000);
      })
      .catch((error: any) => {
        setJobError((error as Error).message);
        setJobStatus(undefined);
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <Modal
      componentId="mlflow.experiment.trace-insights-launch-modal"
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={AiLogoUrl} alt="AI Logo" height={24} width={24} />
          Generate AI Insights
        </span>
      }
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={1040}
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 6fr)',
          gap: theme.spacing.lg,
          alignItems: 'start',
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          <Typography.Paragraph css={{ marginTop: theme.spacing.xs }} color="secondary">
            Analyze selected traces with AI to identify issues and patterns
          </Typography.Paragraph>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text strong>What would you like to analyze?</Typography.Text>
            <TextArea
              autoSize={{ minRows: 6, maxRows: 10 }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Find common error patterns"
              disabled={isJobStarted}
            />
          </div>

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text strong>LLM Model</Typography.Text>
            <SimpleSelect
              componentId="mlflow.experiment.trace-insights-launch-modal.model-select"
              value={model}
              onChange={(value) => setModel(value)}
              disabled={isJobStarted}
            >
              <SimpleSelectOption value="openai:/gpt-5">GPT-5 (Recommended)</SimpleSelectOption>
              <SimpleSelectOption value="gpt-4o">GPT-4o</SimpleSelectOption>
            </SimpleSelect>
          </div>

          {!isJobStarted ? (
            <>
              <div
                css={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: theme.spacing.sm,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.borders.borderRadiusMd,
                  padding: theme.spacing.md,
                  backgroundColor: theme.colors.backgroundPrimary,
                }}
              >
                <StatTile
                  label="Traces"
                  value={statValues.traces}
                  extra={
                    filterList.length > 0 ? (
                      <Popover.Root modal={false}>
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            aria-label="Show applied filters"
                            css={{
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              margin: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <FilterIcon css={{ color: theme.colors.textSecondary, fontSize: 14 }} />
                          </button>
                        </Popover.Trigger>
                        <Popover.Content sideOffset={8}>
                          <Popover.Arrow />
                          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, minWidth: 220 }}>
                            <Typography.Text strong>Applied filters</Typography.Text>
                            <ul
                              css={{
                                paddingLeft: theme.spacing.md,
                                margin: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                listStyle: 'none',
                              }}
                            >
                              {filterList.map((item, idx) => (
                                <li key={`${item.label}-${idx}`} css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
                                  {item.icon === 'clock' ? (
                                    <ClockIcon css={{ color: theme.colors.textSecondary, fontSize: 12 }} />
                                  ) : (
                                    <FilterIcon css={{ color: theme.colors.textSecondary, fontSize: 12 }} />
                                  )}
                                  <Typography.Text>
                                    {item.label ? (
                                      <>
                                        <Typography.Text>{item.label}</Typography.Text>{' '}
                                        <Typography.Text>{item.text}</Typography.Text>
                                      </>
                                    ) : (
                                      <Typography.Text>{item.text}</Typography.Text>
                                    )}
                                  </Typography.Text>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </Popover.Content>
                      </Popover.Root>
                    ) : null
                  }
                />
                <StatTile label="Est. Cost" value={statValues.cost} />
                <StatTile label="Est. Time" value={statValues.time} />
              </div>

              {traceCountError && (
                <Alert
                  type="error"
                  showIcon
                  message="Unable to fetch trace count"
                  description={traceCountError}
                />
              )}

              <Typography.Text color="secondary">
                Target traces are determined by the current time range and search filters. To change the target traces, please update filters in the previous screen, or manually select traces in the table.
              </Typography.Text>

              <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
                <Button onClick={onCancel}>Cancel</Button>
                <Button
                  type="primary"
                  onClick={handleAnalyze}
                  disabled={!prompt.trim() || isBusy || traceCountLoading}
                  loading={isBusy}
                >
                  Analyze
                </Button>
              </div>
            </>
          ) : (
            <div
              css={{
                marginTop: theme.spacing.sm,
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusMd,
                backgroundColor: theme.colors.backgroundSecondary,
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.xs,
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
                {jobStatus === 'SUCCEEDED' ? (
                  <CheckCircleIcon css={{ color: theme.colors.success, fontSize: 16 }} />
                ) : jobStatus === 'FAILED' || jobStatus === 'TIMEOUT' ? (
                  <QuestionMarkIcon css={{ color: theme.colors.error, fontSize: 16 }} />
                ) : (
                  <AssistantIcon css={{ color: theme.colors.textSecondary, fontSize: 16 }} />
                )}
                <Typography.Text strong>Status</Typography.Text>
              </div>
              <div
                css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.max(0, Math.min(100, Math.round(jobProgress)))}
              >
                <div
                  css={{
                    flex: 1,
                    height: theme.spacing.sm,
                    backgroundColor: theme.colors.backgroundSecondary,
                    borderRadius: theme.spacing.sm,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    css={{
                      height: '100%',
                      width: `${Math.max(0, Math.min(100, Math.round(jobProgress)))}%`,
                      backgroundColor: theme.colors.primary,
                      transition: 'width 200ms ease',
                    }}
                  />
                </div>
                <Typography.Text>{`${jobStatus || 'PENDING'} • ${Math.max(0, Math.min(100, Math.round(jobProgress)))}%`}</Typography.Text>
              </div>
              {jobId && (
                <Typography.Text color="secondary" css={{ fontSize: theme.typography.fontSizeSm }}>
                  Job ID: {jobId}
                </Typography.Text>
              )}
              {jobStatus === 'SUCCEEDED' && insightRunId && experimentId && (
                <Typography.Link
                  href={`/experiments/${experimentId}/insights?selectedInsightId=${insightRunId}`}
                  target="_blank"
                >
                  View insight report
                </Typography.Link>
              )}
              {jobError && (
                <Alert
                  message="Job update failed"
                  description={jobError}
                  type="error"
                  showIcon
                />
              )}
            </div>
          )}
        </div>

        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, borderLeft: `1px solid ${theme.colors.border}`, paddingLeft: theme.spacing.md }}>
          <div
            css={{
              position: 'relative',
              width: '100%',
              minHeight: 260,
              borderRadius: theme.borders.borderRadiusMd,
              overflow: 'hidden',
              border: `1px solid ${theme.colors.border}`,
              background: `linear-gradient(135deg, ${theme.colors.backgroundSecondary}, ${theme.colors.backgroundTertiary})`,
            }}
            aria-hidden
          >
            <div
              css={{
                position: 'absolute',
                inset: theme.spacing.md,
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundPrimary,
                opacity: 0.7,
                boxShadow: `0 10px 30px rgba(15, 23, 42, 0.08)`,
              }}
            />
            <div
              css={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.colors.textSecondary,
              }}
            >
              <Typography.Text>Insight preview placeholder</Typography.Text>
            </div>
          </div>

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            <Typography.Text strong>What you&apos;ll get:</Typography.Text>
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
              {benefits.map((benefit) => (
                <BenefitRow key={benefit.title} title={benefit.title} description={benefit.description} icon={benefit.icon} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default TraceInsightsLaunchModal;
