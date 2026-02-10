import { useCallback } from 'react';
import {
  Accordion,
  ChevronDownIcon,
  ChevronRightIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { featureDefinitions } from './feature-definitions';
import { LaunchDemoCard } from './LaunchDemoCard';
import { FeatureCard } from './FeatureCard';

const COLLAPSED_KEY = 'mlflow.home.getting-started.collapsed';

export const FeaturesSection = () => {
  const { theme } = useDesignSystemTheme();

  const defaultActiveKey = localStorage.getItem(COLLAPSED_KEY) === 'true' ? [] : ['getting-started'];

  const handleChange = useCallback((key: string | string[]) => {
    const isExpanded = Array.isArray(key) ? key.length > 0 : Boolean(key);
    localStorage.setItem(COLLAPSED_KEY, String(!isExpanded));
  }, []);

  const expandIcon = useCallback(
    ({ isActive }: { isActive?: boolean }) => (
      <span css={{ display: 'inline-flex', alignItems: 'center', color: theme.colors.textSecondary }}>
        {isActive ? <ChevronDownIcon /> : <ChevronRightIcon />}
      </span>
    ),
    [theme],
  );

  return (
    <section>
      <Accordion
        componentId="mlflow.home.getting-started"
        defaultActiveKey={defaultActiveKey}
        onChange={handleChange}
        dangerouslyAppendEmotionCSS={
          {
            '.du-bois-light-collapse-header, .du-bois-dark-collapse-header': {
              display: 'flex !important',
              alignItems: 'center',
            },
            '.du-bois-light-collapse-arrow, .du-bois-dark-collapse-arrow': {
              position: 'static !important',
              order: 1,
              insetInlineEnd: 'auto !important',
              marginInlineStart: `${theme.spacing.xs}px !important`,
              transform: 'none !important',
            },
            '.du-bois-light-collapse-header-text, .du-bois-dark-collapse-header-text': {
              order: 0,
              flex: 'none',
            },
          } as any
        }
        dangerouslySetAntdProps={{
          expandIcon,
        }}
      >
        <Accordion.Panel
          key="getting-started"
          header={
            <Typography.Title level={3} css={{ '&&': { margin: 0 } }}>
              <FormattedMessage defaultMessage="Getting Started" description="Home page features section title" />
            </Typography.Title>
          }
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
            <LaunchDemoCard />
            <Typography.Text bold color="secondary">
              <FormattedMessage defaultMessage="Explore Features" description="Feature cards section title" />
            </Typography.Text>
            <div
              css={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: theme.spacing.sm,
              }}
            >
              {featureDefinitions.map((feature) => (
                <FeatureCard key={feature.id} feature={feature} />
              ))}
            </div>
          </div>
        </Accordion.Panel>
      </Accordion>
    </section>
  );
};
