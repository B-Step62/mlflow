/**
 * Test-case detail drawer for a regression-test run.
 *
 * Opens when a row in the Test cases table is clicked (replacing the generic
 * trace review). Shows the test name + overall Result, the agent Input/Output,
 * and a two-column Assertions/Result table (one row per assertion, with its
 * pass/fail pill + rationale). A "Trace" button still jumps to the raw trace.
 */
import {
  Button,
  Drawer,
  ListIcon,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Tag,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import { EvaluationsReviewTextBox } from './components/EvaluationsReviewTextBox';
import { getEvaluationResultAssessmentValue } from './components/GenAiEvaluationTracesReview.utils';
import type { EvalTraceComparisonEntry } from './types';
import { useMarkdownConverter } from './utils/MarkdownUtils';

const isPass = (v: unknown): boolean =>
  typeof v === 'boolean'
    ? v
    : typeof v === 'number'
      ? v >= 0.5
      : typeof v === 'string'
        ? ['yes', 'pass', 'true'].includes(v.trim().toLowerCase())
        : false;

const readTag = (info: any, key: string): string | undefined => {
  const tags = info?.tags;
  if (Array.isArray(tags)) return tags.find((t: any) => t?.key === key)?.value;
  if (tags && typeof tags === 'object' && tags[key] != null) return String(tags[key]);
  const meta = info?.trace_metadata?.[key];
  return meta != null ? String(meta) : undefined;
};

const stringify = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

// Trace inputs/outputs frequently arrive double-JSON-encoded (a JSON string
// whose decoded value is itself a JSON string). One JSON.parse yields another
// string, not an object — so keep parsing while the result still looks like
// JSON (bounded to avoid runaway).
const deepParse = (v: any): any => {
  let o = v;
  for (let i = 0; i < 4 && typeof o === 'string'; i++) {
    const s = o.trim();
    if (!(s.startsWith('{') || s.startsWith('['))) break;
    try {
      o = JSON.parse(s);
    } catch {
      break;
    }
  }
  return o;
};

const ResultPill = ({ passed }: { passed: boolean }) => (
  <Tag componentId="mlflow.regression-test-detail.result-pill" color={passed ? 'turquoise' : 'coral'} css={{ margin: 0 }}>
    {passed ? (
      <FormattedMessage defaultMessage="Passed" description="Pass status pill in the regression-test detail" />
    ) : (
      <FormattedMessage defaultMessage="Failed" description="Fail status pill in the regression-test detail" />
    )}
  </Tag>
);

export const TestCaseDetail = ({
  evaluation,
  experimentId,
  onClose,
  onPrev,
  onNext,
}: {
  evaluation: EvalTraceComparisonEntry;
  experimentId?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const run = evaluation.currentRunValue;
  const info: any = run?.traceInfo;
  const traceId: string | undefined = info?.trace_id;

  const baseName = readTag(info, 'mlflow.test.name') ?? traceId ?? 'Test case';
  const caseId = readTag(info, 'mlflow.test.case_id');
  const testName = caseId ? `${baseName}[${caseId}]` : baseName;

  // Flatten every assertion (one row each) — multiple guideline assertions can
  // share the default "guidelines" name, so we don't collapse to the first.
  const byName = run?.responseAssessmentsByName ?? {};
  const assertions = Object.entries(byName)
    .filter(([name]) => name !== 'Result')
    .flatMap(([name, arr]) =>
      (arr ?? []).map((a: any, i: number) => {
        const value = getEvaluationResultAssessmentValue(a);
        const rationale = a?.rationale ?? '';
        // Prefer a meaningful assertion name. For generically-named ("guidelines")
        // assertions the rubric text isn't on the trace, so fall back to a
        // guideline in metadata, then to the rationale (the real text we have).
        const named = name && name !== 'guidelines' ? (arr.length > 1 ? `${name} ${i + 1}` : name) : '';
        const metaGuideline = stringify(a?.metadata?.['guideline'] ?? a?.metadata?.['guidelines']);
        const label = named || metaGuideline || rationale || 'Assertion';
        // Avoid repeating the rationale in the Result column when it's the label.
        const resultRationale = label === rationale ? '' : rationale;
        return { label, passed: isPass(value), rationale: resultRationale };
      }),
    );
  const allPassed = assertions.length > 0 && assertions.every((a) => a.passed);

  // Chat-style: when input/output is a messages array, show the last message's
  // text content (the assistant's reply / the user's question) rather than the
  // whole JSON blob. Falls through to the raw value for non-chat shapes.
  const lastMessageContent = (v: any): any => {
    if (v == null) return v;
    const obj = deepParse(v);
    const msgs = Array.isArray(obj) ? obj : Array.isArray(obj?.messages) ? obj.messages : null;
    const last = msgs && msgs.length ? msgs[msgs.length - 1] : undefined;
    if (last && typeof last.content === 'string') return last.content;
    return typeof obj === 'string' ? obj : typeof v === 'string' ? v : obj;
  };
  const input = run?.inputsTitle || lastMessageContent(run?.inputs);
  const output = lastMessageContent(run?.outputs?.['response'] ?? run?.outputs);

  // Rich chat view: if input/output is a messages array, render the turns as
  // chat bubbles. Falls back to the Input/Output text boxes otherwise.
  const { makeHTML } = useMarkdownConverter();
  const parseMessages = (v: any): any[] | null => {
    const o = deepParse(v);
    const m = Array.isArray(o) ? o : Array.isArray(o?.messages) ? o.messages : null;
    if (m && m.length) return m;
    // Trace preview fields are truncated (~1000 chars), so the JSON frequently
    // won't parse. Salvage any complete {content, type/role} message objects we
    // can still read out of the partial string.
    if (typeof v === 'string') {
      const contents = Array.from(v.matchAll(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/g)).map((x) => x[1]);
      const roles = Array.from(v.matchAll(/"(?:type|role)"\s*:\s*"([^"]+)"/g)).map((x) => x[1]);
      if (contents.length) {
        const decode = (s: string) => {
          try {
            return JSON.parse(`"${s}"`);
          } catch {
            return s;
          }
        };
        // The role field can sit past the truncation point; fall back to
        // position (first turn = user, the rest = assistant).
        return contents.map((c, i) => ({ content: decode(c), type: roles[i] ?? (i === 0 ? 'user' : 'assistant') }));
      }
    }
    return null;
  };
  const messages = parseMessages(run?.outputs?.['response'] ?? run?.outputs) ?? parseMessages(run?.inputs);

  return (
    <Drawer.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content
        componentId="mlflow.regression-test-detail.drawer"
        width={640}
        title={
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <Typography.Title level={4} withoutMargins css={{ fontFamily: 'monospace' }}>
              {testName}
            </Typography.Title>
            <ResultPill passed={allPassed} />
          </div>
        }
      >
        <div css={{ display: 'flex', gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
          {traceId && experimentId && (
            <Button
              componentId="mlflow.regression-test-detail.open-trace"
              icon={<ListIcon />}
              onClick={() => {
                window.location.hash = `#/experiments/${experimentId}/traces?selectedTraceId=${traceId}`;
              }}
            >
              <FormattedMessage defaultMessage="Trace" description="Button to open the raw trace from the detail" />
            </Button>
          )}
          <Button componentId="mlflow.regression-test-detail.prev" onClick={onPrev} disabled={!onPrev}>
            <FormattedMessage defaultMessage="Previous" description="Previous test case" />
          </Button>
          <Button componentId="mlflow.regression-test-detail.next" onClick={onNext} disabled={!onNext}>
            <FormattedMessage defaultMessage="Next" description="Next test case" />
          </Button>
        </div>

        {messages ? (
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
            {messages.map((m: any, i: number) => {
              const role = String(m?.type ?? m?.role ?? '').toLowerCase();
              const isUser = role === 'human' || role === 'user';
              const roleLabel = isUser
                ? 'User'
                : role === 'ai' || role === 'assistant'
                  ? 'Assistant'
                  : role || 'Message';
              const content = typeof m?.content === 'string' ? m.content : stringify(m?.content);
              if (!content) return null;
              return (
                <div
                  key={i}
                  css={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%', minWidth: 0 }}
                >
                  <Typography.Text
                    color="secondary"
                    css={{ display: 'block', fontSize: 12, marginBottom: 2, textAlign: isUser ? 'right' : 'left' }}
                  >
                    {roleLabel}
                  </Typography.Text>
                  <div
                    css={{
                      padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                      borderRadius: theme.legacyBorders.borderRadiusMd,
                      backgroundColor: isUser
                        ? theme.colors.actionPrimaryBackgroundDefault
                        : theme.colors.backgroundSecondary,
                      color: isUser ? theme.colors.actionPrimaryTextDefault : theme.colors.textPrimary,
                      overflowWrap: 'break-word',
                    }}
                  >
                    {/* eslint-disable-next-line react/no-danger */}
                    <span css={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: makeHTML(content || '') || '' }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div css={{ marginBottom: theme.spacing.lg }}>
              <EvaluationsReviewTextBox
                fieldName="regression-test-input"
                title={<FormattedMessage defaultMessage="Input" description="Agent input section in the detail" />}
                value={input}
                showCopyIcon
              />
            </div>
            <div css={{ marginBottom: theme.spacing.lg }}>
              <EvaluationsReviewTextBox
                fieldName="regression-test-output"
                title={<FormattedMessage defaultMessage="Output" description="Agent output section in the detail" />}
                value={output}
                showCopyIcon
              />
            </div>
          </>
        )}

        <div
          css={{
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.legacyBorders.borderRadiusMd,
            overflow: 'hidden',
          }}
        >
          <Table>
            <TableRow isHeader>
              <TableHeader componentId="mlflow.regression-test-detail.col-assertion" css={{ flexGrow: 1 }}>
                <FormattedMessage defaultMessage="Assertions" description="Assertions column header" />
              </TableHeader>
              <TableHeader componentId="mlflow.regression-test-detail.col-result" css={{ flexGrow: 1 }}>
                <FormattedMessage defaultMessage="Result" description="Result column header" />
              </TableHeader>
            </TableRow>
            {assertions.length === 0 ? (
              <TableRow>
                <TableCell css={{ flexGrow: 1 }}>
                  <Typography.Text color="secondary">
                    {intl.formatMessage({
                      defaultMessage: 'No assertions recorded for this test.',
                      description: 'Empty assertions state in the regression-test detail',
                    })}
                  </Typography.Text>
                </TableCell>
              </TableRow>
            ) : (
              assertions.map((a, i) => (
                <TableRow key={`${a.label}-${i}`}>
                  <TableCell css={{ flexGrow: 1, alignItems: 'flex-start' }}>
                    <Typography.Text>{a.label}</Typography.Text>
                  </TableCell>
                  <TableCell
                    css={{ flexGrow: 1, flexDirection: 'column', alignItems: 'flex-start', gap: theme.spacing.xs }}
                  >
                    <ResultPill passed={a.passed} />
                    {a.rationale && <Typography.Text color="secondary">{a.rationale}</Typography.Text>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </Table>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};
