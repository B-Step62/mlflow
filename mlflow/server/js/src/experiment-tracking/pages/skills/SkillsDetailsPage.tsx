import { ScrollablePageWrapper } from '@mlflow/mlflow/src/common/components/ScrollablePageWrapper';
import { useSkillDetailsQuery } from './hooks/useSkillDetailsQuery';
import {
  Alert,
  Button,
  FileCodeIcon,
  FileDocumentIcon,
  FileIcon,
  FolderIcon,
  Header,
  LightningIcon,
  Modal,
  SegmentedControlButton,
  SegmentedControlGroup,
  Spacer,
  Spinner,
  Tag,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { GenAIMarkdownRenderer } from '../../../shared/web-shared/genai-markdown-renderer';
import { defaultUrlTransform } from 'react-markdown-10';
import { FormattedMessage } from 'react-intl';
import { useParams } from '../../../common/utils/RoutingUtils';
import { Link } from '../../../common/utils/RoutingUtils';
import Routes from '../../routes';
import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { useState, useCallback, useMemo } from 'react';
import type { RegisteredSkillVersion } from './types';
import { CopyButton } from '@mlflow/mlflow/src/shared/building_blocks/CopyButton';

const INTERNAL_TAG_PREFIX = 'mlflow.';

const getUserTags = (tags?: Record<string, string>): string[] => {
  if (!tags) return [];
  return Object.keys(tags).filter((key) => !key.startsWith(INTERNAL_TAG_PREFIX));
};

const formatRelativeTime = (timestamp?: number): string | null => {
  if (!timestamp) return null;
  const now = Date.now();
  const diffMs = now - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) {
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
};

const GitHubIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

// ============================================================================
// "Use" Modal — CLI + Python snippets
// ============================================================================

const UseSkillModal = ({
  skillName,
  version,
  visible,
  onClose,
}: {
  skillName: string;
  version: number;
  visible: boolean;
  onClose: () => void;
}) => {
  const { theme } = useDesignSystemTheme();

  const cliSnippet = `# Install to Claude Code (global)
mlflow skills load ${skillName} --version ${version} --scope global

# Install to current project
mlflow skills load ${skillName} --version ${version} --scope project`;

  const pythonSnippet = `import mlflow.genai

# Load skill metadata
skill = mlflow.genai.load_skill("${skillName}", version=${version})
print(skill.manifest_content)

# Install to local filesystem
path = mlflow.genai.install_skill("${skillName}", version=${version}, scope="global")
print(f"Installed to {path}")`;

  const [tab, setTab] = useState<'cli' | 'python'>('cli');
  const activeSnippet = tab === 'cli' ? cliSnippet : pythonSnippet;

  if (!visible) return null;

  return (
    <Modal
      componentId="mlflow.skills.use_modal"
      title={`Use "${skillName}"`}
      visible
      onCancel={onClose}
      onOk={onClose}
      okText="Done"
      cancelButtonProps={{ style: { display: 'none' } }}
      size="wide"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <SegmentedControlGroup componentId="mlflow.skills.use_modal.tabs" name="use-tab" value={tab} onChange={(e) => setTab(e.target.value as 'cli' | 'python')}>
          <SegmentedControlButton value="cli">CLI</SegmentedControlButton>
          <SegmentedControlButton value="python">Python</SegmentedControlButton>
        </SegmentedControlGroup>
        <div style={{ position: 'relative' }}>
          <pre
            style={{
              backgroundColor: theme.colors.backgroundSecondary,
              borderRadius: theme.borders.borderRadiusSm,
              padding: theme.spacing.md,
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSizeSm,
              overflowX: 'auto',
              margin: 0,
            }}
          >
            {activeSnippet}
          </pre>
          <div style={{ position: 'absolute', top: theme.spacing.xs, right: theme.spacing.xs }}>
            <CopyButton copyText={activeSnippet} showLabel={false} componentId="mlflow.skills.use_modal.copy" />
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ============================================================================
// Versions section — collapsible, selectable
// ============================================================================

const VersionsList = ({
  versions,
  selectedVersion,
  onSelectVersion,
}: {
  versions: RegisteredSkillVersion[];
  selectedVersion: number;
  onSelectVersion: (v: number) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const sortedVersions = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {sortedVersions.map((v) => {
        const isSelected = v.version === selectedVersion;
        const vUserTags = getUserTags(v.tags);
        return (
          <div
            key={v.version}
            onClick={() => onSelectVersion(v.version)}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              padding: theme.spacing.sm,
              borderRadius: theme.borders.borderRadiusSm,
              cursor: 'pointer',
              backgroundColor: isSelected ? theme.colors.actionTertiaryBackgroundHover : 'transparent',
              '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
            }}
          >
            <span css={{ fontWeight: isSelected ? 600 : 400, minWidth: 36 }}>v{v.version}</span>
            {v.creation_timestamp && (
              <span css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
                {formatRelativeTime(v.creation_timestamp)}
              </span>
            )}
            {v.aliases?.map((a) => (
              <Tag componentId={`mlflow.skills.details.version.alias.${a}`} key={a}>
                {a}
              </Tag>
            ))}
            {vUserTags.map((t) => (
              <Tag componentId={`mlflow.skills.details.version.tag.${t}`} key={t}>
                {t}
              </Tag>
            ))}
          </div>
        );
      })}
    </div>
  );
};

// ============================================================================
// File Explorer — artifact-style tree
// ============================================================================

const getFileIcon = (filename: string) => {
  if (filename === 'SKILL.md') return <FileDocumentIcon />;
  if (filename.endsWith('.py') || filename.endsWith('.sh') || filename.endsWith('.ts')) return <FileCodeIcon />;
  return <FileIcon />;
};

const FileExplorer = ({ content }: { content?: string }) => {
  const { theme } = useDesignSystemTheme();
  const [selectedFile, setSelectedFile] = useState<string>('SKILL.md');

  // Parse manifest content to extract file structure
  // For now, we show SKILL.md as the primary file since that's what we store
  const files = useMemo(() => {
    const result: { name: string; content: string }[] = [];
    if (content) {
      result.push({ name: 'SKILL.md', content });
    }
    return result;
  }, [content]);

  const activeFile = files.find((f) => f.name === selectedFile);

  if (!files.length) {
    return (
      <div css={{ color: theme.colors.textSecondary, padding: theme.spacing.md }}>
        No files available.
      </div>
    );
  }

  return (
    <div
      css={{
        display: 'flex',
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusSm,
        overflow: 'hidden',
        minHeight: 300,
        maxHeight: 500,
      }}
    >
      {/* File tree sidebar */}
      <div
        css={{
          width: 200,
          borderRight: `1px solid ${theme.colors.borderDecorative}`,
          backgroundColor: theme.colors.backgroundSecondary,
          overflow: 'auto',
          flexShrink: 0,
        }}
      >
        <div css={{ padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`, display: 'flex', alignItems: 'center', gap: theme.spacing.xs, borderBottom: `1px solid ${theme.colors.borderDecorative}` }}>
          <FolderIcon css={{ color: theme.colors.textSecondary }} />
          <Typography.Text bold css={{ fontSize: theme.typography.fontSizeSm }}>Files</Typography.Text>
        </div>
        {files.map((f) => (
          <div
            key={f.name}
            onClick={() => setSelectedFile(f.name)}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.xs,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              cursor: 'pointer',
              fontSize: theme.typography.fontSizeSm,
              backgroundColor: f.name === selectedFile ? theme.colors.actionTertiaryBackgroundHover : 'transparent',
              '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
            }}
          >
            {getFileIcon(f.name)}
            {f.name}
          </div>
        ))}
      </div>
      {/* File content */}
      <div css={{ flex: 1, overflow: 'auto', padding: theme.spacing.md }}>
        {selectedFile.endsWith('.md') ? (
          <GenAIMarkdownRenderer urlTransform={defaultUrlTransform}>
            {activeFile?.content || ''}
          </GenAIMarkdownRenderer>
        ) : (
          <pre
            css={{
              margin: 0,
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSizeSm,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}
          >
            {activeFile?.content || ''}
          </pre>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Main Details Page
// ============================================================================

const SkillsDetailsPage = () => {
  const { skillName } = useParams<{ skillName: string }>();
  const { theme } = useDesignSystemTheme();
  const { skill, versions, error, isLoading } = useSkillDetailsQuery(skillName || '');
  const [useModalVisible, setUseModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'versions' | 'usage'>('files');

  // Version selection — default to latest
  const latestVersion = useMemo(
    () => (versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 1),
    [versions],
  );
  const [selectedVersionNum, setSelectedVersionNum] = useState<number | null>(null);
  const activeVersionNum = selectedVersionNum ?? latestVersion;
  const activeVersion = useMemo(
    () => versions.find((v) => v.version === activeVersionNum),
    [versions, activeVersionNum],
  );

  const userTags = getUserTags(activeVersion?.tags);
  const sourceLabel = activeVersion?.source?.replace(/^https?:\/\/(www\.)?github\.com\//, '');
  const isGitHub = activeVersion?.source?.includes('github.com');

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
        <Alert type="error" message={(error as Error).message} componentId="mlflow.skills.details.error" closable={false} />
      </ScrollablePageWrapper>
    );
  }

  return (
    <ScrollablePageWrapper css={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, padding: `0 ${theme.spacing.lg}px` }}>
      <Spacer shrinks={false} size="lg" />

      {/* Breadcrumb */}
      <div css={{ marginBottom: theme.spacing.md }}>
        <Link componentId="mlflow.skills.details.breadcrumb_link" to={Routes.skillsPageRoute}>
          <FormattedMessage defaultMessage="← Skills" description="Breadcrumb back to skills list" />
        </Link>
      </div>

      {/* Header: icon + name + version + "Use" button */}
      <Header
        title={
          <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
            <span
              css={{
                display: 'flex',
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
              }}
            >
              <LightningIcon />
            </span>
            {skillName}
            <span
              css={{
                backgroundColor: theme.colors.actionPrimaryBackgroundDefault,
                color: theme.colors.actionPrimaryTextDefault,
                borderRadius: theme.borders.borderRadiusSm,
                padding: `0 ${theme.spacing.xs}px`,
                fontSize: 12,
                fontWeight: 600,
                lineHeight: '20px',
              }}
            >
              v{activeVersionNum}
            </span>
          </span>
        }
        buttons={
          <Button
            componentId="mlflow.skills.details.use"
            type="primary"
            onClick={() => setUseModalVisible(true)}
          >
            Use
          </Button>
        }
      />

      {/* Meta row: source + updated — above description */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          fontSize: theme.typography.fontSizeSm,
          color: theme.colors.textSecondary,
          flexWrap: 'wrap',
          marginTop: theme.spacing.md,
        }}
      >
        {sourceLabel && (
          <a
            href={activeVersion?.source}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            css={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              lineHeight: 1,
              color: theme.colors.actionPrimaryBackgroundDefault,
              textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {isGitHub && <GitHubIcon />}
            <span css={{ fontFamily: 'monospace', fontSize: 12 }}>{sourceLabel}</span>
          </a>
        )}
        {activeVersion?.creation_timestamp && (
          <span>Updated {formatRelativeTime(activeVersion.creation_timestamp)}</span>
        )}
      </div>

      {/* Description */}
      {skill?.description && (
        <Typography.Text css={{ color: theme.colors.textSecondary, display: 'block', marginTop: theme.spacing.md, fontSize: theme.typography.fontSizeMd, lineHeight: 1.5 }}>
          {skill.description}
        </Typography.Text>
      )}

      {/* Tags */}
      {userTags.length > 0 && (
        <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap', marginTop: theme.spacing.md }}>
          {userTags.map((tag) => (
            <Tag componentId={`mlflow.skills.details.meta.tag.${tag}`} key={tag}>
              {tag}
            </Tag>
          ))}
        </div>
      )}

      <Spacer shrinks={false} size="lg" />

      {/* Tabs: Files | Versions | Usage */}
      <div css={{ borderBottom: `1px solid ${theme.colors.borderDecorative}`, display: 'flex', gap: 0 }}>
        {(['files', 'versions', 'usage'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            css={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? `2px solid ${theme.colors.actionPrimaryBackgroundDefault}` : '2px solid transparent',
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? theme.colors.textPrimary : theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeMd,
              '&:hover': { color: theme.colors.textPrimary },
            }}
          >
            {tab === 'files' && 'Files'}
            {tab === 'versions' && `Versions (${versions.length})`}
            {tab === 'usage' && 'Usage'}
          </button>
        ))}
      </div>

      {/* Tab content — fills remaining space */}
      <div css={{ flex: 1, overflow: 'auto', paddingTop: theme.spacing.md }}>
        {activeTab === 'files' && (
          <FileExplorer content={activeVersion?.manifest_content} />
        )}

        {activeTab === 'versions' && (
          <VersionsList
            versions={versions}
            selectedVersion={activeVersionNum}
            onSelectVersion={setSelectedVersionNum}
          />
        )}

        {activeTab === 'usage' && (
          <div
            css={{
              border: `1px dashed ${theme.colors.borderDecorative}`,
              borderRadius: theme.borders.borderRadiusSm,
              padding: theme.spacing.lg,
              textAlign: 'center',
              color: theme.colors.textSecondary,
            }}
          >
            To be constructed — skill usage analytics and trace linkage will appear here.
          </div>
        )}
      </div>

      <UseSkillModal
        skillName={skillName || ''}
        version={activeVersionNum}
        visible={useModalVisible}
        onClose={() => setUseModalVisible(false)}
      />
    </ScrollablePageWrapper>
  );
};

export default withErrorBoundary(ErrorUtils.mlflowServices.EXPERIMENTS, SkillsDetailsPage);
