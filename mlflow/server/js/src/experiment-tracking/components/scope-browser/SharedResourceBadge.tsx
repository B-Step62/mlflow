import { LinkIcon, Tag, Tooltip, useDesignSystemTheme } from '@databricks/design-system';

interface SharedResourceBadgeProps {
  scopeName: string;
  scopePath: string;
}

export const SharedResourceBadge = ({ scopeName, scopePath }: SharedResourceBadgeProps) => {
  const { theme } = useDesignSystemTheme();
  return (
    <Tooltip componentId="mlflow.scope-browser.shared-badge-tooltip" content={scopePath}>
      <Tag
        componentId="mlflow.scope-browser.shared-badge"
        color="lemon"
        css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.xs }}
      >
        <LinkIcon css={{ fontSize: 12 }} />
        from {scopeName}
      </Tag>
    </Tooltip>
  );
};
