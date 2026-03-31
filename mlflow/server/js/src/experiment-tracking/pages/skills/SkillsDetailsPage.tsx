import { ScrollablePageWrapper } from '@mlflow/mlflow/src/common/components/ScrollablePageWrapper';
import { useSkillDetailsQuery } from './hooks/useSkillDetailsQuery';
import { Alert, Button, Header, Spacer, Spinner, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { useParams } from '../../../common/utils/RoutingUtils';
import { Link } from '../../../common/utils/RoutingUtils';
import Routes from '../../routes';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import type { RegisteredSkillVersion } from './types';

const SkillVersionsTable = ({ versions }: { versions: RegisteredSkillVersion[] }) => {
  const { theme } = useDesignSystemTheme();

  if (!versions.length) {
    return (
      <div style={{ color: theme.colors.textSecondary, padding: theme.spacing.md }}>
        No versions found.
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${theme.colors.borderDecorative}`, textAlign: 'left' }}>
          <th style={{ padding: theme.spacing.sm, fontWeight: 600 }}>Version</th>
          <th style={{ padding: theme.spacing.sm, fontWeight: 600 }}>Source</th>
          <th style={{ padding: theme.spacing.sm, fontWeight: 600 }}>Description</th>
          <th style={{ padding: theme.spacing.sm, fontWeight: 600 }}>Aliases</th>
          <th style={{ padding: theme.spacing.sm, fontWeight: 600 }}>Tags</th>
        </tr>
      </thead>
      <tbody>
        {versions.map((v) => (
          <tr key={v.version} style={{ borderBottom: `1px solid ${theme.colors.borderDecorative}` }}>
            <td style={{ padding: theme.spacing.sm }}>v{v.version}</td>
            <td style={{ padding: theme.spacing.sm, color: theme.colors.textSecondary, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v.source || '—'}
            </td>
            <td style={{ padding: theme.spacing.sm, color: theme.colors.textSecondary }}>
              {v.description || '—'}
            </td>
            <td style={{ padding: theme.spacing.sm }}>
              {v.aliases?.map((a) => (
                <Tag componentId={`mlflow.skills.details.alias.${a}`} key={a}>
                  {a}
                </Tag>
              ))}
            </td>
            <td style={{ padding: theme.spacing.sm }}>
              {v.tags && Object.keys(v.tags).length > 0
                ? Object.entries(v.tags).map(([k, val]) => (
                    <Tag componentId={`mlflow.skills.details.tag.${k}`} key={k}>
                      {k}={val}
                    </Tag>
                  ))
                : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const SkillContentPreview = ({ content }: { content?: string }) => {
  const { theme } = useDesignSystemTheme();

  if (!content) return null;

  return (
    <div
      style={{
        backgroundColor: theme.colors.backgroundSecondary,
        borderRadius: theme.borders.borderRadiusSm,
        padding: theme.spacing.md,
        fontFamily: 'monospace',
        fontSize: theme.typography.fontSizeSm,
        whiteSpace: 'pre-wrap',
        maxHeight: 400,
        overflow: 'auto',
      }}
    >
      {content}
    </div>
  );
};

const SkillsDetailsPage = () => {
  const { skillName } = useParams<{ skillName: string }>();
  const { theme } = useDesignSystemTheme();
  const { skill, versions, error, isLoading } = useSkillDetailsQuery(skillName || '');

  if (isLoading) {
    return (
      <ScrollablePageWrapper>
        <div style={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
          <Spinner label="Loading skill details" />
        </div>
      </ScrollablePageWrapper>
    );
  }

  if (error) {
    return (
      <ScrollablePageWrapper>
        <Alert
          type="error"
          message={(error as Error).message}
          componentId="mlflow.skills.details.error"
          closable={false}
        />
      </ScrollablePageWrapper>
    );
  }

  const latestVersion = versions.length > 0 ? versions[versions.length - 1] : undefined;

  return (
    <ScrollablePageWrapper css={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Spacer shrinks={false} />
      <div css={{ marginBottom: theme.spacing.sm }}>
        <Link componentId="mlflow.skills.details.breadcrumb_link" to={Routes.skillsPageRoute}>
          <FormattedMessage defaultMessage="← Skills" description="Breadcrumb back to skills list" />
        </Link>
      </div>
      <Header
        title={
          <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            {skillName}
          </span>
        }
      />
      {skill?.description && (
        <Typography.Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.md, display: 'block' }}>
          {skill.description}
        </Typography.Text>
      )}
      <Spacer shrinks={false} />
      <div css={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', gap: theme.spacing.lg }}>
        <div>
          <Typography.Title level={4}>
            <FormattedMessage defaultMessage="Versions" description="Versions section title" />
          </Typography.Title>
          <SkillVersionsTable versions={versions} />
        </div>
        {latestVersion?.manifest_content && (
          <div>
            <Typography.Title level={4}>
              <FormattedMessage defaultMessage="SKILL.md (latest)" description="SKILL.md preview title" />
            </Typography.Title>
            <SkillContentPreview content={latestVersion.manifest_content} />
          </div>
        )}
      </div>
    </ScrollablePageWrapper>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, SkillsDetailsPage);
