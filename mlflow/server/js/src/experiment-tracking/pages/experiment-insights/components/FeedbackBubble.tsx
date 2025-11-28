import React, { useEffect, useState } from 'react';
import {
  useDesignSystemTheme,
  Typography,
  LegacySkeleton,
  Tag,
  SpeechBubbleIcon,
} from '@databricks/design-system';
import { MlflowService } from '../../../sdk/MlflowService';
import Utils from '../../../../common/utils/Utils';
import { Assessment, ModelTraceInfoV3 } from '../../../../shared/web-shared/model-trace-explorer/ModelTrace.types';

type FeedbackBubbleProps = {
  assessmentId?: string;
  traceId?: string;
};

export const FeedbackBubble: React.FC<FeedbackBubbleProps> = ({ assessmentId, traceId }) => {
  const { theme } = useDesignSystemTheme();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAssessment = async () => {
      if (!traceId || !assessmentId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const traceInfoResponse = await MlflowService.getExperimentTraceInfoV3(traceId);
        
        const traceInfo = traceInfoResponse?.trace?.trace_info as unknown as ModelTraceInfoV3;
        
        if (traceInfo && traceInfo.assessments) {
          const found = traceInfo.assessments.find((a: Assessment) => a.assessment_id === assessmentId);
          if (found) {
            setAssessment(found);
          } else {
             setError('Assessment not found in trace');
          }
        } else {
           setError('Trace info or assessments not found');
        }
      } catch (err: any) {
        console.error('Failed to fetch assessment', err);
        setError(err.message || 'Failed to fetch assessment');
      } finally {
        setLoading(false);
      }
    };

    fetchAssessment();
  }, [assessmentId, traceId]);

  if (loading) {
    return (
       <div css={{
        padding: theme.spacing.md,
        background: theme.colors.backgroundSecondary,
        borderRadius: theme.borders.borderRadiusMd,
        width: '100%',
      }}>
        <LegacySkeleton active paragraph={{ rows: 2 }} />
      </div>
    );
  }

  if (error || !assessment) {
    // Fallback or error state - maybe just show IDs if fetch fails?
    return (
       <div css={{
        padding: theme.spacing.md,
        background: theme.colors.backgroundSecondary,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px dashed ${theme.colors.borderDecorative}`,
        color: theme.colors.textSecondary,
      }}>
        <Typography.Text size="sm">
           {error || 'Assessment details unavailable'} ({assessmentId})
        </Typography.Text>
      </div>
    );
  }

  // Construct bubble content
  const getRationaleText = (text?: string) => {
    if (!text) return 'No rationale provided';
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && parsed.comment) {
        return parsed.comment;
      }
    } catch {
      // Ignore JSON parse errors
    }
    return text;
  };

  const displayText = getRationaleText(assessment.rationale);

  return (
    <div css={{
      display: 'flex',
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      background: theme.colors.backgroundSecondary,
      borderRadius: theme.borders.borderRadiusMd,
      borderLeft: `4px solid ${theme.colors.blue300}`,
    }}>
      <SpeechBubbleIcon css={{ color: theme.colors.textSecondary, marginTop: 2, flexShrink: 0 }} />
      <div css={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <Typography.Text css={{ fontStyle: 'italic' }}>
          "{displayText}"
        </Typography.Text>
        {/* Always-bottom bar for metadata */}
        <div
          css={{
            display: 'flex',
            gap: theme.spacing.xs,
            alignItems: 'center',
            marginTop: 'auto', // Push this to the bottom of the flex container
            minHeight: 24,
          }}
        >
          {assessment.source?.source_id && (
            <Tag componentId="assessment-source-id-tag">{assessment.source.source_id}</Tag>
          )}
          <Typography.Text size="sm" color="secondary">
            {assessment.create_time
              ? new Date(assessment.create_time).toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
};

