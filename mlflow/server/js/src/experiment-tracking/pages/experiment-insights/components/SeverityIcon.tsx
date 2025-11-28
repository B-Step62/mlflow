import React from 'react';
import { useDesignSystemTheme, WarningIcon, CheckCircleIcon, XCircleIcon } from '@databricks/design-system';

export const SeverityIcon = ({ severity }: { severity?: string }) => {
  const { theme } = useDesignSystemTheme();
  const s = (severity || '').toLowerCase();

  let icon;
  let color;
  let backgroundColor;

  if (s === 'high') {
    icon = <XCircleIcon />;
    color = theme.colors.textValidationDanger;
    backgroundColor = theme.isDarkMode ? theme.colors.red800 : theme.colors.red100;
  } else if (s === 'medium') {
    icon = <WarningIcon />;
    color = theme.colors.textValidationWarning;
    backgroundColor = theme.isDarkMode ? theme.colors.yellow800 : theme.colors.yellow100;
  } else {
    icon = <CheckCircleIcon />;
    color = theme.colors.textValidationSuccess;
    backgroundColor = theme.isDarkMode ? theme.colors.green800 : theme.colors.green100;
  }

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor,
        color,
        fontSize: 20,
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
  );
};

