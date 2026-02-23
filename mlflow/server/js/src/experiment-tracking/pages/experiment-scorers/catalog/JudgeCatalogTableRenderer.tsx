import {
  Button,
  Empty,
  NoIcon,
  PlayIcon,
  ClockIcon,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Tag,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import type { CatalogEntry } from './types';
import { getProviderDisplayName, getTagDisplayName } from './judgeCatalogUtils';
import { COMPONENT_ID_PREFIX } from '../constants';
import ProviderLogo from './ProviderLogo';

interface JudgeCatalogTableRendererProps {
  entries: CatalogEntry[];
  onRowClick: (entry: CatalogEntry) => void;
  onSchedule: (entry: CatalogEntry) => void;
  isFiltered: boolean;
}

const JudgeCatalogTableRenderer: React.FC<JudgeCatalogTableRendererProps> = ({
  entries,
  onRowClick,
  onSchedule,
  isFiltered,
}) => {
  const { theme } = useDesignSystemTheme();

  const getEmptyState = () => {
    if (isFiltered) {
      return (
        <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Empty
            image={<NoIcon />}
            title={
              <FormattedMessage
                defaultMessage="No judges found"
                description="Empty state title when no judges match the catalog filters"
              />
            }
            description={null}
          />
        </div>
      );
    }
    return null;
  };

  return (
    <Table scrollable empty={getEmptyState()}>
      <TableRow isHeader>
        <TableHeader componentId={`${COMPONENT_ID_PREFIX}.catalog.header.name`} css={{ width: '20%' }}>
          <FormattedMessage defaultMessage="Name" description="Column header for judge name in catalog table" />
        </TableHeader>
        <TableHeader componentId={`${COMPONENT_ID_PREFIX}.catalog.header.provider`} css={{ width: '10%' }}>
          <FormattedMessage defaultMessage="Provider" description="Column header for judge provider in catalog table" />
        </TableHeader>
        <TableHeader componentId={`${COMPONENT_ID_PREFIX}.catalog.header.tags`} css={{ width: '15%' }}>
          <FormattedMessage defaultMessage="Tags" description="Column header for judge tags in catalog table" />
        </TableHeader>
        <TableHeader componentId={`${COMPONENT_ID_PREFIX}.catalog.header.description`} css={{ width: '40%' }}>
          <FormattedMessage
            defaultMessage="Description"
            description="Column header for judge description in catalog table"
          />
        </TableHeader>
        <TableHeader componentId={`${COMPONENT_ID_PREFIX}.catalog.header.actions`} css={{ width: '15%' }}>
          <FormattedMessage defaultMessage="Actions" description="Column header for actions in catalog table" />
        </TableHeader>
      </TableRow>
      {entries.map((entry) => (
        <TableRow
          key={entry.id}
          css={{ cursor: 'pointer', '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover } }}
          onClick={() => onRowClick(entry)}
        >
          <TableCell css={{ fontWeight: theme.typography.typographyBoldFontWeight }}>{entry.name}</TableCell>
          <TableCell>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
              <ProviderLogo provider={entry.provider} />
              <span>{getProviderDisplayName(entry.provider)}</span>
            </div>
          </TableCell>
          <TableCell>
            <div css={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {entry.tags.slice(0, 2).map((tag) => (
                <Tag key={tag} componentId={`${COMPONENT_ID_PREFIX}.catalog.tag`} css={{ margin: 0 }}>
                  {getTagDisplayName(tag)}
                </Tag>
              ))}
              {entry.tags.length > 2 && (
                <Tag componentId={`${COMPONENT_ID_PREFIX}.catalog.tag-overflow`} css={{ margin: 0 }}>
                  +{entry.tags.length - 2}
                </Tag>
              )}
            </div>
          </TableCell>
          <TableCell
            css={{
              color: theme.colors.textSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.description}
          </TableCell>
          <TableCell>
            <div
              css={{ display: 'flex', gap: theme.spacing.xs }}
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <Button
                componentId={`${COMPONENT_ID_PREFIX}.catalog.use-button`}
                type="tertiary"
                size="small"
                icon={<PlayIcon />}
                onClick={() => onRowClick(entry)}
              >
                <FormattedMessage
                  defaultMessage="Use"
                  description="Button text to view usage details for a judge in the catalog"
                />
              </Button>
              {entry.canAddToExperiment && (
                <Button
                  componentId={`${COMPONENT_ID_PREFIX}.catalog.schedule-button`}
                  type="primary"
                  size="small"
                  icon={<ClockIcon />}
                  onClick={() => onSchedule(entry)}
                >
                  <FormattedMessage
                    defaultMessage="Schedule"
                    description="Button text to schedule a judge from the catalog to the experiment"
                  />
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </Table>
  );
};

export default JudgeCatalogTableRenderer;
