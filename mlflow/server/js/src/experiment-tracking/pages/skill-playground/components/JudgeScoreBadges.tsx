import { Tag, useDesignSystemTheme } from '@databricks/design-system';

interface JudgeScoreBadgesProps {
  scores: Record<string, number>;
}

export const JudgeScoreBadges = ({ scores }: JudgeScoreBadgesProps) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
      {Object.entries(scores).map(([name, score]) => (
        <Tag
          key={name}
          componentId={`mlflow.skill-playground.judge-score.${name}`}
          color={score >= 0.9 ? 'teal' : score >= 0.7 ? 'lemon' : 'coral'}
        >
          {name}: {score.toFixed(2)}
        </Tag>
      ))}
    </div>
  );
};
