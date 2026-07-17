import type { ModelTrace } from './ModelTrace.types';
import { ModelTraceExplorerDetailView } from './ModelTraceExplorerDetailView';

export const ModelTraceExplorerContent = ({
  modelTraceInfo,
  className,
  selectedSpanId,
  onSelectSpan,
}: {
  modelTraceInfo: ModelTrace['info'];
  className?: string;
  selectedSpanId?: string;
  onSelectSpan?: (selectedSpanId?: string) => void;
}) => {
  return (
    <ModelTraceExplorerDetailView
      modelTraceInfo={modelTraceInfo}
      className={className}
      selectedSpanId={selectedSpanId}
      onSelectSpan={onSelectSpan}
    />
  );
};
