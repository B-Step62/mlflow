import { useDesignSystemTheme } from '@databricks/design-system';

import type { ModelTrace } from '../ModelTrace.types';
import { NewTraceExperienceTabs } from './NewTraceExperienceTabs';
import { NewTraceExperienceTopBar } from './NewTraceExperienceTopBar';
import { NewTraceExperienceTraceTab } from './NewTraceExperienceTraceTab';

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

  const renderTraceTab = () => <NewTraceExperienceTraceTab modelTraceInfo={modelTraceInfo} />;

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
      <NewTraceExperienceTabs modelTraceInfo={modelTraceInfo} renderTraceTab={renderTraceTab} />
    </div>
  );
};
