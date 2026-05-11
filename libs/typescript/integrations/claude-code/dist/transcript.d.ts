import type { TranscriptEntry } from './types.js';
/**
 * Read and parse a Claude Code transcript from a JSONL file.
 */
export declare function readTranscript(path: string): TranscriptEntry[];
/**
 * Convert various timestamp formats to nanoseconds since Unix epoch.
 * Handles ISO strings, Unix seconds, milliseconds, and nanoseconds.
 */
export declare function parseTimestampToNs(timestamp: string | number | undefined | null): number | null;
/**
 * Extract text content from Claude message content (string or content block array).
 */
export declare function extractTextContent(content: unknown): string;
/**
 * Find the index of the last actual user message, skipping tool results,
 * skill injections, and empty messages.
 */
export declare function findLastUserMessageIndex(transcript: TranscriptEntry[]): number | null;
/**
 * Find the final text response from the assistant after the given index.
 */
export declare function findFinalAssistantResponse(transcript: TranscriptEntry[], startIdx: number): string | null;
/**
 * Get the timestamp (in ns) of the next transcript entry that has one.
 */
export declare function getNextTimestampNs(transcript: TranscriptEntry[], currentIdx: number): number | null;
//# sourceMappingURL=transcript.d.ts.map