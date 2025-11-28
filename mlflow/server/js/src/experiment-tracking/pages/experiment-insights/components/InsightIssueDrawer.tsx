import React from 'react';
import {
  Drawer,
  Typography,
  Button,
  Tag,
  useDesignSystemTheme,
  CopyIcon,
  Spacer,
} from '@databricks/design-system';
import { SeverityIcon } from './SeverityIcon';
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
};

const TracesComponent = ({ experimentIds }: { experimentIds: string[] }) => {
  if (shouldEnableTracesV3View() || isExperimentEvalResultsMonitoringUIEnabled()) {
    return <TracesV3View experimentIds={experimentIds} />;
  }
  return <TracesView experimentIds={experimentIds} />;
};

export const InsightIssueDrawer: React.FC<InsightIssueDrawerProps> = ({
  isOpen,
  onClose,
  issue,
  experimentId,
}) => {
  const { theme } = useDesignSystemTheme();

  if (!issue) {
    return null;
  }

  const traceCount = issue.impactedCount || issue.traceIds?.length || 0;

  return (
    <Drawer.Root modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content
        componentId="insight-issue-drawer"
        title={
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
             <SeverityIcon severity={issue.severity} />
            <Typography.Title level={3} css={{ marginBottom: 0 }}>
              {issue.name}
            </Typography.Title>
          </div>
        }
        width="80vw"
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg, height: '100%' }}>
          {/* Header Actions */}
          <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              {issue.severity && <Tag componentId="drawer-severity-tag">{issue.severity}</Tag>}
            </div>
            <div css={{ display: 'flex', gap: theme.spacing.sm }}>
               <Button componentId="drawer-copy-btn" icon={<CopyIcon />}>Copy</Button>
               <Button componentId="drawer-create-judge-btn" type="primary">Create LLM Judge</Button>
            </div>
          </div>

          {/* Overview and Impacted Traces */}
          <div css={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.md }}>
             <div css={{ 
               border: `1px solid ${theme.colors.borderDecorative}`, 
               borderRadius: theme.borders.borderRadiusMd, 
               padding: theme.spacing.md 
             }}>
               <Typography.Title level={4}>Overview</Typography.Title>
               <Typography.Paragraph color="secondary" css={{ marginBottom: 0 }}>
                 {issue.description || 'No description available.'}
               </Typography.Paragraph>
             </div>
             <div css={{ 
               border: `1px solid ${theme.colors.borderDecorative}`, 
               borderRadius: theme.borders.borderRadiusMd, 
               padding: theme.spacing.md,
               display: 'flex',
               flexDirection: 'column',
               justifyContent: 'center',
               alignItems: 'center'
             }}>
               <Typography.Title level={4} css={{ marginBottom: theme.spacing.xs }}>Impacted Traces</Typography.Title>
               <Typography.Title level={2} css={{ marginBottom: 0, color: theme.colors.textPrimary }}>
                 {traceCount}
               </Typography.Title>
             </div>
          </div>

          {/* Sample Feedback */}
          <div>
            <Typography.Title level={4}>Sample Feedback</Typography.Title>
             <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
               {issue.evidences && issue.evidences.length > 0 ? (
                 issue.evidences.slice(0, 3).map((evidence, idx) => (
                   <div key={idx} css={{ 
                     padding: theme.spacing.sm, 
                     background: theme.colors.backgroundSecondary, 
                     borderRadius: theme.borders.borderRadiusMd 
                   }}>
                     <Typography.Text>
                       {evidence.assessment_id || evidence.trace_id || 'Feedback sample'}
                     </Typography.Text>
                   </div>
                 ))
               ) : (
                 <Typography.Text color="secondary">No sample feedback available.</Typography.Text>
               )}
             </div>
          </div>

          {/* Traces Table */}
          <div css={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 400 }}>
            <Typography.Title level={4}>Traces</Typography.Title>
            <div css={{ flex: 1, border: `1px solid ${theme.colors.borderDecorative}`, borderRadius: theme.borders.borderRadiusMd, overflow: 'hidden' }}>
               <TracesComponent experimentIds={[experimentId]} />
            </div>
          </div>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};

