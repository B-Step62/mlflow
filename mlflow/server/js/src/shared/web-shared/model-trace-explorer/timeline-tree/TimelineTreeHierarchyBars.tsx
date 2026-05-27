import { useDesignSystemTheme } from '@databricks/design-system';

import type { HierarchyBar } from './TimelineTree.types';
import { SPAN_INDENT_WIDTH, SPAN_ROW_HEIGHT, TimelineTreeZIndex } from './TimelineTree.utils';

const IconBottomConnector = ({ active }: { active: boolean }) => {
  const { theme } = useDesignSystemTheme();
  const borderColor = active ? theme.colors.blue500 : theme.colors.border;

  return (
    <div
      css={{
        position: 'absolute',
        left: '100%',
        bottom: 0,
        // not sure why the +1 is necessary but
        // there is a 1 pixel misalignment with the
        // left connector otherwise
        width: SPAN_INDENT_WIDTH / 2 + 1,
        height: theme.spacing.md,
        boxSizing: 'border-box',
        borderTopRightRadius: theme.borders.borderRadiusMd,
        borderTop: `1px solid ${borderColor}`,
        borderRight: `1px solid ${borderColor}`,
        zIndex: TimelineTreeZIndex.LOW, // render behind the span's icon
      }}
    />
  );
};

const IconLeftConnector = ({ active }: { active: boolean }) => {
  const { theme } = useDesignSystemTheme();
  const borderColor = active ? theme.colors.blue500 : theme.colors.border;

  return (
    <div
      css={{
        position: 'absolute',
        left: '50%',
        top: 0,
        width: SPAN_INDENT_WIDTH / 2,
        height: theme.spacing.md,
        boxSizing: 'border-box',
        borderBottomLeftRadius: theme.borders.borderRadiusMd,
        borderBottom: `1px solid ${borderColor}`,
        borderLeft: `1px solid ${borderColor}`,
        zIndex: active ? TimelineTreeZIndex.NORMAL : TimelineTreeZIndex.LOW,
      }}
    />
  );
};

const VerticalConnector = ({ active, rowHeight }: { active: boolean; rowHeight: number }) => {
  const { theme } = useDesignSystemTheme();
  const borderColor = active ? theme.colors.blue500 : theme.colors.border;

  return (
    <div
      css={{
        position: 'absolute',
        width: SPAN_INDENT_WIDTH / 2,
        left: '50%',
        height: rowHeight,
        borderLeft: `1px solid ${borderColor}`,
        boxSizing: 'border-box',
        zIndex: active ? TimelineTreeZIndex.NORMAL : TimelineTreeZIndex.LOW,
      }}
    />
  );
};

/**
 * This component renders the bars that represent the hierarchical
 * connections in the span tree.
 */
export const TimelineTreeHierarchyBars = ({
  isActiveSpan,
  isInActiveChain,
  linesToRender,
  hasChildren,
  isExpanded,
  rowHeight = SPAN_ROW_HEIGHT,
}: {
  // whether or not the current span is active
  isActiveSpan: boolean;
  // true if the span is either active or a parent of the active span
  isInActiveChain: boolean;
  // an array of bars to render to the left of the span icon / name
  linesToRender: Array<HierarchyBar>;
  hasChildren: boolean;
  isExpanded: boolean;
  // Override the row height (defaults to the legacy SPAN_ROW_HEIGHT).
  // The new trace experience uses a taller row to fit metrics beneath
  // the span name; the connectors stay anchored to the row's top/bottom
  // so vertical lines remain continuous between rows.
  rowHeight?: number;
}) => {
  if (linesToRender.length === 0) {
    return (
      <div
        css={{
          width: 0,
          height: rowHeight,
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        {hasChildren && <IconBottomConnector active={isInActiveChain && !isActiveSpan} />}
      </div>
    );
  }

  return (
    <>
      {linesToRender.map(({ shouldRender, isActive }, idx) => (
        // for each depth level, render a spacer. depending on the span's
        // position within the tree, the spacer might be empty or contain
        // a vertical bar
        <div
          key={idx}
          css={{
            width: SPAN_INDENT_WIDTH,
            height: rowHeight,
            boxSizing: 'border-box',
            position: 'relative',
          }}
        >
          {shouldRender && (
            // render a vertical bar in the middle of the spacer
            <VerticalConnector active={isActive} rowHeight={rowHeight} />
          )}
          {idx === linesToRender.length - 1 && (
            // at the last spacer, render a curved
            // line that connects up to the parent
            <>
              <IconLeftConnector active={isInActiveChain} />
              {hasChildren && isExpanded && <IconBottomConnector active={isInActiveChain && !isActiveSpan} />}
            </>
          )}
        </div>
      ))}
    </>
  );
};
