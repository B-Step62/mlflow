import { useMemo } from 'react';
import { Button, DropdownMenu, FilterIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import { type Issue, type IssueStatus } from './hooks/useSearchIssuesQuery';

export type IssueStatusFilterValue = IssueStatus | 'all';

interface IssueStatusFilterProps {
  issues: Issue[];
  value: IssueStatusFilterValue;
  onChange: (value: IssueStatusFilterValue) => void;
  showLabel?: boolean;
}

const STATUS_FILTER_OPTIONS: IssueStatusFilterValue[] = ['all', 'pending', 'rejected', 'resolved'];

const IssueStatusFilterLabel = ({ value }: { value: IssueStatusFilterValue }) => {
  if (value === 'all') {
    return <FormattedMessage defaultMessage="All" description="Issue status filter option > All label" />;
  }
  if (value === 'pending') {
    return <FormattedMessage defaultMessage="Pending" description="Issue status filter option > Pending label" />;
  }
  if (value === 'rejected') {
    return <FormattedMessage defaultMessage="Rejected" description="Issue status filter option > Rejected label" />;
  }
  return <FormattedMessage defaultMessage="Resolved" description="Issue status filter option > Resolved label" />;
};

export const IssueStatusFilter = ({ issues, value, onChange, showLabel = true }: IssueStatusFilterProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();

  const counts = useMemo(() => {
    const result = {
      all: issues.length,
      pending: 0,
      rejected: 0,
      resolved: 0,
    };
    for (const issue of issues) {
      result[issue.status]++;
    }
    return result;
  }, [issues]);

  const activeCount = counts[value];
  const hasCustomFilter = value !== 'pending';

  return (
    <div
      css={{
        padding: showLabel ? `${theme.spacing.sm}px ${theme.spacing.md}px` : 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: showLabel ? 'flex-start' : 'center',
      }}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            componentId="mlflow.issues.status-filter.trigger"
            size="small"
            type="tertiary"
            icon={<FilterIcon />}
            aria-label={intl.formatMessage({
              defaultMessage: 'Filter issues by status',
              description: 'Aria label for issue status filter trigger',
            })}
            css={
              hasCustomFilter
                ? {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderColor: theme.colors.actionDefaultBorderFocus,
                    backgroundColor: theme.colors.actionDefaultBackgroundHover,
                  }
                : {
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }
            }
          >
            {showLabel && (
              <FormattedMessage
                defaultMessage="Status: {status} ({count})"
                description="Issue status filter trigger label"
                values={{ status: <IssueStatusFilterLabel value={value} />, count: activeCount }}
              />
            )}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.RadioGroup
            componentId="mlflow.issues.status-filter"
            value={value}
            onValueChange={(nextValue) => onChange(nextValue as IssueStatusFilterValue)}
          >
            <DropdownMenu.Label>
              <Typography.Text color="secondary">
                <FormattedMessage defaultMessage="Issue status" description="Issue status filter menu label" />
              </Typography.Text>
            </DropdownMenu.Label>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <DropdownMenu.RadioItem key={option} value={option}>
                <DropdownMenu.ItemIndicator />
                <FormattedMessage
                  defaultMessage="{status} ({count})"
                  description="Issue status filter menu item"
                  values={{ status: <IssueStatusFilterLabel value={option} />, count: counts[option] }}
                />
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
};
