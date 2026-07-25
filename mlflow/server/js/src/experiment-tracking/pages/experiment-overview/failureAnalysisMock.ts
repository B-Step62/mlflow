export const MOCK_FAILURE_ANALYSIS_RUN_ID = 'job_7d3f9a21c';

export const FAILURE_ANALYSIS_TOTAL_CONVERSATIONS = 1240;

export const FAILURE_ANALYSIS_CLUSTERS = [
  {
    id: 'wrong-asset-class',
    title: 'Cites the wrong asset class',
    count: 38,
    description: 'The assistant cites equities when the user asked about bonds or cash equivalents.',
    exampleTraceIds: ['trace-a17', 'trace-b42', 'trace-c09'],
  },
  {
    id: 'refund-policy',
    title: 'Refund policy answer contradicts source',
    count: 21,
    description: 'The response gives outdated policy details after the retrieval tool returns the current policy.',
    exampleTraceIds: ['trace-f31', 'trace-h88', 'trace-k14'],
  },
  {
    id: 'ignored-tool-result',
    title: 'Tool result ignored after retry',
    count: 14,
    description: 'The final answer follows the failed first tool response instead of the successful retry.',
    exampleTraceIds: ['trace-m02', 'trace-n77', 'trace-p06'],
  },
];

export const MOCK_FAILURE_ANALYSIS_ISSUES = [
  {
    issue_id: 'iss-wrong-asset-class',
    experiment_id: '0',
    name: 'Cites the wrong asset class',
    description:
      'The assistant answers with equity-market terminology when the user asks about bonds or cash equivalents. The issue appears after retrieval returns mixed investment content and the final response does not preserve the requested asset class.',
    severity: 'high',
    status: 'pending',
    source_run_id: MOCK_FAILURE_ANALYSIS_RUN_ID,
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 23, 17, 12, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 23, 17, 12, 0),
    categories: ['correctness', 'relevance'],
    trace_count: 38,
    example_trace_ids: ['trace-a17', 'trace-b42', 'trace-c09'],
    recommendation:
      'Add an asset-class guardrail to the answer synthesis step and evaluate responses against retrieved source type.',
  },
  {
    issue_id: 'iss-refund-policy',
    experiment_id: '0',
    name: 'Refund policy answer contradicts source',
    description:
      'The final answer states an outdated refund window even though the retrieval tool returns the current policy. Most examples include a correct retrieved passage followed by an unsupported final answer.',
    severity: 'medium',
    status: 'pending',
    source_run_id: MOCK_FAILURE_ANALYSIS_RUN_ID,
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 23, 17, 12, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 23, 17, 12, 0),
    categories: ['correctness', 'adherence'],
    trace_count: 21,
    example_trace_ids: ['trace-f31', 'trace-h88', 'trace-k14'],
    recommendation:
      'Prefer the latest retrieved policy snippet in the final answer and add a judge that checks policy-window consistency.',
  },
  {
    issue_id: 'iss-ignored-tool-result',
    experiment_id: '0',
    name: 'Tool result ignored after retry',
    description:
      'When the first tool call fails and a retry succeeds, the assistant often follows the failed response instead of the successful retry. These traces show correct tool output available before generation.',
    severity: 'medium',
    status: 'pending',
    source_run_id: MOCK_FAILURE_ANALYSIS_RUN_ID,
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 23, 17, 12, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 23, 17, 12, 0),
    categories: ['execution', 'adherence'],
    trace_count: 14,
    example_trace_ids: ['trace-m02', 'trace-n77', 'trace-p06'],
    recommendation:
      'Update the tool-result reducer to keep the latest successful retry and add regression traces for retry handoff.',
  },
] as const;

export const RECENT_ACTIVITY = [
  {
    id: 'jul-21',
    label: 'Tue, Jul 21',
    items: [
      {
        id: 'traces-jul-21',
        title: 'Traces logged',
        description: '3 traces captured from chat sessions',
        age: '2 days ago',
      },
    ],
  },
  {
    id: 'jul-17',
    label: 'Fri, Jul 17',
    items: [
      {
        id: 'traces-jul-17',
        title: 'Traces logged',
        description: '2 traces captured from chat sessions',
        age: '6 days ago',
      },
    ],
  },
];

export const TRACE_ACTIVITY_DAYS = [
  { label: 'Fri 17', count: 2 },
  { label: 'Sat 18', count: 0 },
  { label: 'Sun 19', count: 0 },
  { label: 'Mon 20', count: 0 },
  { label: 'Tue 21', count: 3 },
  { label: 'Wed 22', count: 0 },
  { label: 'Thu 23', count: 0 },
];

export const FAILURE_ANALYSIS_SUMMARY = [
  '### Candidate failure clusters',
  '',
  ...FAILURE_ANALYSIS_CLUSTERS.map(
    (cluster) =>
      `- **${cluster.title}**: ${cluster.count} of ${FAILURE_ANALYSIS_TOTAL_CONVERSATIONS.toLocaleString()} conversations. ${cluster.description}`,
  ),
].join('\n');
