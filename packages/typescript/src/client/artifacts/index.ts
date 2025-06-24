import { MLflowTracingConfig } from "../../core/config";
import { ArtifactsClient } from "./base";
import { DatabricksArtifactsClient } from "./databricks";
import { MlflowArtifactsClient } from "./mlflow";


/**
 * Get the appropriate artifacts client based on the tracking URI.
 *
 * @param trackingUri - The tracking URI to use to determine the artifacts client.
 * @returns The appropriate artifacts client.
 */
export function getArtifactsClient(config: MLflowTracingConfig): ArtifactsClient {
  if (config.tracking_uri.includes("databricks")) { // TODO: Replace with proper parsing
      return new DatabricksArtifactsClient({ host: config.host!, token: config.token });
  } else {
      return new MlflowArtifactsClient({ host: config.host! });
  }
}

export { ArtifactsClient };