import { ScrollablePageWrapper } from '@mlflow/mlflow/src/common/components/ScrollablePageWrapper';
import { useSkillDetailsQuery } from './hooks/useSkillDetailsQuery';
import {
  Alert,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DropdownMenu,
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
  Table,
  TableCell,
  TableHeader,
  TableRow,
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
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { RegisteredSkillVersion, SkillVersionFile } from './types';
import { RegisteredSkillsApi } from './api';
import { CopyButton } from '@mlflow/mlflow/src/shared/building_blocks/CopyButton';
import { CodeSnippet } from '@databricks/web-shared/snippet';

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

const CodeBlock = ({
  code,
  language = 'bash',
  componentId,
}: {
  code: string;
  language?: 'bash' | 'python';
  componentId: string;
}) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ position: 'relative' }}>
      <CopyButton
        css={{ zIndex: 1, position: 'absolute', top: theme.spacing.xs, right: theme.spacing.xs }}
        showLabel={false}
        copyText={code}
        icon={<CopyIcon />}
        componentId={componentId}
      />
      <CodeSnippet
        language={language as any}
        showLineNumbers={false}
        style={{
          padding: theme.spacing.md,
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.backgroundSecondary,
          whiteSpace: 'pre-wrap',
          fontSize: theme.typography.fontSizeSm,
          lineHeight: 1.6,
        }}
        wrapLongLines
      >
        {code}
      </CodeSnippet>
    </div>
  );
};

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
  const [tab, setTab] = useState<'cli' | 'python'>('cli');

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
        <SegmentedControlGroup
          componentId="mlflow.skills.use_modal.tabs"
          name="use-tab"
          value={tab}
          onChange={(e) => setTab(e.target.value as 'cli' | 'python')}
        >
          <SegmentedControlButton value="cli">CLI</SegmentedControlButton>
          <SegmentedControlButton value="python">Python</SegmentedControlButton>
        </SegmentedControlGroup>

        {tab === 'cli' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              <Typography.Text bold>Install for all projects (global)</Typography.Text>
              <Typography.Text color="secondary" style={{ fontSize: theme.typography.fontSizeSm }}>
                Makes this skill available in Claude Code across every project on this machine.
              </Typography.Text>
              <CodeBlock
                code={`mlflow skills load ${skillName} --version ${version} --scope global`}
                componentId="mlflow.skills.use_modal.copy_global"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              <Typography.Text bold>Install for current project only</Typography.Text>
              <Typography.Text color="secondary" style={{ fontSize: theme.typography.fontSizeSm }}>
                Installs the skill into <code>.claude/skills/</code> in your current working directory.
              </Typography.Text>
              <CodeBlock
                code={`mlflow skills load ${skillName} --version ${version} --scope project`}
                componentId="mlflow.skills.use_modal.copy_project"
              />
            </div>
          </div>
        )}

        {tab === 'python' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              <Typography.Text bold>Load skill metadata</Typography.Text>
              <Typography.Text color="secondary" style={{ fontSize: theme.typography.fontSizeSm }}>
                Fetch version details from the registry without installing files.
              </Typography.Text>
              <CodeBlock
                language="python"
                code={`import mlflow.genai\n\nskill = mlflow.genai.load_skill("${skillName}", version=${version})\nprint(skill.name, skill.version, skill.source)`}
                componentId="mlflow.skills.use_modal.copy_load"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              <Typography.Text bold>Install to local filesystem</Typography.Text>
              <Typography.Text color="secondary" style={{ fontSize: theme.typography.fontSizeSm }}>
                Download the skill files so Claude Code can use them. Use <code>scope="project"</code> to install in the
                current directory only.
              </Typography.Text>
              <CodeBlock
                language="python"
                code={`path = mlflow.genai.install_skill("${skillName}", version=${version}, scope="global")\nprint(f"Installed to {path}")`}
                componentId="mlflow.skills.use_modal.copy_install"
              />
            </div>
          </div>
        )}
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
    <Table aria-label="Skill versions">
      <TableRow isHeader>
        <TableHeader componentId="mlflow.skills.details.versions.col.version">Version</TableHeader>
        <TableHeader componentId="mlflow.skills.details.versions.col.created">Created</TableHeader>
        <TableHeader componentId="mlflow.skills.details.versions.col.created_by">Created by</TableHeader>
        <TableHeader componentId="mlflow.skills.details.versions.col.aliases">Aliases</TableHeader>
        <TableHeader componentId="mlflow.skills.details.versions.col.tags">Tags</TableHeader>
      </TableRow>
      {sortedVersions.map((v) => {
        const isSelected = v.version === selectedVersion;
        const vUserTags = getUserTags(v.tags);
        return (
          <TableRow
            key={v.version}
            onClick={() => onSelectVersion(v.version)}
            css={{
              cursor: 'pointer',
              backgroundColor: isSelected ? theme.colors.actionTertiaryBackgroundHover : undefined,
              '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
            }}
          >
            <TableCell>
              <Typography.Text bold={isSelected}>{v.version}</Typography.Text>
            </TableCell>
            <TableCell>
              <Typography.Text color="secondary">
                {v.creation_timestamp ? formatRelativeTime(v.creation_timestamp) : '—'}
              </Typography.Text>
            </TableCell>
            <TableCell>
              <Typography.Text color="secondary">{v.created_by ?? '—'}</Typography.Text>
            </TableCell>
            <TableCell>
              <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
                {v.aliases?.map((a) => (
                  <Tag componentId={`mlflow.skills.details.version.alias.${a}`} key={a}>
                    {a}
                  </Tag>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
                {vUserTags.map((t) => (
                  <Tag componentId={`mlflow.skills.details.version.tag.${t}`} key={t}>
                    {t}
                  </Tag>
                ))}
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
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

type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  content?: string | null;
  depth: number;
};

const FileExplorer = ({ skillName, version }: { skillName: string; version: number }) => {
  const { theme } = useDesignSystemTheme();
  const [files, setFiles] = useState<SkillVersionFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!skillName || !version) return;
    setIsLoading(true);
    RegisteredSkillsApi.getSkillVersionFiles(skillName, version)
      .then((data) => {
        setFiles(data);
        setExpandedFolders(new Set(data.filter((f) => f.is_dir).map((f) => f.path)));
        const first = data.find((f) => !f.is_dir && f.path === 'SKILL.md') ?? data.find((f) => !f.is_dir);
        setSelectedPath(first?.path ?? null);
      })
      .catch(() => setFiles([]))
      .finally(() => setIsLoading(false));
  }, [skillName, version]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const treeNodes: TreeNode[] = [...files]
    .sort((a, b) => {
      const aDir = a.is_dir ? 0 : 1;
      const bDir = b.is_dir ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.path.localeCompare(b.path);
    })
    .map((f) => ({
      name: f.path.split('/').pop() ?? f.path,
      path: f.path,
      isDir: f.is_dir,
      content: f.content,
      depth: f.path.split('/').length - 1,
    }));

  const activeFile = files.find((f) => !f.is_dir && f.path === selectedPath);

  if (isLoading) {
    return (
      <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
        <Spinner />
      </div>
    );
  }

  if (!files.some((f) => !f.is_dir)) {
    return <div css={{ color: theme.colors.textSecondary, padding: theme.spacing.md }}>No files available.</div>;
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
        <div
          css={{
            padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            borderBottom: `1px solid ${theme.colors.borderDecorative}`,
          }}
        >
          <FolderIcon css={{ color: theme.colors.textSecondary }} />
          <Typography.Text bold css={{ fontSize: theme.typography.fontSizeSm }}>
            Files
          </Typography.Text>
        </div>
        {treeNodes.map((node) => {
          // Hide if any ancestor folder is collapsed
          const parts = node.path.split('/');
          const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
          if (ancestors.some((a) => !expandedFolders.has(a))) return null;

          const indent = node.depth * 12 + theme.spacing.sm;

          if (node.isDir) {
            const isExpanded = expandedFolders.has(node.path);
            return (
              <div
                key={node.path}
                onClick={() => toggleFolder(node.path)}
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                  paddingLeft: indent,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSizeSm,
                  '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
                }}
              >
                {isExpanded ? (
                  <ChevronDownIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
                ) : (
                  <ChevronRightIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
                )}
                <FolderIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
                <span css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
              </div>
            );
          }

          return (
            <div
              key={node.path}
              onClick={() => setSelectedPath(node.path)}
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.xs,
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                paddingLeft: indent,
                cursor: 'pointer',
                fontSize: theme.typography.fontSizeSm,
                backgroundColor:
                  node.path === selectedPath ? theme.colors.actionTertiaryBackgroundHover : 'transparent',
                '&:hover': { backgroundColor: theme.colors.actionTertiaryBackgroundHover },
              }}
            >
              {getFileIcon(node.name)}
              <span css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={node.path}>
                {node.name}
              </span>
            </div>
          );
        })}
      </div>
      {/* File content */}
      <div css={{ flex: 1, overflow: 'auto', padding: theme.spacing.md }}>
        {selectedPath?.endsWith('.md') ? (
          <GenAIMarkdownRenderer urlTransform={defaultUrlTransform}>{activeFile?.content ?? ''}</GenAIMarkdownRenderer>
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
            {activeFile?.content ?? (activeFile && activeFile.content === null ? '(binary or large file)' : '')}
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
  const [activeTab, setActiveTab] = useState<'files' | 'versions' | 'usage'>('versions');

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
  const commitHash = activeVersion?.tags?.['mlflow.skill.commit_hash'];
  const shortHash = commitHash?.slice(0, 7);

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

  return (
    <ScrollablePageWrapper
      css={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: `0 ${theme.spacing.lg}px`,
      }}
    >
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
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <span
                  role="button"
                  css={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: theme.colors.actionPrimaryBackgroundDefault,
                    color: theme.colors.actionPrimaryTextDefault,
                    borderRadius: theme.borders.borderRadiusSm,
                    padding: `0 ${theme.spacing.xs}px`,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: '20px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    '&:hover': {
                      opacity: 0.85,
                    },
                  }}
                >
                  v{activeVersionNum}
                  <ChevronDownIcon css={{ fontSize: 10 }} />
                </span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {[...versions]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <DropdownMenu.Item
                      key={v.version}
                      componentId={`mlflow.skills.details.version_select.${v.version}`}
                      onClick={() => setSelectedVersionNum(v.version)}
                    >
                      <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                        <span css={{ minWidth: 40 }}>v{v.version}</span>
                        {v.version === latestVersion && (
                          <Tag componentId="mlflow.skills.details.version_latest_tag" color="indigo">
                            latest
                          </Tag>
                        )}
                      </span>
                    </DropdownMenu.Item>
                  ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </span>
        }
        buttons={
          <Button componentId="mlflow.skills.details.use" type="primary" onClick={() => setUseModalVisible(true)}>
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
            href={shortHash ? `${activeVersion?.source}/tree/${commitHash}` : activeVersion?.source}
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
            <span css={{ fontFamily: 'monospace', fontSize: 12 }}>
              {sourceLabel}
              {shortHash && <span css={{ fontSize: 10, opacity: 0.75 }}>({shortHash})</span>}
            </span>
          </a>
        )}
        {activeVersion?.creation_timestamp && (
          <span>Updated {formatRelativeTime(activeVersion.creation_timestamp)}</span>
        )}
      </div>

      {/* Description */}
      {skill?.description && (
        <Typography.Text
          css={{
            color: theme.colors.textSecondary,
            display: 'block',
            marginTop: theme.spacing.md,
            fontSize: theme.typography.fontSizeMd,
            lineHeight: 1.5,
          }}
        >
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

      {/* Tabs: Versions | Usage | Files */}
      <div css={{ borderBottom: `1px solid ${theme.colors.borderDecorative}`, display: 'flex', gap: 0 }}>
        {(
          [
            ['versions', 'Versions'],
            ['usage', 'Usage'],
            ['files', 'Files'],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            css={{
              background: 'none',
              border: 'none',
              borderBottom:
                activeTab === tab
                  ? `2px solid ${theme.colors.actionPrimaryBackgroundDefault}`
                  : '2px solid transparent',
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? theme.colors.textPrimary : theme.colors.textSecondary,
              fontSize: theme.typography.fontSizeMd,
              '&:hover': { color: theme.colors.textPrimary },
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content — fills remaining space */}
      <div css={{ flex: 1, overflow: 'auto', paddingTop: theme.spacing.md }}>
        {activeTab === 'files' && <FileExplorer skillName={skillName || ''} version={activeVersionNum} />}

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
