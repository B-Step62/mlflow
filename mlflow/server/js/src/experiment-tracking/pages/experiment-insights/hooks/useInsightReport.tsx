import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getArtifactChunkedText, getArtifactLocationUrl } from '../../../../common/utils/ArtifactUtils';
import { INSIGHT_REPORT_ARTIFACT_PATH } from '../utils';

export type InsightReportEvidence = {
  assessment_id?: string;
  trace_id?: string;
};

export type InsightReportCategory = {
  id: string;
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
    ? evidencesRaw.map((item) => ({ assessment_id: item?.assessment_id, trace_id: item?.trace_id }))
    : [];
  const impactedCount = traceIds.length || evidences.length;

  return {
    id: raw?.id ? String(raw.id) : `cat-${index + 1}`,
    name: raw?.name ?? `Issue ${index + 1}`,
    description: raw?.description,
    severity: raw?.severity,
    traceIds,
    evidences,
    impactedCount,
  };
};

const normalizeReport = (raw: any): InsightReport => {
  const categoriesRaw: any[] = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    title: raw?.title,
    traces_total: raw?.traces_total ?? raw?.total_traces,
    report_type: raw?.report_type,
    categories: categoriesRaw.map((cat, idx) => normalizeCategory(cat, idx)),
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
