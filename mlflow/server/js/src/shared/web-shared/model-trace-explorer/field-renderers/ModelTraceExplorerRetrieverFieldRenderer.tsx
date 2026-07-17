import { useMemo } from 'react';

import { Typography, useDesignSystemTheme } from '@databricks/design-system';

import type { Assessment, FeedbackAssessment, RetrieverDocument } from '../ModelTrace.types';
import { buildDocumentRelevanceAssessmentMap } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerRetrieverDocument } from '../right-pane/ModelTraceExplorerRetrieverDocument';

export const ModelTraceExplorerRetrieverFieldRenderer = ({
  title,
  titleSuffix,
  documents,
  assessments,
}: {
  title: string;
  titleSuffix?: React.ReactNode;
  documents: RetrieverDocument[];
  assessments?: Assessment[];
}) => {
  const { theme } = useDesignSystemTheme();

  // Build a map from document index to relevance assessment
  const documentRelevanceMap = useMemo(() => buildDocumentRelevanceAssessmentMap(assessments ?? []), [assessments]);

  return (
    <div
      data-testid="model-trace-explorer-retriever-field-renderer"
      css={{
        backgroundColor: theme.colors.backgroundPrimary,
        borderRadius: theme.borders.borderRadiusSm,
        border: `1px solid ${theme.colors.border}`,
        marginInline: theme.spacing.sm,
      }}
    >
      {(title || titleSuffix) && (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          {title && <Typography.Text bold>{title}</Typography.Text>}
          {titleSuffix}
        </div>
      )}
      {documents.map((document, idx) => (
        <div key={idx} css={{ borderBottom: idx !== documents.length - 1 ? `1px solid ${theme.colors.border}` : '' }}>
          <ModelTraceExplorerRetrieverDocument
            key={idx}
            text={document.page_content}
            metadata={document.metadata}
            relevanceAssessment={documentRelevanceMap.get(idx) as FeedbackAssessment | undefined}
          />
        </div>
      ))}
    </div>
  );
};
