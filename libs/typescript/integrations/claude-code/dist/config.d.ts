export declare const MLFLOW_CLAUDE_TRACING_ENABLED = "MLFLOW_CLAUDE_TRACING_ENABLED";
export declare const MLFLOW_TRACKING_URI = "MLFLOW_TRACKING_URI";
export declare const MLFLOW_EXPERIMENT_ID = "MLFLOW_EXPERIMENT_ID";
export declare const MLFLOW_EXPERIMENT_NAME = "MLFLOW_EXPERIMENT_NAME";
type ConfigSource = 'environment' | 'project' | 'user' | 'none';
export interface ClaudeSettings {
    env?: Record<string, string>;
    [key: string]: unknown;
}
export interface TracingConfig {
    enabled: boolean;
    trackingUri?: string;
    experimentId?: string;
    experimentName?: string;
    source: ConfigSource;
    settingsPath?: string;
}
export interface ConfigPathOptions {
    home?: string;
    cwd?: string;
}
export declare function resolveSettingsPath(projectLocal: boolean, options?: ConfigPathOptions): string;
export declare function loadSettings(path: string): ClaudeSettings;
export declare function saveSettings(path: string, settings: ClaudeSettings): void;
export declare function getScopeTracingConfig(projectLocal: boolean, options?: ConfigPathOptions): TracingConfig;
export declare function getEffectiveTracingConfig(options?: ConfigPathOptions): TracingConfig;
export declare function isTracingEnabled(): boolean;
export declare function isValidTrackingUri(raw: string): boolean;
export declare function resolveExperiment(trackingUri: string, experimentId?: string, experimentName?: string): Promise<{
    experimentId: string;
    experimentName?: string;
    created: boolean;
}>;
export declare function writeTracingSettings(settingsPath: string, config: {
    trackingUri: string;
    experimentId: string;
    experimentName?: string;
    enabled?: boolean;
}): void;
export declare function ensureInitialized(): Promise<boolean>;
export {};
//# sourceMappingURL=config.d.ts.map