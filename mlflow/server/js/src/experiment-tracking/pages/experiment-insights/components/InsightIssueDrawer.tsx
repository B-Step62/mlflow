import React, { useState } from 'react';
import { keyframes } from '@emotion/react';
import {
  Drawer,
  Typography,
  Button,
  useDesignSystemTheme,
  CopyIcon,
  WrenchSparkleIcon,
  MenuIcon,
  LightningIcon,
  UserGroupIcon,
  SchemaIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@databricks/design-system';
import { SeverityIcon } from './SeverityIcon';
import { FeedbackBubble } from './FeedbackBubble';
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
  return <TracesV3View experimentIds={experimentIds} hideToolbar hideAssessments />;
};

const slideInRight = keyframes`
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const slideInLeft = keyframes`
  from {
    opacity: 0;
    transform: translateX(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const PAGE_SIZE = 3;

export const InsightIssueDrawer: React.FC<InsightIssueDrawerProps> = ({
  isOpen,
  onClose,
  issue,
  experimentId,
  totalTraces = 10,
}) => {
  const { theme } = useDesignSystemTheme();
  const [currentPage, setCurrentPage] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');

  if (!issue) {
    return null;
  }

  const traceCount = issue.impactedCount || issue.traceIds?.length || 0;
  const percentage = totalTraces > 0 ? Math.round((traceCount / totalTraces) * 100) : 0;

  const evidences = issue.evidences || [];
  const totalPages = Math.ceil(evidences.length / PAGE_SIZE);
  const visibleEvidences = evidences.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  
  const start = currentPage * PAGE_SIZE + 1;
  const end = Math.min((currentPage + 1) * PAGE_SIZE, evidences.length);

  const handlePrevPage = () => {
    setSlideDirection('left');
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setSlideDirection('right');
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <Drawer.Root modal={false} open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content
        componentId="insight-issue-drawer"
        // @ts-expect-error: Drawer.Content actually supports style prop
        style={{ zIndex: 100, overflowY: 'auto' }}
        title={
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
            <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <SeverityIcon severity={issue.severity} />
                <Typography.Title level={2} css={{ marginTop: '0.5rem' }}>
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
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg, height: '100%', marginTop: theme.spacing.md, overflowY: 'auto'}}>
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
              <div css={{ marginBottom: theme.spacing.md, paddingLeft: theme.spacing.md, paddingRight: theme.spacing.md }}>
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
            </div>
          </div>

          {/* Sample Feedback */}
          <div>
            <div
              css={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: theme.spacing.sm,
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <UserGroupIcon css={{ color: theme.colors.textSecondary, width: 20, height: 20 }} />
                <Typography.Title level={4} css={{ marginBottom: 0 }}>
                  Feedbacks
                </Typography.Title>
              </div>
              {evidences.length > 0 && (
                <Typography.Text color="secondary">
                  (Showing {start}-{end} of {evidences.length})
                </Typography.Text>
              )}
            </div>
            
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              {totalPages > 1 && (
                <Button
                  componentId="feedback-prev-btn"
                  icon={<ChevronLeftIcon />}
                  size="small"
                  onClick={handlePrevPage}
                  disabled={currentPage === 0}
                  type="tertiary"
                />
              )}
              
              <div
                key={currentPage}
                css={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: theme.spacing.md,
                  flex: 1,
                  animation: `${slideDirection === 'right' ? slideInRight : slideInLeft} 0.3s ease-out`,
                }}
              >
                {visibleEvidences.length > 0 ? (
                  visibleEvidences.map((evidence, idx) => (
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

              {totalPages > 1 && (
                <Button
                  componentId="feedback-next-btn"
                  icon={<ChevronRightIcon />}
                  size="small"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages - 1}
                  type="tertiary"
                />
              )}
            </div>
          </div>

          {/* Traces Table */}
          <div css={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 600, marginTop: theme.spacing.md }}>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
              <SchemaIcon css={{ color: theme.colors.textSecondary, width: 24, height: 24 }} />
              <Typography.Title level={3} css={{ marginBottom: 0 }}>Traces</Typography.Title>
            </div>
            <div css={{ flex: 1, overflow: 'hidden' }}>
               <TracesComponent experimentIds={[experimentId]} />
            </div>
          </div>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
};

