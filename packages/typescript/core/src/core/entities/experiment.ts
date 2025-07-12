/**
 * Metadata about an MLflow experiment.
 */
export class Experiment {
  /**
   * Unique identifier for the experiment
   */
  experimentId: string;

  /**
   * Human readable name that identifies the experiment
   */
  name: string;

  /**
   * Location where artifacts for the experiment are stored
   */
  artifactLocation: string;

  /**
   * Current lifecycle stage of the experiment: "active" or "deleted"
   */
  lifecycleStage: string;

  /**
   * Key-value tags associated with the experiment
   */
  tags: Record<string, string>;

  /**
   * Creation time of the experiment, in milliseconds since epoch (optional)
   */
  creationTime?: number;

  /**
   * Last update time of the experiment, in milliseconds since epoch (optional)
   */
  lastUpdateTime?: number;

  /**
   * Create a new Experiment instance
   * @param params Experiment parameters
   */
  constructor(params: {
    experimentId: string;
    name: string;
    artifactLocation: string;
    lifecycleStage: string;
    tags?: Record<string, string>;
    creationTime?: number;
    lastUpdateTime?: number;
  }) {
    this.experimentId = params.experimentId;
    this.name = params.name;
    this.artifactLocation = params.artifactLocation;
    this.lifecycleStage = params.lifecycleStage;
    this.tags = params.tags || {};
    this.creationTime = params.creationTime;
    this.lastUpdateTime = params.lastUpdateTime;
  }

  /**
   * Convert this Experiment instance to JSON format
   * @returns JSON object representation of the Experiment
   */
  toJson(): SerializedExperiment {
    return {
      experiment_id: this.experimentId,
      name: this.name,
      artifact_location: this.artifactLocation,
      lifecycle_stage: this.lifecycleStage,
      tags: Object.entries(this.tags).map(([key, value]) => ({ key, value })),
      creation_time: this.creationTime,
      last_update_time: this.lastUpdateTime
    };
  }

  /**
   * Create an Experiment instance from JSON data
   * @param json JSON object containing experiment data
   * @returns Experiment instance
   */
  static fromJson(json: SerializedExperiment): Experiment {
    const tags: Record<string, string> = {};
    if (json.tags) {
      for (const tag of json.tags) {
        tags[tag.key] = tag.value;
      }
    }

    return new Experiment({
      experimentId: json.experiment_id,
      name: json.name,
      artifactLocation: json.artifact_location,
      lifecycleStage: json.lifecycle_stage,
      tags,
      creationTime: json.creation_time,
      lastUpdateTime: json.last_update_time
    });
  }
}

export interface SerializedExperiment {
  experiment_id: string;
  name: string;
  artifact_location: string;
  lifecycle_stage: string;
  tags?: Array<{ key: string; value: string }>;
  creation_time?: number;
  last_update_time?: number;
}
