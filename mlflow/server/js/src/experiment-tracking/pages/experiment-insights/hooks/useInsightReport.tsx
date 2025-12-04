import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getArtifactChunkedText, getArtifactLocationUrl } from '../../../../common/utils/ArtifactUtils';
import { INSIGHT_REPORT_ARTIFACT_PATH } from '../utils';

export type InsightReportEvidence = {
  type?: string;
  assessment_id?: string;
  trace_id?: string;
  fields?: string[];
};

export type InsightReportCategory = {
  id: string;
  category_id?: string;
  name: string;
  description?: string;
  severity?: string;
  traceIds: string[];
  evidences: InsightReportEvidence[];
  impactedCount: number;
};

export type InsightReport = {
  title?: string;
  traces_total?: number;
  report_type?: string;
  categories: InsightReportCategory[];
};

const asStringArray = (value: any): string[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter(Boolean);
  }
  return [String(value)].filter(Boolean);
};

const normalizeCategory = (raw: any, index: number): InsightReportCategory => {
  const traceIds = asStringArray(raw?.trace_ids ?? raw?.traceIds);
  const evidencesRaw: any[] = raw?.evidences ?? raw?.feedback_ids ?? [];
  const evidences: InsightReportEvidence[] = Array.isArray(evidencesRaw)
    ? evidencesRaw
        .filter((item) => item?.type === 'assessment')
        .map((item) => {
          const base: InsightReportEvidence = {
            type: item?.type,
            assessment_id: item?.assessment_id ?? item?.id ?? item?.entity_id,
            trace_id: item?.trace_id ?? item?.traceId,
            fields: Array.isArray(item?.fields) ? item.fields : undefined,
          };
          if (!base.trace_id && traceIds.length > 0) {
            base.trace_id = traceIds[0];
          }
          return base;
        })
    : [];
  const impactedCount = traceIds.length || evidences.length;

  return {
    id: raw?.issue_id !== undefined ? String(raw.issue_id) : raw?.id ? String(raw.id) : `cat-${index + 1}`,
    category_id:
      raw?.category_id !== undefined
        ? String(raw.category_id)
        : raw?.issue_id !== undefined
          ? String(raw.issue_id)
          : undefined,
    name: raw?.name ?? `Issue ${index + 1}`,
    description: raw?.description,
    severity: raw?.severity,
    traceIds,
    evidences,
    impactedCount,
  };
};

const normalizeReport = (raw: any): InsightReport => {
  const categoriesRaw: any[] = Array.isArray(raw?.categories)
    ? raw.categories
    : Array.isArray(raw?.issues)
      ? raw.issues
      : [];
  const categories = categoriesRaw.map((cat, idx) => normalizeCategory(cat, idx));

  const traceIdSet = new Set<string>();
  categories.forEach((cat) => cat.traceIds.forEach((t) => traceIdSet.add(t)));

  return {
    title: raw?.title,
    traces_total: raw?.traces_total ?? raw?.total_traces ?? (traceIdSet.size > 0 ? traceIdSet.size : undefined),
    report_type: raw?.report_type,
    categories,
  };
};

export const useInsightReport = (runUuid?: string) => {
  const enabled = Boolean(runUuid);
  const query = useQuery({
    queryKey: ['insight-report', runUuid],
    enabled,
    queryFn: async () => {
      const location = getArtifactLocationUrl(INSIGHT_REPORT_ARTIFACT_PATH, runUuid!);
      const text = await getArtifactChunkedText(location);
      return text;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const parsed = useMemo<InsightReport | undefined>(() => {
    if (!query.data) {
      return undefined;
    }
    try {
      const json = JSON.parse(query.data);
      return normalizeReport(json);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to parse insight report artifact', e);
      return undefined;
    }
  }, [query.data]);

  return {
    raw: query.data,
    report: parsed,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
};
