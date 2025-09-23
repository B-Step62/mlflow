import { ArrowRightIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { Link } from '../../common/utils/RoutingUtils';
import { homeQuickActions } from '../quick-actions';
import {
  cardCtaStyles,
  sectionHeaderStyles,
  getStartedCardContainerStyles,
  getStartedCardContentStyles,
  getStartedCardLinkStyles,
  getStartedIconWrapperStyles,
} from './cardStyles';

type QuickAction = (typeof homeQuickActions)[number];

const GetStartedCard = ({ action, onLogTracesClick }: { action: QuickAction; onLogTracesClick?: () => void }) => {
  const { theme } = useDesignSystemTheme();
  const linkStyles = getStartedCardLinkStyles(theme);
  const containerStyles = getStartedCardContainerStyles(theme);
  const contentStyles = getStartedCardContentStyles(theme);
  const iconWrapperStyles = getStartedIconWrapperStyles(theme);

  const card = (
    <div css={containerStyles}>
      <div css={iconWrapperStyles}>
        <action.icon css={{ width: 20, height: 20 }} />
      </div>
      <div css={contentStyles}>
        <span role="heading" aria-level={2}>
          <Typography.Text strong>{action.title}</Typography.Text>
        </span>
        <Typography.Text color="secondary">{action.description}</Typography.Text>
      </div>
    </div>
  );

  if (action.id === 'log-traces' && onLogTracesClick) {
    return (
      <button
        type="button"
        onClick={onLogTracesClick}
        css={{
          ...linkStyles,
          border: 0,
          padding: 0,
          background: 'transparent',
          cursor: 'pointer',
          font: 'inherit',
          textAlign: 'left',
        }}
        data-component-id={action.componentId}
      >
        {card}
      </button>
    );
  }

  if (action.link.type === 'internal') {
    return (
      <Link to={action.link.to} css={linkStyles} data-component-id={action.componentId}>
        {card}
      </Link>
    );
  }

  return (
    <a
      href={action.link.href}
      target={action.link.target ?? '_blank'}
      rel={action.link.rel ?? 'noopener noreferrer'}
      css={linkStyles}
      data-component-id={action.componentId}
    >
      {card}
    </a>
  );
};

export const GetStarted = ({ onLogTracesClick }: { onLogTracesClick?: () => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <section css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <Typography.Title level={3} css={sectionHeaderStyles}>
        <FormattedMessage defaultMessage="Get started" description="Home page quick action section title" />
      </Typography.Title>
      <section css={{ marginBottom: 20, width: '100%', minWidth: 0 }}>
        <div
          css={{
            width: '100%',
            display: 'flex',
            gap: theme.spacing.sm + theme.spacing.xs,
            flexWrap: 'wrap',
          }}
        >
          {homeQuickActions.map((action) => (
            <GetStartedCard key={action.id} action={action} onLogTracesClick={onLogTracesClick} />
          ))}
        </div>
      </section>
    </section>
  );
};
