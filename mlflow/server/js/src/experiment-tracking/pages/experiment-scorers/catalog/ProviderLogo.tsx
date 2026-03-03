import { UserIcon } from '@databricks/design-system';
import type { CatalogProvider } from './types';
import { getProviderDisplayName } from './judgeCatalogUtils';
import mlflowLogo from '../../../../common/static/logos/mlflow-icon.svg';
import ragasLogo from '../../../../common/static/logos/ragas.svg';
import deepevalLogo from '../../../../common/static/logos/deepeval.svg';
import trulensLogo from '../../../../common/static/logos/trulens.svg';
import phoenixLogo from '../../../../common/static/logos/phoenix.png';
import guardrailsLogo from '../../../../common/static/logos/guardrails.svg';

const PROVIDER_LOGOS: Partial<Record<CatalogProvider, string>> = {
  mlflow: mlflowLogo,
  ragas: ragasLogo,
  deepeval: deepevalLogo,
  trulens: trulensLogo,
  phoenix: phoenixLogo,
  guardrails: guardrailsLogo,
};

interface ProviderLogoProps {
  provider: CatalogProvider;
  size?: number;
}

const ProviderLogo: React.FC<ProviderLogoProps> = ({ provider, size = 16 }) => {
  if (provider === 'custom') {
    return (
      <div
        css={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6B7280',
          flexShrink: 0,
        }}
        title={getProviderDisplayName(provider)}
      >
        <UserIcon css={{ '& > svg': { width: size * 0.8, height: size * 0.8 } }} />
      </div>
    );
  }

  const logo = PROVIDER_LOGOS[provider];
  if (logo) {
    return (
      <img
        src={logo}
        alt={getProviderDisplayName(provider)}
        title={getProviderDisplayName(provider)}
        width={size}
        height={size}
        css={{ flexShrink: 0, objectFit: 'contain' }}
      />
    );
  }

  return null;
};

export default ProviderLogo;
