import { ArtifactsClient } from './base';
import { DatabricksArtifactsClient } from './databricks';
import { MlflowArtifactsClient } from './mlflow';

/**
 * Get the appropriate artifacts client based on the tracking URI.
 *
 * @param trackingUri - The tracking URI to use to determine the artifacts client.
 * @returns The appropriate artifacts client.
 */
export function getArtifactsClient({
  host,
  token
}: {
  host: string;
  token?: string;
}): ArtifactsClient {
  if (host.startsWith('databricks')) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return new DatabricksArtifactsClient({ host, token });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return new MlflowArtifactsClient({ host });
  }
}

export { ArtifactsClient };
