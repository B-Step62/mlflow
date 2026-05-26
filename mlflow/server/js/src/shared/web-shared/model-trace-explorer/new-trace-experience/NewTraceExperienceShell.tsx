import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTrace } from '../ModelTrace.types';
import { NewTraceExperienceTopBar } from './NewTraceExperienceTopBar';

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
      }}
    >
      <NewTraceExperienceTopBar traceId={traceId} />
      <div
        css={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.colors.textSecondary,
          padding: theme.spacing.lg,
        }}
      >
        <FormattedMessage
          defaultMessage="Trace content coming in the next step."
          description="Placeholder shown in the new trace experience body while the layout is being built"
        />
      </div>
    </div>
  );
};
