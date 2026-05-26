import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTrace } from '../ModelTrace.types';

type Props = {
  modelTraceInfo: ModelTrace['info'];
  className?: string;
  selectedSpanId?: string;
  onSelectSpan?: (selectedSpanId?: string) => void;
};

export const NewTraceExperienceShell = ({ modelTraceInfo, className }: Props) => {
  const { theme } = useDesignSystemTheme();
  const traceId =
    (modelTraceInfo as { trace_id?: string } | undefined)?.trace_id ??
    (modelTraceInfo as { request_id?: string } | undefined)?.request_id ??
    '-';

  return (
    <div
      className={className}
      css={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: theme.colors.backgroundPrimary,
        color: theme.colors.textPrimary,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      <div css={{ fontSize: theme.typography.fontSizeXl, fontWeight: theme.typography.typographyBoldFontWeight }}>
        <FormattedMessage
          defaultMessage="New trace experience"
          description="Placeholder title for the redesigned trace experience shell, shown before the full layout is wired up"
        />
      </div>
      <div css={{ color: theme.colors.textSecondary }}>
        <FormattedMessage
          defaultMessage="Trace: {traceId}"
          description="Placeholder line showing the trace id while the new trace experience is being built"
          values={{ traceId }}
        />
      </div>
    </div>
  );
};
