import React from 'react';
import {
  Drawer,
  Typography,
  Button,
  Tag,
  useDesignSystemTheme,
  CopyIcon,
  Spacer,
  WrenchSparkleIcon,
  ArrowLeftIcon,
  MenuIcon,
  LightningIcon,
  SpeechBubbleIcon,
  UserGroupIcon,
  SchemaIcon,
} from '@databricks/design-system';
import { SeverityIcon } from './SeverityIcon';
import { FeedbackBubble } from './FeedbackBubble';
import { TracesView } from '../../../components/traces/TracesView';
import { 
  shouldEnableTracesV3View, 
  isExperimentEvalResultsMonitoringUIEnabled 
} from '../../../../common/utils/FeatureUtils';
import { TracesV3View } from '../../../components/experiment-page/components/traces-v3/TracesV3View';

type InsightIssueDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  issue?: {
    name: string;
    description?: string;
    severity?: string;
    impactedCount?: number;
    traceIds?: string[];
    evidences?: { assessment_id?: string; trace_id?: string }[];
  };
  experimentId: string;
  totalTraces?: number;
};

const TracesComponent = ({ experimentIds }: { experimentIds: string[] }) => {
  return <TracesV3View experimentIds={experimentIds} />;
};

export const InsightIssueDrawer: React.FC<InsightIssueDrawerProps> = ({
  isOpen,
  onClose,
  issue,
  experimentId,
  totalTraces = 10,
}) => {
  const { theme } = useDesignSystemTheme();

  if (!issue) {
    return null;
  }

  const traceCount = issue.impactedCount || issue.traceIds?.length || 0;
  const percentage = totalTraces > 0 ? Math.round((traceCount / totalTraces) * 100) : 0;

  return (
    <Drawer.Root modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content
        componentId="insight-issue-drawer"
        title={
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
            <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <SeverityIcon severity={issue.severity} />
                <Typography.Title level={3} css={{ marginTop: '0.5rem' }}>
                  {issue.name}
                </Typography.Title>
              </div>
              <div css={{ display: 'flex', gap: theme.spacing.sm }}>
                <Button componentId="drawer-copy-btn" icon={<CopyIcon />} />
                <Button componentId="drawer-create-judge-btn" icon={<WrenchSparkleIcon />}>
                  Create LLM Judge
                </Button>
              </div>
            </div>
          </div>
        }
        width="70vw"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg, height: '100%', marginTop: theme.spacing.md}}>
          {/* Overview and Impacted Traces */}
          <div css={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.md }}>
             <div css={{ 
               border: `1px solid ${theme.colors.borderDecorative}`, 
               borderRadius: theme.borders.borderRadiusMd, 
               padding: theme.spacing.md 
             }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                 <MenuIcon css={{ color: theme.colors.textSecondary, width: 20, height: 20 }} />
                 <Typography.Title level={4}>Overview</Typography.Title>
               </div>
               <Typography.Paragraph color="secondary" css={{ marginBottom: 0 }}>
                 {issue.description || 'No description available.'}
               </Typography.Paragraph>
             </div>
            <div
              css={{
                border: `1px solid ${theme.colors.borderDecorative}`,
                borderRadius: theme.borders.borderRadiusMd,
                padding: theme.spacing.md,
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <LightningIcon css={{ color: theme.colors.textSecondary, width: 20, height: 20 }} />
                <Typography.Title level={4} css={{ marginBottom: 0 }}>
                  Impacted Traces
                </Typography.Title>
              </div>
              <div css={{ marginBottom: theme.spacing.md }}>
                <span css={{ fontSize: 24, fontWeight: 'bold' }}>{traceCount}</span>
                <span css={{ color: theme.colors.textSecondary, marginLeft: theme.spacing.xs }}>
                  / {totalTraces} ({percentage}%)
                </span>
              </div>
              <div
                css={{
                  width: '100%',
                  height: 8,
                  backgroundColor: theme.colors.backgroundSecondary,
                  borderRadius: theme.borders.borderRadiusMd,
                  overflow: 'hidden',
                  marginBottom: theme.spacing.lg,
                }}
              >
                <div
                  css={{
                    width: `${percentage}%`,
                    height: '100%',
                    backgroundColor: theme.colors.blue400,
                    borderRadius: theme.borders.borderRadiusMd,
                  }}
                />
              </div>
              
              <Typography.Title level={4} css={{ marginBottom: theme.spacing.md }}>
                Subcategories
              </Typography.Title>
              
              <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                <div
                  css={{
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.borderDecorative}`,
                    borderRadius: theme.borders.borderRadiusMd,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    '&:hover': {
                        backgroundColor: theme.colors.actionDefaultBackgroundHover,
                    }
                  }}
                >
                    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <SeverityIcon severity="high" />
                        <Typography.Text>API Version Mismatches</Typography.Text>
                    </div>
                    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Typography.Text color="secondary">45 traces</Typography.Text>
                        <Typography.Text color="secondary">›</Typography.Text>
                    </div>
                </div>
                <div
                  css={{
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.borderDecorative}`,
                    borderRadius: theme.borders.borderRadiusMd,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                     '&:hover': {
                        backgroundColor: theme.colors.actionDefaultBackgroundHover,
                    }
                  }}
                >
                    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <SeverityIcon severity="medium" />
                        <Typography.Text>Deprecated Feature References</Typography.Text>
                    </div>
                    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Typography.Text color="secondary">38 traces</Typography.Text>
                        <Typography.Text color="secondary">›</Typography.Text>
                    </div>
                </div>
                 <div
                  css={{
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.borderDecorative}`,
                    borderRadius: theme.borders.borderRadiusMd,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                     '&:hover': {
                        backgroundColor: theme.colors.actionDefaultBackgroundHover,
                    }
                  }}
                >
                    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <SeverityIcon severity="high" />
                        <Typography.Text>Pricing Information Out of Date</Typography.Text>
                    </div>
                    <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Typography.Text color="secondary">41 traces</Typography.Text>
                         <Typography.Text color="secondary">›</Typography.Text>
                    </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sample Feedback */}
          <div>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <UserGroupIcon css={{ color: theme.colors.textSecondary, width: 20, height: 20 }} />
              <Typography.Title level={4} css={{ marginBottom: 0 }}>Sample Feedbacks</Typography.Title>
            </div>
             <div css={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
               {issue.evidences && issue.evidences.length > 0 ? (
                 issue.evidences.slice(0, 3).map((evidence, idx) => (
                   <FeedbackBubble
                     key={`${evidence.trace_id}-${idx}`}
                     assessmentId={evidence.assessment_id}
                     traceId={evidence.trace_id}
                   />
                 ))
               ) : (
                 <Typography.Text color="secondary">No sample feedback available.</Typography.Text>
               )}
             </div>
          </div>

          {/* Traces Table */}
          <div css={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 600 }}>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <SchemaIcon css={{ color: theme.colors.textSecondary, width: 20, height: 20 }} />
              <Typography.Title level={4} css={{ marginBottom: 0 }}>Traces</Typography.Title>
            </div>
            <div css={{ flex: 1, border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, overflow: 'hidden' }}>
               <TracesComponent experimentIds={[experimentId]} />
            </div>
          </div>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};

