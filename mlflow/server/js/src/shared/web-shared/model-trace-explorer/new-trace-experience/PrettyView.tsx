import { useState } from 'react';

import { ChevronDownIcon, ChevronRightIcon, useDesignSystemTheme } from '@databricks/design-system';

const KEY_COLOR = '#2272b4';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

const PrettyPrimitive = ({ value }: { value: unknown }) => {
  const { theme } = useDesignSystemTheme();
  if (value === null || value === undefined) {
    return <span css={{ color: theme.colors.textPlaceholder, fontFamily: MONO }}>null</span>;
  }
  if (typeof value === 'string') {
    if (isUrl(value)) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          css={{ color: theme.colors.textPrimary, textDecoration: 'underline', wordBreak: 'break-all' }}
        >
          {value}
        </a>
      );
    }
    return <span css={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span css={{ fontFamily: MONO }}>{String(value)}</span>;
  }
  return <span css={{ fontFamily: MONO }}>{String(value)}</span>;
};

type PrettyEntryProps = {
  label?: string | number;
  value: unknown;
  initialExpanded?: boolean;
};

// Renders a single key/value pair (when `label` is provided) or an unlabeled
// array item (when `label` is omitted). Array items deliberately do not show
// their numeric index — the count next to the parent "Array(N)" already
// conveys cardinality, and per-item "0/1/2" labels add visual noise.
const PrettyEntry = ({ label, value, initialExpanded = true }: PrettyEntryProps) => {
  const { theme } = useDesignSystemTheme();
  const [expanded, setExpanded] = useState(initialExpanded);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  if (isObject) {
    const count = isArray ? (value as unknown[]).length : Object.keys(value as object).length;
    return (
      <div css={{ display: 'flex', flexDirection: 'column' }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: theme.colors.textPrimary,
            textAlign: 'left',
          }}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {label !== undefined && (
            <span css={{ color: KEY_COLOR, fontFamily: MONO, fontWeight: 600 }}>{String(label)}</span>
          )}
          <span css={{ color: theme.colors.textSecondary, fontFamily: MONO, fontSize: theme.typography.fontSizeSm }}>
            {isArray ? `Array(${count})` : `{${count}}`}
          </span>
        </button>
        {expanded && (
          <div
            css={{
              paddingLeft: theme.spacing.lg,
              marginTop: theme.spacing.xs,
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
            }}
          >
            {isArray
              ? (value as unknown[]).map((v, i) => <PrettyEntry key={i} value={v} />)
              : Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                  <PrettyEntry key={k} label={k} value={v} />
                ))}
          </div>
        )}
      </div>
    );
  }

  if (label === undefined) {
    return <PrettyPrimitive value={value} />;
  }
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span css={{ color: KEY_COLOR, fontFamily: MONO, fontWeight: 600 }}>{String(label)}</span>
      <div css={{ paddingLeft: theme.spacing.lg, color: theme.colors.textPrimary }}>
        <PrettyPrimitive value={value} />
      </div>
    </div>
  );
};

// Renders a single payload's pretty tree. If the payload is itself an object,
// renders each top-level key as an entry at the root (no surrounding "inputs"
// or "outputs" wrapper). Primitive payloads render their own value.
export const PrettyView = ({ value }: { value: unknown }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        fontSize: theme.typography.fontSizeSm,
      }}
    >
      {value !== null && typeof value === 'object' && !Array.isArray(value) ? (
        Object.entries(value as Record<string, unknown>).map(([k, v]) => <PrettyEntry key={k} label={k} value={v} />)
      ) : Array.isArray(value) ? (
        value.map((v, i) => <PrettyEntry key={i} value={v} />)
      ) : (
        <PrettyPrimitive value={value} />
      )}
    </div>
  );
};
