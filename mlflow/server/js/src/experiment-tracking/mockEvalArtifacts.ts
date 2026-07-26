import type { Dataset, DatasetRecord } from './pages/experiment-evaluation-datasets-v2/hooks/useDatasetsQueries';
import type { ScheduledScorer } from './pages/experiment-scorers/types';

type IssueLike = {
  issue_id: string;
  name: string;
  source_run_id?: string;
  trace_count?: number;
  example_trace_ids?: string[];
};

export type MockEvalLinkedItems = {
  dataset: {
    datasetId: string;
    name: string;
    traceCount: number;
    existingRecordCount?: number;
  };
  scorers: Array<{
    name: string;
    type: string;
  }>;
};

export type MockEvalDatasetMode = 'new' | 'golden';

type MockEvalArtifactBundle = MockEvalLinkedItems & {
  issueId: string;
  issueName: string;
  sourceJobId?: string;
  traceIds: string[];
  goldenDataset: {
    datasetId: string;
    name: string;
    existingRecordCount: number;
  };
  recordTemplates: Array<{
    question: string;
    response: string;
    expected: string;
    evidence: string;
  }>;
  scorerGuidelines: Record<string, string[]>;
};

const CREATED_AT = '2026-07-23T17:12:00.000Z';

const MOCK_EVAL_ARTIFACTS_BY_ISSUE_ID = {
  'iss-wrong-asset-class': {
    issueId: 'iss-wrong-asset-class',
    issueName: 'Cites the wrong asset class',
    sourceJobId: 'job_7d3f9a21c',
    traceIds: ['trace-a17', 'trace-b42', 'trace-c09'],
    dataset: { datasetId: 'wrong_asset_class_regression', name: 'wrong_asset_class_regression', traceCount: 42 },
    goldenDataset: {
      datasetId: 'investment_advisor_golden',
      name: 'investment_advisor_golden',
      existingRecordCount: 186,
    },
    scorers: [
      { name: 'asset_class_consistency', type: 'LLM judge' },
      { name: 'retrieval_answer_alignment', type: 'LLM judge' },
    ],
    recordTemplates: [
      {
        question: 'Can I keep this emergency reserve in short-term bonds without taking equity risk?',
        response: 'A broad equity index fund is appropriate because stocks provide long-term upside.',
        expected: 'Answer in the requested bond/cash-equivalent context and avoid equity recommendations.',
        evidence: 'Retrieved context identified Treasury bills and money market funds as cash-equivalent options.',
      },
      {
        question: 'Which bond fund option is least sensitive to rate changes?',
        response: 'Large-cap equities are usually less volatile than small-cap growth.',
        expected: 'Compare duration and credit risk for bond funds, not equity categories.',
        evidence: 'Retrieved context included ultra-short bond and short-term Treasury fund descriptions.',
      },
      {
        question: 'Is a cash sweep account better than a municipal bond ladder for taxes?',
        response: 'Dividend-paying stocks can improve tax efficiency for taxable accounts.',
        expected: 'Discuss cash sweep yield, municipal bond tax treatment, and liquidity tradeoffs.',
        evidence: 'Retrieved context contained a municipal bond tax note and cash sweep APY disclosure.',
      },
    ],
    scorerGuidelines: {
      asset_class_consistency: [
        'Pass only when the response preserves the asset class requested by the user.',
        'Fail if the response substitutes equities, stocks, or unrelated investment categories.',
        'Use retrieved context as the source of truth for the asset class under discussion.',
      ],
      retrieval_answer_alignment: [
        'Pass only when the final answer is supported by the retrieved passages.',
        'Fail if the response introduces recommendations that are absent from the retrieved evidence.',
      ],
    },
  },
  'iss-refund-policy': {
    issueId: 'iss-refund-policy',
    issueName: 'Refund policy answer contradicts source',
    sourceJobId: 'job_7d3f9a21c',
    traceIds: ['trace-f31', 'trace-h88', 'trace-k14'],
    dataset: { datasetId: 'refund_policy_regression', name: 'refund_policy_regression', traceCount: 21 },
    goldenDataset: {
      datasetId: 'customer_support_golden',
      name: 'customer_support_golden',
      existingRecordCount: 142,
    },
    scorers: [
      { name: 'policy_consistency', type: 'LLM judge' },
      { name: 'source_groundedness', type: 'LLM judge' },
    ],
    recordTemplates: [
      {
        question: 'Can I return an opened item after 45 days?',
        response: 'Yes, opened items are refundable for 60 days with the original receipt.',
        expected: 'State that opened items are refundable for 30 days unless the current policy says otherwise.',
        evidence: 'Retrieved policy says opened items must be returned within 30 days.',
      },
      {
        question: 'What is the refund window for clearance products?',
        response: 'Clearance products follow the standard 90-day refund window.',
        expected: 'State that clearance products are final sale when the retrieved policy says final sale.',
        evidence: 'Retrieved policy lists clearance products as final sale.',
      },
      {
        question: 'Do I need the card I used for the original purchase?',
        response: 'No, refunds can always be issued as cash.',
        expected: 'Explain that refunds return to the original payment method when available.',
        evidence: 'Retrieved policy says refunds are credited to the original payment method.',
      },
    ],
    scorerGuidelines: {
      policy_consistency: [
        'Pass only when the answer matches the retrieved policy window and exceptions.',
        'Fail if the answer repeats stale policy details contradicted by retrieved context.',
      ],
      source_groundedness: [
        'Pass only when every policy claim can be traced to the retrieved source.',
        'Fail if the assistant invents refund terms, windows, or exceptions.',
      ],
    },
  },
  'iss-ignored-tool-result': {
    issueId: 'iss-ignored-tool-result',
    issueName: 'Tool result ignored after retry',
    sourceJobId: 'job_7d3f9a21c',
    traceIds: ['trace-m02', 'trace-n77', 'trace-p06'],
    dataset: { datasetId: 'tool_retry_regression', name: 'tool_retry_regression', traceCount: 14 },
    goldenDataset: {
      datasetId: 'agent_tool_handoff_golden',
      name: 'agent_tool_handoff_golden',
      existingRecordCount: 96,
    },
    scorers: [
      { name: 'latest_successful_tool_result', type: 'LLM judge' },
      { name: 'retry_handoff_correctness', type: 'LLM judge' },
    ],
    recordTemplates: [
      {
        question: 'Track order 9482 and tell me the current delivery date.',
        response: 'I could not retrieve the order, so please contact support.',
        expected: 'Use the successful retry result and report the July 25 delivery date.',
        evidence: 'First tool call timed out; retry returned delivery date July 25.',
      },
      {
        question: 'Check whether invoice INV-223 was paid.',
        response: 'The invoice lookup failed, so payment status is unknown.',
        expected: 'Use the successful retry result and state that the invoice was paid on July 18.',
        evidence: 'Retry returned paid=true and paid_at=2026-07-18.',
      },
      {
        question: 'Can you confirm the support ticket priority?',
        response: 'The ticket service is unavailable, so I cannot confirm priority.',
        expected: 'Use the retry result and report priority P1.',
        evidence: 'Retry returned priority=P1 and status=open.',
      },
    ],
    scorerGuidelines: {
      latest_successful_tool_result: [
        'Pass only when the final answer uses the latest successful tool output.',
        'Fail if the response is based on a failed or timed-out earlier tool call.',
      ],
      retry_handoff_correctness: [
        'Pass only when the assistant acknowledges and uses the successful retry state.',
        'Fail if the response claims the task is impossible after a later retry succeeded.',
      ],
    },
  },
} satisfies Record<string, MockEvalArtifactBundle>;

const slugifyIssueName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

const truncate = (value: string, maxLength = 16) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const createFallbackBundle = (datasetId: string): MockEvalArtifactBundle => {
  const issueName = datasetId.replace(/_regression$/, '').replace(/_/g, ' ');
  return {
    issueId: `iss-${datasetId}`,
    issueName,
    sourceJobId: 'job_7d3f9a21c',
    traceIds: ['trace-s01', 'trace-s02', 'trace-s03'],
    dataset: { datasetId, name: datasetId, traceCount: 3 },
    goldenDataset: {
      datasetId: 'agent_quality_golden',
      name: 'agent_quality_golden',
      existingRecordCount: 120,
    },
    scorers: [
      { name: `${datasetId.replace(/_regression$/, '')}_judge`, type: 'LLM judge' },
      { name: 'source_alignment', type: 'LLM judge' },
    ],
    recordTemplates: [
      {
        question: `Representative question for ${issueName}`,
        response: 'The assistant response reproduces the detected failure mode.',
        expected: 'The assistant should avoid the detected failure mode and stay grounded in trace evidence.',
        evidence: 'Representative trace evidence selected by issue detection.',
      },
    ],
    scorerGuidelines: {},
  };
};

const getPredefinedEvalArtifactBundle = (issue: IssueLike): MockEvalArtifactBundle | undefined => {
  const predefinedById = (MOCK_EVAL_ARTIFACTS_BY_ISSUE_ID as Partial<Record<string, MockEvalArtifactBundle>>)[
    issue.issue_id
  ];
  if (predefinedById) {
    return predefinedById;
  }
  return Object.values(MOCK_EVAL_ARTIFACTS_BY_ISSUE_ID).find((bundle) => bundle.issueName === issue.name);
};

const getGoldenLinkedItems = (bundle: MockEvalArtifactBundle): MockEvalLinkedItems => ({
  dataset: {
    datasetId: bundle.goldenDataset.datasetId,
    name: bundle.goldenDataset.name,
    traceCount: bundle.dataset.traceCount,
    existingRecordCount: bundle.goldenDataset.existingRecordCount,
  },
  scorers: bundle.scorers,
});

export const getEvalLinkedItems = (issue: IssueLike, datasetMode: MockEvalDatasetMode = 'new'): MockEvalLinkedItems => {
  const predefinedItems = getPredefinedEvalArtifactBundle(issue);
  if (predefinedItems) {
    if (datasetMode === 'golden') {
      return getGoldenLinkedItems(predefinedItems);
    }
    return {
      dataset: predefinedItems.dataset,
      scorers: predefinedItems.scorers,
    };
  }
  const slug = slugifyIssueName(issue.name);
  if (datasetMode === 'golden') {
    return {
      dataset: {
        datasetId: 'agent_quality_golden',
        name: 'agent_quality_golden',
        traceCount: issue.trace_count ?? issue.example_trace_ids?.length ?? 0,
        existingRecordCount: 120,
      },
      scorers: [
        { name: `${slug}_judge`, type: 'LLM judge' },
        { name: 'source_alignment', type: 'LLM judge' },
      ],
    };
  }
  return {
    dataset: {
      datasetId: `${slug}_regression`,
      name: `${slug}_regression`,
      traceCount: issue.trace_count ?? issue.example_trace_ids?.length ?? 0,
    },
    scorers: [
      { name: `${slug}_judge`, type: 'LLM judge' },
      { name: 'source_alignment', type: 'LLM judge' },
    ],
  };
};

const getBundleByDatasetId = (datasetId: string): MockEvalArtifactBundle | undefined => {
  const predefined = Object.values(MOCK_EVAL_ARTIFACTS_BY_ISSUE_ID).find(
    (bundle) => bundle.dataset.datasetId === datasetId || bundle.goldenDataset.datasetId === datasetId,
  );
  if (predefined) {
    return predefined;
  }
  return datasetId.endsWith('_regression') ? createFallbackBundle(datasetId) : undefined;
};

export const getMockEvalDataset = (datasetId?: string): Dataset | undefined => {
  if (!datasetId) {
    return undefined;
  }
  const bundle = getBundleByDatasetId(datasetId);
  if (!bundle) {
    return undefined;
  }
  return {
    dataset_id: datasetId,
    name: datasetId === bundle.goldenDataset.datasetId ? bundle.goldenDataset.name : bundle.dataset.name,
    created_by: 'MLflow Assistant',
    last_updated_by: 'MLflow Assistant',
    create_time: CREATED_AT,
    last_update_time: CREATED_AT,
    digest: `mock-${datasetId}`,
    source: bundle.sourceJobId,
    source_type: 'issue_detection',
    profile: JSON.stringify({
      issue_id: bundle.issueId,
      source_job: bundle.sourceJobId,
      trace_count:
        datasetId === bundle.goldenDataset.datasetId
          ? bundle.goldenDataset.existingRecordCount + bundle.dataset.traceCount
          : bundle.dataset.traceCount,
    }),
  };
};

const getExistingGoldenRecords = (bundle: MockEvalArtifactBundle): DatasetRecord[] => [
  {
    dataset_record_id: `${bundle.goldenDataset.datasetId}-existing-1`,
    create_time: '2026-06-12T15:10:00.000Z',
    created_by: 'quality-team@databricks.com',
    last_update_time: '2026-06-12T15:10:00.000Z',
    last_updated_by: 'quality-team@databricks.com',
    source: { human: { user_name: 'quality-team@databricks.com' } },
    inputs: {
      question: 'Existing golden example for stable answer formatting',
      retrieved_evidence: 'Curated expected behavior from prior release validation.',
    },
    expectations: {
      expected_response: 'Answer should be grounded, concise, and aligned with the retrieved evidence.',
    },
    tags: {
      dataset_type: 'golden',
      source: 'curated',
    },
  },
  {
    dataset_record_id: `${bundle.goldenDataset.datasetId}-existing-2`,
    create_time: '2026-06-18T18:45:00.000Z',
    created_by: 'quality-team@databricks.com',
    last_update_time: '2026-06-18T18:45:00.000Z',
    last_updated_by: 'quality-team@databricks.com',
    source: { human: { user_name: 'quality-team@databricks.com' } },
    inputs: {
      question: 'Existing golden example for source-grounded answer synthesis',
      retrieved_evidence: 'Curated source passage used for regression testing.',
    },
    expectations: {
      expected_response: 'Answer should not introduce unsupported details.',
    },
    tags: {
      dataset_type: 'golden',
      source: 'curated',
    },
  },
];

export const getMockEvalDatasetRecords = (datasetId: string): DatasetRecord[] | undefined => {
  const bundle = getBundleByDatasetId(datasetId);
  if (!bundle) {
    return undefined;
  }
  const traceIds = bundle.traceIds.length ? bundle.traceIds : ['trace-s01'];
  const issueRecords = bundle.recordTemplates.map((record, index) => {
    const traceId = traceIds[index % traceIds.length];
    return {
      dataset_record_id: `${datasetId}-record-${index + 1}`,
      create_time: CREATED_AT,
      created_by: 'MLflow Assistant',
      last_update_time: CREATED_AT,
      last_updated_by: 'MLflow Assistant',
      source: { trace: { trace_id: traceId } },
      inputs: {
        question: record.question,
        retrieved_evidence: record.evidence,
      },
      expectations: {
        expected_response: record.expected,
        should_fail_current_agent: true,
      },
      tags: {
        issue_id: bundle.issueId,
        issue: bundle.issueName,
        source_job: bundle.sourceJobId ?? '',
        trace_id: traceId,
        added_by: 'MLflow Assistant',
      },
    };
  });
  return datasetId === bundle.goldenDataset.datasetId
    ? [...getExistingGoldenRecords(bundle), ...issueRecords]
    : issueRecords;
};

export const getMockEvalScorers = (scorerNames: string[]): ScheduledScorer[] =>
  scorerNames.map((name) => {
    const bundle = Object.values(MOCK_EVAL_ARTIFACTS_BY_ISSUE_ID).find((artifact) =>
      artifact.scorers.some((scorer) => scorer.name === name),
    );
    const scorerGuidelines = bundle?.scorerGuidelines as Partial<Record<string, string[]>> | undefined;
    const guidelines = scorerGuidelines?.[name] ?? [
      'Pass only when the response avoids the issue pattern represented in the linked dataset.',
      'Fail when the response repeats the same failure mode found by issue detection.',
      'Use retrieved trace evidence and expectations as the source of truth.',
    ];
    return {
      name,
      type: 'llm',
      llmTemplate: 'Guidelines',
      guidelines,
      model: 'openai:/gpt-4.1-mini',
      sampleRate: 0,
      filterString: bundle?.sourceJobId ? `source.job_id = "${truncate(bundle.sourceJobId)}"` : undefined,
      version: 1,
      is_instructions_judge: false,
    };
  });

export const parseMockScorerNames = (value: string | null): string[] =>
  value
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean) ?? [];
