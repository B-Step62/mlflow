import { useDesignSystemTheme } from '@databricks/design-system';
import type { CatalogProvider } from './types';
import { getProviderDisplayName } from './judgeCatalogUtils';

// TODO: Replace with actual SVG logo imports once assets are provided.
// Example:
//   import mlflowLogo from '../../../../common/static/logos/mlflow.svg';
//   const PROVIDER_LOGOS: Record<CatalogProvider, string> = { mlflow: mlflowLogo, ... };
//
// Then use: <img src={PROVIDER_LOGOS[provider]} alt={...} width={16} height={16} />

const PROVIDER_COLORS: Record<CatalogProvider, string> = {
  mlflow: '#7B61FF',
  ragas: '#2E7CF6',
  deepeval: '#14B8A6',
  trulens: '#EAB308',
  phoenix: '#84CC16',
  guardrails: '#EC4899',
};

const PROVIDER_LETTERS: Record<CatalogProvider, string> = {
  mlflow: 'M',
  ragas: 'R',
  deepeval: 'D',
  trulens: 'T',
  phoenix: 'P',
  guardrails: 'G',
};

interface ProviderLogoProps {
  provider: CatalogProvider;
  size?: number;
}

const ProviderLogo: React.FC<ProviderLogoProps> = ({ provider, size = 16 }) => {
  const { theme } = useDesignSystemTheme();
  const color = PROVIDER_COLORS[provider];

  return (
    <div
      css={{
        width: size,
        height: size,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: color + '20',
        color: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.65,
        fontWeight: theme.typography.typographyBoldFontWeight,
        flexShrink: 0,
        lineHeight: 1,
      }}
      title={getProviderDisplayName(provider)}
    >
      {PROVIDER_LETTERS[provider]}
    </div>
  );
};

export default ProviderLogo;
