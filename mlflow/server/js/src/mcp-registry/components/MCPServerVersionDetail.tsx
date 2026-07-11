import { useState } from 'react';
import {
  Alert,
  Button,
  ChevronDownIcon,
  DropdownMenu,
  Input,
  PencilIcon,
  Spacer,
  Tabs,
  Tag,
  TrashIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import type { MCPServer, MCPServerVersion, MCPStatus } from '../types';
import { STATUS_TAG_COLOR, STATUS_TRANSITIONS, resolveDisplayName, validateToolsJson } from '../utils';
import { ToolsSection } from './ServerJSONSection';
import { ConnectTab } from './connect/ConnectTab';
import { useMockPersona } from '../hooks/useMockPersona';
import { ConfirmationModal } from '../../admin/ConfirmationModal';
import { ModelVersionTableAliasesCell } from '../../model-registry/components/aliases/ModelVersionTableAliasesCell';
import { AliasTag } from '../../common/components/AliasTag';
import { useUpdateMCPServerVersion, useDeleteMCPServerVersion } from '../hooks/useMCPServerVersionMutations';
import { KeyValueTag } from '../../common/components/KeyValueTag';
import Utils from '../../common/utils/Utils';

const EMPTY_ALIASES: string[] = [];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const MCPServerVersionDetail = ({
  server,
  version,
  aliasesByVersion,
  showEditAliasesModal,
  onEditMetadata,
}: {
  server: MCPServer;
  version?: MCPServerVersion;
  aliasesByVersion: Record<string, string[]>;
  showEditAliasesModal?: (versionNumber: string) => void;
  onEditMetadata?: (version: MCPServerVersion) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [persona] = useMockPersona();
  const isAdmin = persona === 'admin';
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingTools, setEditingTools] = useState(false);
  const [toolsDraft, setToolsDraft] = useState('');
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const updateVersionMutation = useUpdateMCPServerVersion(server.name);
  const deleteVersionMutation = useDeleteMCPServerVersion(server.name);

  if (!version) {
    return (
      <div
        css={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.lg,
        }}
      >
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="Select a version to view details."
            description="MCP server detail placeholder when no version is selected"
          />
        </Typography.Text>
      </div>
    );
  }

  const displayName = resolveDisplayName(server);
  const versionDisplayName = version.display_name || version.server_json?.title;
  const hasTools = Boolean(version.tools && version.tools.length > 0);

  const startEditName = () => {
    setNameDraft(version.display_name || version.server_json?.title || '');
    updateVersionMutation.reset();
    setEditingName(true);
  };
  const saveName = () => {
    updateVersionMutation.mutate(
      { version: version.version, displayName: nameDraft },
      { onSuccess: () => setEditingName(false) },
    );
  };

  const handleStatusChange = (next: MCPStatus) => {
    if (next !== version.status) {
      updateVersionMutation.mutate({ version: version.version, status: next });
    }
  };

  const startEditTools = () => {
    setToolsDraft(hasTools ? JSON.stringify(version.tools, null, 2) : '');
    setToolsError(null);
    updateVersionMutation.reset();
    setEditingTools(true);
  };
  const saveTools = () => {
    if (!toolsDraft.trim()) {
      updateVersionMutation.mutate(
        { version: version.version, tools: [] },
        { onSuccess: () => setEditingTools(false) },
      );
      return;
    }
    const result = validateToolsJson(toolsDraft);
    if (!result.valid) {
      setToolsError(result.error ?? 'Invalid tools JSON');
      return;
    }
    updateVersionMutation.mutate(
      { version: version.version, tools: result.parsed ?? null },
      { onSuccess: () => setEditingTools(false) },
    );
  };

  const updateError = updateVersionMutation.error;

  return (
    <div css={{ flex: 1, padding: theme.spacing.md, overflow: 'auto' }}>
      <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.sm }}>
        <div css={{ minWidth: 0, flex: 1 }}>
          <Typography.Title level={3} withoutMargins>
            <FormattedMessage
              defaultMessage="Viewing version {version}"
              description="MCP server version detail heading"
              values={{ version: version.version }}
            />
          </Typography.Title>
          {editingName ? (
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
              <Input
                componentId="mlflow.mcp_registry.detail.version.display_name_input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                css={{ maxWidth: 320 }}
                placeholder={intl.formatMessage({
                  defaultMessage: 'Enter display name',
                  description: 'Placeholder for version display name input',
                })}
              />
              <Button
                componentId="mlflow.mcp_registry.detail.version.save_display_name"
                size="small"
                onClick={saveName}
                loading={updateVersionMutation.isLoading}
              >
                <FormattedMessage defaultMessage="Save" description="Save button" />
              </Button>
              <Button
                componentId="mlflow.mcp_registry.detail.version.cancel_display_name"
                size="small"
                type="tertiary"
                onClick={() => setEditingName(false)}
              >
                <FormattedMessage defaultMessage="Cancel" description="Cancel button" />
              </Button>
            </div>
          ) : (
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
              {versionDisplayName ? (
                <Typography.Text
                  color="secondary"
                  css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={versionDisplayName}
                >
                  {versionDisplayName}
                </Typography.Text>
              ) : (
                isAdmin && (
                  <Typography.Hint>
                    <FormattedMessage
                      defaultMessage="No display name"
                      description="Placeholder shown when a version has no display name"
                    />
                  </Typography.Hint>
                )
              )}
              {isAdmin && (
                <Button
                  componentId="mlflow.mcp_registry.detail.version.edit_display_name"
                  size="small"
                  type="link"
                  icon={<PencilIcon />}
                  aria-label={intl.formatMessage({
                    defaultMessage: 'Edit display name',
                    description: 'Aria label for edit display name button',
                  })}
                  onClick={startEditName}
                />
              )}
            </div>
          )}
          {version.server_json?.description && (
            <Typography.Hint css={{ marginTop: theme.spacing.xs }}>{version.server_json.description}</Typography.Hint>
          )}
        </div>
        {isAdmin && (
          <Button
            componentId="mlflow.mcp_registry.detail.delete_version"
            icon={<TrashIcon />}
            type="primary"
            danger
            onClick={() => setDeleteModalVisible(true)}
            css={{ flexShrink: 0 }}
          >
            <FormattedMessage defaultMessage="Delete version" description="MCP server delete version button" />
          </Button>
        )}
      </div>

      {updateError && (
        <Alert
          componentId="mlflow.mcp_registry.detail.version.update_error"
          type="error"
          closable
          onClose={() => updateVersionMutation.reset()}
          message={updateError instanceof Error ? updateError.message : String(updateError)}
          css={{ marginTop: theme.spacing.sm }}
        />
      )}

      <Spacer shrinks={false} />
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          gridAutoRows: `minmax(${theme.typography.lineHeightLg}, auto)`,
          alignItems: 'center',
          rowGap: theme.spacing.xs,
          columnGap: theme.spacing.sm,
        }}
      >
        <Typography.Text bold>
          <FormattedMessage defaultMessage="Name:" description="MCP server version detail name label" />
        </Typography.Text>
        <Typography.Text>{server.name}</Typography.Text>

        <Typography.Text bold>
          <FormattedMessage defaultMessage="Aliases:" description="MCP server version detail aliases label" />
        </Typography.Text>
        <div>
          {isAdmin ? (
            <ModelVersionTableAliasesCell
              css={{ maxWidth: 'none' }}
              modelName={server.name}
              version={version.version}
              aliases={aliasesByVersion[version.version] ?? EMPTY_ALIASES}
              onAddEdit={() => {
                showEditAliasesModal?.(version.version);
              }}
            />
          ) : (aliasesByVersion[version.version] ?? EMPTY_ALIASES).length > 0 ? (
            <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {(aliasesByVersion[version.version] ?? EMPTY_ALIASES).map((alias) => (
                <AliasTag key={alias} value={alias} />
              ))}
            </div>
          ) : (
            <Typography.Hint>—</Typography.Hint>
          )}
        </div>

        <Typography.Text bold>
          <FormattedMessage defaultMessage="Status:" description="MCP server version detail status label" />
        </Typography.Text>
        <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          {isAdmin ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label={intl.formatMessage({
                    defaultMessage: 'Change status',
                    description: 'Aria label for the version status dropdown trigger',
                  })}
                  css={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <Tag componentId="mlflow.mcp_registry.detail.version_status" color={STATUS_TAG_COLOR[version.status]}>
                    {version.status}
                  </Tag>
                  <ChevronDownIcon css={{ fontSize: theme.typography.fontSizeSm, color: theme.colors.textSecondary }} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start">
                {(['draft', 'active', 'deprecated'] as MCPStatus[]).map((s) => (
                  <DropdownMenu.Item
                    key={s}
                    componentId="mlflow.mcp_registry.detail.version.status_option"
                    disabled={s !== version.status && !STATUS_TRANSITIONS[version.status]?.includes(s)}
                    onClick={() => handleStatusChange(s)}
                  >
                    {capitalize(s)}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          ) : (
            <Tag componentId="mlflow.mcp_registry.detail.version_status" color={STATUS_TAG_COLOR[version.status]}>
              {version.status}
            </Tag>
          )}
        </span>

        {version.server_json?.websiteUrl && (
          <>
            <Typography.Text bold>
              <FormattedMessage defaultMessage="Website:" description="MCP server version detail website label" />
            </Typography.Text>
            <Typography.Link
              componentId="mlflow.mcp_registry.detail.website"
              href={version.server_json.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {version.server_json.websiteUrl}
            </Typography.Link>
          </>
        )}

        {version.server_json?.repository?.url && (
          <>
            <Typography.Text bold>
              <FormattedMessage defaultMessage="Repository:" description="MCP server version detail repository label" />
            </Typography.Text>
            <Typography.Link
              componentId="mlflow.mcp_registry.detail.repository"
              href={version.server_json.repository.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {version.server_json.repository.url}
            </Typography.Link>
          </>
        )}

        <Typography.Text bold>
          <FormattedMessage defaultMessage="Created:" description="MCP server version detail registered at label" />
        </Typography.Text>
        <Typography.Text>
          {version.creation_timestamp ? Utils.formatTimestamp(version.creation_timestamp, intl) : '—'}
        </Typography.Text>

        <Typography.Text bold>
          <FormattedMessage defaultMessage="Metadata:" description="MCP server version detail metadata label" />
        </Typography.Text>
        <div>
          <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs, alignItems: 'center' }}>
            {Object.keys(version.tags ?? {}).length > 0
              ? Object.entries(version.tags ?? {}).map(([key, value]) => (
                  <KeyValueTag css={{ margin: 0 }} key={key} tag={{ key, value }} />
                ))
              : !onEditMetadata && <Typography.Hint>—</Typography.Hint>}
            {onEditMetadata &&
              (Object.keys(version.tags ?? {}).length > 0 ? (
                <Button
                  componentId="mlflow.mcp_registry.detail.version.edit_metadata"
                  size="small"
                  icon={<PencilIcon />}
                  aria-label={intl.formatMessage({
                    defaultMessage: 'Edit metadata',
                    description: 'Aria label for edit metadata button',
                  })}
                  onClick={() => onEditMetadata(version)}
                />
              ) : (
                <Button
                  componentId="mlflow.mcp_registry.detail.version.add_metadata"
                  size="small"
                  type="link"
                  onClick={() => onEditMetadata(version)}
                >
                  <FormattedMessage defaultMessage="Add" description="MCP server version detail add metadata button" />
                </Button>
              ))}
          </div>
        </div>
      </div>

      <Tabs.Root
        key={version.version}
        componentId="mlflow.mcp_registry.detail.version_tabs"
        valueHasNoPii
        defaultValue="connect"
        css={{ marginTop: theme.spacing.md, '& svg': { width: 14, height: 14 } }}
      >
        <Tabs.List>
          <Tabs.Trigger value="connect">
            <FormattedMessage defaultMessage="Connect" description="MCP server version detail connect tab" />
          </Tabs.Trigger>
          <Tabs.Trigger value="tools">
            {hasTools ? (
              <FormattedMessage
                defaultMessage="Tools ({count})"
                description="MCP server version detail tools tab with count"
                values={{ count: version.tools?.length ?? 0 }}
              />
            ) : (
              <FormattedMessage defaultMessage="Tools" description="MCP server version detail tools tab" />
            )}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="connect" css={{ paddingTop: theme.spacing.md }}>
          <ConnectTab server={server} version={version} isAdmin={isAdmin} />
        </Tabs.Content>

        <Tabs.Content value="tools" css={{ paddingTop: theme.spacing.md }}>
          {editingTools ? (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {toolsError && (
                <Alert
                  componentId="mlflow.mcp_registry.detail.version.tools_validation_error"
                  type="error"
                  closable
                  onClose={() => setToolsError(null)}
                  message={toolsError}
                />
              )}
              <Input.TextArea
                componentId="mlflow.mcp_registry.detail.version.edit_tools_input"
                value={toolsDraft}
                onChange={(e) => {
                  setToolsDraft(e.target.value);
                  setToolsError(null);
                }}
                autoSize={{ minRows: 6, maxRows: 16 }}
                css={{ fontFamily: 'monospace' }}
                placeholder={intl.formatMessage({
                  defaultMessage: 'Enter tools JSON array',
                  description: 'Placeholder for version tools input',
                })}
              />
              <div css={{ display: 'flex', gap: theme.spacing.sm }}>
                <Button
                  componentId="mlflow.mcp_registry.detail.version.save_tools"
                  type="primary"
                  onClick={saveTools}
                  loading={updateVersionMutation.isLoading}
                >
                  <FormattedMessage defaultMessage="Save" description="Save button" />
                </Button>
                <Button
                  componentId="mlflow.mcp_registry.detail.version.cancel_tools"
                  type="tertiary"
                  onClick={() => setEditingTools(false)}
                >
                  <FormattedMessage defaultMessage="Cancel" description="Cancel button" />
                </Button>
              </div>
            </div>
          ) : (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {isAdmin && (
                <div css={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    componentId="mlflow.mcp_registry.detail.version.edit_tools"
                    size="small"
                    icon={<PencilIcon />}
                    onClick={startEditTools}
                  >
                    {hasTools ? (
                      <FormattedMessage defaultMessage="Edit tools" description="Edit tools button" />
                    ) : (
                      <FormattedMessage defaultMessage="Add tools" description="Add tools button" />
                    )}
                  </Button>
                </div>
              )}
              {hasTools ? (
                <ToolsSection tools={version.tools ?? []} />
              ) : (
                <Typography.Hint>
                  <FormattedMessage
                    defaultMessage="No tools declared for this version."
                    description="Empty state for the MCP server version tools tab"
                  />
                </Typography.Hint>
              )}
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>

      <ConfirmationModal
        componentId="mlflow.mcp_registry.detail.delete_version_modal"
        title={intl.formatMessage({
          defaultMessage: 'Delete version',
          description: 'MCP server delete version confirmation modal title',
        })}
        visible={deleteModalVisible}
        message={
          <FormattedMessage
            defaultMessage="Are you sure you want to delete version {version}? This action cannot be undone."
            description="MCP server delete version confirmation message"
            values={{ version: version.version }}
          />
        }
        isLoading={deleteVersionMutation.isLoading}
        error={deleteVersionMutation.error?.message ?? null}
        onConfirm={() => {
          deleteVersionMutation.mutate(version.version, {
            onSuccess: () => setDeleteModalVisible(false),
          });
        }}
        onCancel={() => {
          deleteVersionMutation.reset();
          setDeleteModalVisible(false);
        }}
      />
    </div>
  );
};
