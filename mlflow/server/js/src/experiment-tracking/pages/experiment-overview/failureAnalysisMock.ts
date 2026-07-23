export const MOCK_FAILURE_ANALYSIS_RUN_ID = 'mock-failure-analysis-run';

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

export const TRACE_ACTIVITY_HOURS = [
  { label: '12 AM', count: 0 },
  { label: '1 AM', count: 0 },
  { label: '2 AM', count: 0 },
  { label: '3 AM', count: 0 },
  { label: '4 AM', count: 0 },
  { label: '5 AM', count: 0 },
  { label: '6 AM', count: 0 },
  { label: '7 AM', count: 0 },
  { label: '8 AM', count: 1 },
  { label: '9 AM', count: 1 },
  { label: '10 AM', count: 0 },
  { label: '11 AM', count: 0 },
  { label: '12 PM', count: 0 },
  { label: '1 PM', count: 0 },
  { label: '2 PM', count: 1 },
  { label: '3 PM', count: 2 },
  { label: '4 PM', count: 0 },
  { label: '5 PM', count: 0 },
  { label: '6 PM', count: 0 },
  { label: '7 PM', count: 0 },
  { label: '8 PM', count: 0 },
  { label: '9 PM', count: 0 },
  { label: '10 PM', count: 0 },
  { label: '11 PM', count: 0 },
];

export const FAILURE_ANALYSIS_SUMMARY = [
  '### Candidate failure clusters',
  '',
  ...FAILURE_ANALYSIS_CLUSTERS.map(
    (cluster) =>
      `- **${cluster.title}**: ${cluster.count} of ${FAILURE_ANALYSIS_TOTAL_CONVERSATIONS.toLocaleString()} conversations. ${cluster.description}`,
  ),
].join('\n');
