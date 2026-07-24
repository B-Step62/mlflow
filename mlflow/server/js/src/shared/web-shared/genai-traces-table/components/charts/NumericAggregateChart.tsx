import React from 'react';

import { HoverCard, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { useIntl } from '@databricks/i18n';

import type { NumericAggregate } from '../../types';
import { displayFloat } from '../../utils/DisplayUtils';

export const NumericAggregateChart = React.memo(function NumericAggregateChart({
  numericAggregate,
  formatValue = (value) => displayFloat(value, 2),
}: {
  numericAggregate: NumericAggregate;
  formatValue?: (value: number) => string;
}) {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        css={{
          display: 'flex',
          justifyContent: 'center',
          flexDirection: 'row',
        }}
      >
        {numericAggregate.counts.map((count, index) => (
          <HoverCard
            key={'hover-card-' + index}
            content={
              <div
                css={{
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  css={{
                    display: 'flex',
                    flexDirection: 'row',
                  }}
                >
                  <div
                    css={{
                      width: '25%',
                    }}
                  >
                    <Typography.Text>
                      {intl.formatMessage({
                        defaultMessage: 'Range',
                        description: 'Label for the range in the tooltip for the numeric aggregate chart.',
                      })}
                    </Typography.Text>
                  </div>
                  <div>
                    <Typography.Text color="secondary">
                      {formatValue(count.lower) === formatValue(count.upper)
                        ? formatValue(count.lower)
                        : `${formatValue(count.lower)} - ${formatValue(count.upper)}`}
                    </Typography.Text>
                  </div>
                </div>
                <div
                  css={{
                    display: 'flex',
                    flexDirection: 'row',
                  }}
                >
                  <div
                    css={{
                      width: '25%',
                    }}
                  >
                    <Typography.Text>
                      {intl.formatMessage({
                        defaultMessage: 'Count',
                        description: 'Label for the count in the tooltip for the numeric aggregate chart.',
                      })}
                    </Typography.Text>
                  </div>
                  <div>
                    <Typography.Text color="secondary">{count.count}</Typography.Text>
                  </div>
                </div>
              </div>
            }
            trigger={
              <div
                key={'bar-' + index}
                css={{
                  display: 'flex',
                  flex: 1,
                  flexDirection: 'column-reverse',
                  height: '60px',
                  width: '10px',
                  ':hover': {
                    backgroundColor: theme.colors.actionDefaultBackgroundHover,
                  },
                }}
              >
                <div
                  css={{
                    height: `${(count.count / numericAggregate.maxCount) * 100}%`,
                    minHeight: '1px',
                    width: '80%',
                    verticalAlign: 'bottom',
                    backgroundColor: theme.colors.blue400,
                    borderTopRightRadius: theme.general.borderRadiusBase,
                    borderTopLeftRadius: theme.general.borderRadiusBase,
                  }}
                />
              </div>
            }
          />
        ))}
      </div>
      {numericAggregate.min === numericAggregate.max ? (
        <div
          css={{
            display: 'flex',
            justifyContent: 'center',
            flexDirection: 'row',
            fontWeight: 'normal',
            fontSize: theme.typography.fontSizeSm,
            color: theme.colors.textSecondary,
          }}
        >
          {formatValue(numericAggregate.min)}
        </div>
      ) : (
        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            flexDirection: 'row',
            fontWeight: 'normal',
            fontSize: theme.typography.fontSizeSm,
            color: theme.colors.textSecondary,
          }}
        >
          <div>{formatValue(numericAggregate.min)}</div>
          <div>{formatValue(numericAggregate.max)}</div>
        </div>
      )}
    </div>
  );
});
