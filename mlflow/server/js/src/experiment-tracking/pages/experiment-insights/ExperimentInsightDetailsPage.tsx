import React, { useMemo, useRef, useState } from 'react';
import invariant from 'invariant';
import { useParams } from '../../../common/utils/RoutingUtils';
import {
  useDesignSystemTheme,
  Button,
  DropdownMenu,
  Input,
  LegacySkeleton,
  LegacyTooltip,
  Header,
  Breadcrumb,
  OverflowIcon,
} from '@databricks/design-system';
import { ScrollablePageWrapper } from '../../../common/components/ScrollablePageWrapper';
import AiLogoUrl from './components/ai-logo.svg';

/**
 * Insight Details — skeleton-first implementation.
 * This page renders layout and placeholders per .agent/specs/insight-details.md.
 * Data wiring will be added later.
 */

const Chip: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <span
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${theme.colors.borderDecorative}`,
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.backgroundDecorative,
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      <strong css={{ fontWeight: 600 }}>{label}</strong>
      {value ? <span>{value}</span> : null}
    </span>
  );
};

const SectionCard: React.FC<{ title: string; right?: React.ReactNode; children?: React.ReactNode }> = ({
  title,
  right,
  children,
}) => {
  const { theme } = useDesignSystemTheme();
  return (
    <section
      css={{
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusMd,
        background: theme.colors.backgroundPrimary,
      }}
    >
      <header
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${theme.spacing.md}px ${theme.spacing.md}px`,
        }}
      >
        <h3 css={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {right}
      </header>
      <div css={{ padding: theme.spacing.md }}>{children}</div>
    </section>
  );
};

const BarsSkeleton: React.FC<{ count?: number; height?: number }> = ({ count = 24, height = 80 }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', gap: 8, alignItems: 'flex-end', height }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          css={{
            width: 14,
            height: Math.max(12, ((i % 10) + 3) * 6),
            background: theme.colors.backgroundSecondary,
            borderRadius: 3,
          }}
        />
      ))}
    </div>
  );
};

const ExperimentInsightDetailsPage: React.FC<{
  experimentId?: string;
  insightId?: string;
}> = ({ experimentId: experimentIdProp, insightId: insightIdProp }) => {
  const params = useParams<{ experimentId?: string; insightId?: string }>();
  const experimentId = experimentIdProp ?? params.experimentId ?? '';
  const insightId = insightIdProp ?? params.insightId ?? '';
  invariant(experimentId, 'experimentId must be provided');
  invariant(insightId, 'insightId must be provided');

  const { theme } = useDesignSystemTheme();
  const [qaValue, setQaValue] = useState('');

  // Placeholder header metadata from route params
  const metaChips = useMemo(
    () => [
      <Chip key="id" label="ID" value={insightId} />,
      <Chip key="total" label="Total Traces" value="1000" />,
      <Chip key="start" label="start" value="Nov 25, 2025" />,
      <Chip key="end" label="end" value="Dec 7, 2025" />,
      <Chip key="version" label="version" value="1" />,
      <Chip key="prompt" label="prompt" value="…" />,
      <Chip key="more" label="+3" />,
    ],
    [insightId],
  );

  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const [bannerValue, setBannerValue] = useState('');
  const renderCreateInsightBanner = () => {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // TODO: Wire up to actual ask questions about insight flow once backend is ready.
        }}
        onClick={() => bannerInputRef.current?.focus()}
        css={{
          // Layout
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          width: '100%',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          textAlign: 'left',
          cursor: 'text',

          // Shape
          borderRadius: theme.borders.borderRadiusMd,
          border: '1px solid transparent',

          // Gradient border around a white fill using the padding-box/border-box trick
          background:
            'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, rgb(74, 174, 255) 20.5%, rgb(202, 66, 224) 46.91%, rgb(255, 95, 70) 79.5%) border-box',

          // Motion + hover
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
          boxShadow: '0 0 0 0 rgba(0,0,0,0)',
          '&:hover': {
            transform: 'translateY(-0.5px)',
            boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06)'
          },
          '&:active': {
            transform: 'translateY(0)'
          },
          '&:focus-within': {
            outline: `2px solid ${theme.colors.actionPrimaryTextDefault}`,
            outlineOffset: 2,
          },
        }}
      >
        <span
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden
        >
          <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
        </span>
        <input
          ref={bannerInputRef}
          type="text"
          value={bannerValue}
          onChange={(e) => setBannerValue(e.target.value)}
          placeholder={'Ask questions about the insight report. E.g., "what are the top three question topics with the lowest user groundedness?"'}
          aria-label="Create a new Insight"
          css={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: theme.colors.textPrimary,
            fontSize: 14,
            lineHeight: '20px',
            '::placeholder': {
              color: theme.colors.textSecondary,
            },
          }}
        />
      </form>
    );
  };

  return (
    <ScrollablePageWrapper>
      <div
        data-testid="insight-details-page"
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.md,
          padding: `${theme.spacing.md}px 0`,
        }}
      >
        {/* Page header with title + actions to match mocks */}
        <Header
          title={
            <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
              Question Topic Analysis
            </span>
          }
        />

        {/* Meta chips + description under title */}
        <div>
          <div css={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{metaChips}</div>
          <p css={{ color: theme.colors.textSecondary, marginTop: 16, marginBottom: 0 }}>
            This insight report was created from 1000 traces generated from November 25th, 2025 to
            December 7th. Traces are clustered based on the user's question topics.
          </p>
        </div>

        {/* Charts row */}
        <div css={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: theme.spacing.md, alignItems: 'start' }}>
        <div css={{ alignSelf: 'start' }}>
          <SectionCard title="Traces">
            <BarsSkeleton height={240} count={28} />
          </SectionCard>
        </div>

        <SectionCard title="Suggested Actions">
          <div css={{ display: 'grid', gap: 8 }}>
            <LegacySkeleton css={{ height: 36 }} />
          </div>
        </SectionCard>
        </div>

      {/* Q&A strip */}
      {renderCreateInsightBanner()}
      {/* Results table skeleton */}
        <SectionCard title="Results">
        {/* Column headers with disabled sorting affordances */}
        <div
          css={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr 200px 220px',
            gap: 12,
            marginBottom: theme.spacing.sm,
            color: theme.colors.textSecondary,
            fontWeight: 600,
          }}
        >
          <div>Category</div>
          <div>Description</div>
          <div>Trace Count</div>
          <div>Assessments: Correctness • Groundedness</div>
        </div>
        <div css={{ display: 'grid', gridTemplateColumns: '240px 1fr 200px 220px', gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <React.Fragment key={i}>
              <LegacySkeleton css={{ height: 18 }} />
              <LegacySkeleton css={{ height: 18 }} />
              <LegacySkeleton css={{ height: 18 }} />
              <div css={{ display: 'flex', gap: 8 }}>
                <LegacySkeleton css={{ height: 18, width: 64 }} />
                <LegacySkeleton css={{ height: 18, width: 64 }} />
              </div>
            </React.Fragment>
          ))}
        </div>
          <LegacyTooltip title={`Experiment ${experimentId}`}>
            <span css={{ color: theme.colors.textSecondary, fontSize: 12 }}>Experiment context</span>
          </LegacyTooltip>
        </SectionCard>
      </div>
    </ScrollablePageWrapper>
  );
};

export default ExperimentInsightDetailsPage;
