import { type ConfigPathOptions } from '../config.js';
export interface SetupOptions extends ConfigPathOptions {
    trackingUri?: string;
    experimentId?: string;
    experimentName?: string;
    nonInteractive?: boolean;
}
export interface ParsedSetupArgs extends SetupOptions {
    projectLocal: boolean | undefined;
}
export declare function parseSetupArgs(args: string[]): ParsedSetupArgs;
export declare function runSetup(args: string[], options?: SetupOptions): Promise<void>;
export declare function runStatus(options?: ConfigPathOptions): Promise<void>;
//# sourceMappingURL=setup.d.ts.map