import { useState } from 'react';
import { Button, Drawer, Typography, useDesignSystemTheme } from '@databricks/design-system';

interface ViewTraceButtonProps {
  traceId: string;
  experimentId: string;
}

export const ViewTraceButton = ({ traceId, experimentId }: ViewTraceButtonProps) => {
  const { theme } = useDesignSystemTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <div css={{ display: 'flex' }}>
        <Button
          componentId="mlflow.skill-playground.view-trace"
          type="link"
          size="small"
          onClick={() => setDrawerOpen(true)}
          css={{ padding: 0, height: 'auto', fontSize: theme.typography.fontSizeSm }}
        >
          View Trace ({traceId})
        </Button>
      </div>

      <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content title={`Trace: ${traceId}`} componentId="mlflow.skill-playground.trace-drawer" width={560}>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
            <div
              css={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: theme.spacing.sm,
                rowGap: theme.spacing.md,
              }}
            >
              <Typography.Text bold color="secondary">
                Trace ID
              </Typography.Text>
              <Typography.Text css={{ fontFamily: 'monospace' }}>{traceId}</Typography.Text>

              <Typography.Text bold color="secondary">
                Experiment
              </Typography.Text>
              <Typography.Text>{experimentId}</Typography.Text>

              <Typography.Text bold color="secondary">
                Status
              </Typography.Text>
              <Typography.Text css={{ color: theme.colors.green600 }}>OK</Typography.Text>

              <Typography.Text bold color="secondary">
                Duration
              </Typography.Text>
              <Typography.Text>3.4s</Typography.Text>

              <Typography.Text bold color="secondary">
                Timestamp
              </Typography.Text>
              <Typography.Text>2026-02-07 14:32:11 UTC</Typography.Text>
            </div>

            <div css={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: theme.spacing.md }}>
              <Typography.Title level={4}>Spans</Typography.Title>
              <div
                css={{
                  marginTop: theme.spacing.sm,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.borders.borderRadiusMd,
                  overflow: 'hidden',
                }}
              >
                {[
                  { name: 'AgentExecution', duration: '3.4s', depth: 0 },
                  { name: 'SkillLookup', duration: '120ms', depth: 1 },
                  { name: 'ToolExecution', duration: '2.8s', depth: 1 },
                  { name: 'LLM Call', duration: '1.2s', depth: 2 },
                  { name: 'ResponseFormat', duration: '45ms', depth: 1 },
                ].map((span, i) => (
                  <div
                    key={i}
                    css={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                      paddingLeft: theme.spacing.sm + span.depth * theme.spacing.md,
                      borderBottom: i < 4 ? `1px solid ${theme.colors.border}` : 'none',
                      fontSize: theme.typography.fontSizeSm,
                      '&:hover': { backgroundColor: theme.colors.backgroundSecondary },
                    }}
                  >
                    <Typography.Text size="sm" css={{ fontFamily: 'monospace' }}>
                      {span.name}
                    </Typography.Text>
                    <Typography.Text size="sm" color="secondary">
                      {span.duration}
                    </Typography.Text>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
};
