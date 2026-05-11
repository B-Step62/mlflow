import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createAuthProvider, init, MlflowClient } from '@mlflow/core';
export const MLFLOW_CLAUDE_TRACING_ENABLED = 'MLFLOW_CLAUDE_TRACING_ENABLED';
export const MLFLOW_TRACKING_URI = 'MLFLOW_TRACKING_URI';
export const MLFLOW_EXPERIMENT_ID = 'MLFLOW_EXPERIMENT_ID';
export const MLFLOW_EXPERIMENT_NAME = 'MLFLOW_EXPERIMENT_NAME';
let initializedKey = null;
function isTruthy(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
function hasConfigValue(value) {
    return Boolean(value && value.trim().length > 0);
}
function hasAnyTracingKey(env) {
    return [
        MLFLOW_CLAUDE_TRACING_ENABLED,
        MLFLOW_TRACKING_URI,
        MLFLOW_EXPERIMENT_ID,
        MLFLOW_EXPERIMENT_NAME,
    ].some((key) => env[key] !== undefined);
}
function hasTracingConfig(config) {
    return Boolean(config.trackingUri ||
        config.experimentId ||
        config.experimentName ||
        config.enabled);
}
function parseTracingConfig(env, source, settingsPath) {
    return {
        enabled: isTruthy(env[MLFLOW_CLAUDE_TRACING_ENABLED]),
        trackingUri: env[MLFLOW_TRACKING_URI],
        experimentId: env[MLFLOW_EXPERIMENT_ID],
        experimentName: env[MLFLOW_EXPERIMENT_NAME],
        source,
        settingsPath,
    };
}
export function resolveSettingsPath(projectLocal, options = {}) {
    return projectLocal
        ? resolve(options.cwd ?? process.cwd(), '.claude', 'settings.json')
        : resolve(options.home ?? homedir(), '.claude', 'settings.json');
}
export function loadSettings(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return {};
    }
}
export function saveSettings(path, settings) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
export function getScopeTracingConfig(projectLocal, options = {}) {
    const settingsPath = resolveSettingsPath(projectLocal, options);
    const settings = loadSettings(settingsPath);
    return parseTracingConfig(Object.fromEntries(Object.entries(settings.env ?? {}).map(([key, value]) => [key, String(value)])), projectLocal ? 'project' : 'user', settingsPath);
}
export function getEffectiveTracingConfig(options = {}) {
    const userConfig = getScopeTracingConfig(false, options);
    const projectConfig = getScopeTracingConfig(true, options);
    const merged = {
        enabled: userConfig.enabled,
        trackingUri: userConfig.trackingUri,
        experimentId: userConfig.experimentId,
        experimentName: userConfig.experimentName,
        ...(hasTracingConfig(projectConfig)
            ? {
                enabled: projectConfig.enabled,
                trackingUri: projectConfig.trackingUri,
                experimentId: projectConfig.experimentId,
                experimentName: projectConfig.experimentName,
            }
            : {}),
    };
    const envConfig = parseTracingConfig(process.env, 'environment');
    const effective = {
        enabled: process.env[MLFLOW_CLAUDE_TRACING_ENABLED] !== undefined
            ? envConfig.enabled
            : merged.enabled,
        trackingUri: process.env[MLFLOW_TRACKING_URI] ?? merged.trackingUri,
        experimentId: process.env[MLFLOW_EXPERIMENT_ID] ?? merged.experimentId,
        experimentName: process.env[MLFLOW_EXPERIMENT_NAME] ?? merged.experimentName,
        source: 'none',
    };
    if (hasAnyTracingKey(process.env)) {
        effective.source = 'environment';
    }
    else if (hasTracingConfig(projectConfig)) {
        effective.source = 'project';
        effective.settingsPath = projectConfig.settingsPath;
    }
    else if (hasTracingConfig(userConfig)) {
        effective.source = 'user';
        effective.settingsPath = userConfig.settingsPath;
    }
    return effective;
}
export function isTracingEnabled() {
    return getEffectiveTracingConfig().enabled;
}
export function isValidTrackingUri(raw) {
    if (raw === 'databricks' || raw.startsWith('databricks://')) {
        return true;
    }
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
export async function resolveExperiment(trackingUri, experimentId, experimentName) {
    if (hasConfigValue(experimentId)) {
        return { experimentId, experimentName, created: false };
    }
    if (!hasConfigValue(experimentName)) {
        throw new Error('Either MLFLOW_EXPERIMENT_ID or MLFLOW_EXPERIMENT_NAME must be configured for Claude tracing.');
    }
    const authProvider = createAuthProvider({ trackingUri });
    const client = new MlflowClient({ trackingUri, authProvider });
    const existing = await client.getExperimentByName(experimentName);
    if (existing) {
        return {
            experimentId: existing.experimentId,
            experimentName: existing.name,
            created: false,
        };
    }
    return {
        experimentId: await client.createExperiment(experimentName),
        experimentName,
        created: true,
    };
}
export function writeTracingSettings(settingsPath, config) {
    const settings = loadSettings(settingsPath);
    const env = { ...(settings.env ?? {}) };
    env[MLFLOW_CLAUDE_TRACING_ENABLED] = config.enabled === false ? 'false' : 'true';
    env[MLFLOW_TRACKING_URI] = config.trackingUri;
    env[MLFLOW_EXPERIMENT_ID] = config.experimentId;
    if (hasConfigValue(config.experimentName)) {
        env[MLFLOW_EXPERIMENT_NAME] = config.experimentName;
    }
    else {
        delete env[MLFLOW_EXPERIMENT_NAME];
    }
    settings.env = env;
    saveSettings(settingsPath, settings);
}
export async function ensureInitialized() {
    const config = getEffectiveTracingConfig();
    if (!config.enabled) {
        return false;
    }
    if (!hasConfigValue(config.trackingUri)) {
        console.error('[mlflow] MLFLOW_TRACKING_URI is not set');
        return false;
    }
    if (!hasConfigValue(config.experimentId) && !hasConfigValue(config.experimentName)) {
        console.error('[mlflow] MLFLOW_EXPERIMENT_ID or MLFLOW_EXPERIMENT_NAME is not set');
        return false;
    }
    try {
        const resolvedExperiment = await resolveExperiment(config.trackingUri, config.experimentId, config.experimentName);
        const initKey = JSON.stringify({
            trackingUri: config.trackingUri,
            experimentId: resolvedExperiment.experimentId,
        });
        if (initializedKey === initKey) {
            return true;
        }
        init({
            trackingUri: config.trackingUri,
            experimentId: resolvedExperiment.experimentId,
        });
        initializedKey = initKey;
        return true;
    }
    catch (err) {
        console.error('[mlflow] Failed to initialize:', err);
        return false;
    }
}
