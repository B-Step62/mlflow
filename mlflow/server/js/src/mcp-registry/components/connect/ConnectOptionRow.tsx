import {
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  Tag,
  Tooltip,
  Typography,
  VisibleIcon,
  VisibleOffIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import type { ConnectOption } from './connectOptions';
import { ConnectInstructions } from './ConnectInstructions';

// One connection option, rendered as an expandable row that reveals its setup
// instructions. Admins additionally get a switch controlling whether developers
// see the option.
export const ConnectOptionRow = ({
  option,
  expanded,
  onToggle,
  isAdmin,
  hidden,
  onToggleVisibility,
  showTopBorder,
}: {
  option: ConnectOption;
  expanded: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  hidden: boolean;
  onToggleVisibility: () => void;
  showTopBorder: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  return (
    <div
      css={{
        borderTop: showTopBorder ? `1px solid ${theme.colors.borderDecorative}` : 'none',
        opacity: hidden ? 0.5 : 1,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', paddingRight: theme.spacing.md }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={intl.formatMessage(
            {
              defaultMessage: '{action} connection option {detail}',
              description: 'Aria label for expanding/collapsing a connection option row',
            },
            { action: expanded ? 'Collapse' : 'Expand', detail: option.detail },
          )}
          css={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            minWidth: 0,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            gap: theme.spacing.sm,
            textAlign: 'left',
            '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
          }}
        >
          <div
            css={{
              flexShrink: 0,
              width: theme.spacing.md,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </div>
          <Tag
            componentId="mlflow.mcp_registry.connect.option_badge"
            color={option.hosted ? 'charcoal' : 'turquoise'}
            css={{ flexShrink: 0 }}
          >
            {option.badge}
          </Tag>
          {!option.hosted && (
            <Typography.Text bold css={{ flexShrink: 0 }}>
              {option.label}
            </Typography.Text>
          )}
          <Typography.Text
            css={{
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSizeSm,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {option.detail}
          </Typography.Text>
          {option.versionLabel && (
            <Tag componentId="mlflow.mcp_registry.connect.option_version" css={{ flexShrink: 0 }}>
              {option.versionLabel}
            </Tag>
          )}
        </button>

        {isAdmin && (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              flexShrink: 0,
              paddingLeft: theme.spacing.sm,
            }}
          >
            {hidden && (
              <Tag componentId="mlflow.mcp_registry.connect.hidden_tag" color="charcoal">
                <FormattedMessage
                  defaultMessage="Disabled"
                  description="Badge shown on a connection option hidden from developers"
                />
              </Tag>
            )}
            <Tooltip
              componentId="mlflow.mcp_registry.connect.visibility_toggle.tooltip"
              content={
                hidden
                  ? intl.formatMessage({
                      defaultMessage: 'Hidden from developers. Click to show.',
                      description: 'Tooltip for the visibility eye icon when an option is hidden',
                    })
                  : intl.formatMessage({
                      defaultMessage: 'Visible to developers. Click to hide.',
                      description: 'Tooltip for the visibility eye icon when an option is visible',
                    })
              }
            >
              <Button
                componentId="mlflow.mcp_registry.connect.visibility_toggle"
                size="small"
                icon={hidden ? <VisibleOffIcon /> : <VisibleIcon />}
                onClick={onToggleVisibility}
                aria-label={intl.formatMessage({
                  defaultMessage: 'Toggle visibility to developers',
                  description: 'Aria label for the developer-visibility eye toggle',
                })}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {expanded && (
        <div
          css={{
            padding: `${theme.spacing.xs}px ${theme.spacing.md}px ${theme.spacing.md}px`,
            paddingLeft: theme.spacing.md + theme.spacing.md + theme.spacing.sm,
          }}
        >
          <ConnectInstructions option={option} />
        </div>
      )}
    </div>
  );
};
