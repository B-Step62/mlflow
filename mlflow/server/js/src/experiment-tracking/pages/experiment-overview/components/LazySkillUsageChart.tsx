import React from 'react';
import { OverviewChartLoadingState } from './OverviewChartComponents';

const SkillUsageChart = React.lazy(() =>
  import('./SkillUsageChart').then((module) => ({ default: module.SkillUsageChart })),
);

export const LazySkillUsageChart: React.FC = () => (
  <React.Suspense fallback={<OverviewChartLoadingState />}>
    <SkillUsageChart />
  </React.Suspense>
);
