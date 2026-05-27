import { useState } from 'react';

import { Button, ChevronDownIcon, ChevronRightIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';

export const ModelTraceExplorerCollapsibleSection = ({
  sectionKey,
  title,
  children,
  withBorder = false,
  isExceptionSection = false,
  className,
  defaultOpen = true,
}: {
  sectionKey: string;
  title: React.ReactNode;
  children: React.ReactNode;
  withBorder?: boolean;
  isExceptionSection?: boolean;
  className?: string;
  /**
   * Initial open/closed state. Defaults to true so legacy callers
   * (Inputs/Outputs banners) stay open out of the box. Set to false for
   * secondary sections that the user should opt into expanding.
   */
  defaultOpen?: boolean;
}) => {
  const [expanded, setExpanded] = useState(defaultOpen);
  const { theme } = useDesignSystemTheme();

  const borderColor = isExceptionSection ? theme.colors.actionDangerPrimaryBackgroundDefault : theme.colors.border;
  const headerBackground = isExceptionSection
    ? `${theme.colors.actionDangerPrimaryBackgroundDefault}15`
    : theme.colors.backgroundSecondary;
  const contentBackground = isExceptionSection ? theme.colors.backgroundPrimary : undefined;

  return (
    <div
      className={className}
      css={{
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        css={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'row',
          gap: theme.spacing.xs,
          padding: withBorder ? theme.spacing.sm : 0,
          background: withBorder ? headerBackground : undefined,
          marginBottom: withBorder ? 0 : theme.spacing.sm,
          borderBlock: withBorder ? `1px solid ${borderColor}` : undefined,
        }}
      >
        <Button
          size="small"
          componentId="shared.model-trace-explorer.expand"
          type="tertiary"
          icon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          onClick={() => setExpanded(!expanded)}
        />
        <Typography.Title withoutMargins level={4} css={{ width: '100%' }}>
          {title}
        </Typography.Title>
      </div>
      {expanded && (
        <div
          css={{
            padding: withBorder ? theme.spacing.sm : 0,
            background: contentBackground,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
