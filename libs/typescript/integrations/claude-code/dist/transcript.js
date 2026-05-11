import { readFileSync } from 'node:fs';
// ============================================================================
// Constants
// ============================================================================
const NANOSECONDS_PER_MS = 1e6;
const NANOSECONDS_PER_S = 1e9;
// ============================================================================
// JSONL parsing
// ============================================================================
/**
 * Read and parse a Claude Code transcript from a JSONL file.
 */
export function readTranscript(path) {
    const content = readFileSync(path, 'utf-8');
    return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
}
// ============================================================================
// Timestamp utilities
// ============================================================================
/**
 * Convert various timestamp formats to nanoseconds since Unix epoch.
 * Handles ISO strings, Unix seconds, milliseconds, and nanoseconds.
 */
export function parseTimestampToNs(timestamp) {
    if (!timestamp) {
        return null;
    }
    if (typeof timestamp === 'string') {
        try {
            const dt = new Date(timestamp);
            if (isNaN(dt.getTime())) {
                return null;
            }
            return Math.floor(dt.getTime() * NANOSECONDS_PER_MS);
        }
        catch {
            return null;
        }
    }
    if (typeof timestamp === 'number') {
        // Unix seconds (< 1e10, e.g. 1705312245)
        if (timestamp < 1e10) {
            return Math.floor(timestamp * NANOSECONDS_PER_S);
        }
        // Milliseconds (< 1e13, e.g. 1705312245123)
        if (timestamp < 1e13) {
            return Math.floor(timestamp * NANOSECONDS_PER_MS);
        }
        // Already nanoseconds
        return Math.floor(timestamp);
    }
    return null;
}
// ============================================================================
// Content extraction
// ============================================================================
/**
 * Extract text content from Claude message content (string or content block array).
 */
export function extractTextContent(content) {
    if (Array.isArray(content)) {
        const textParts = content
            .filter((part) => typeof part === 'object' &&
            part != null &&
            'type' in part &&
            part.type === 'text')
            .map((part) => part.text);
        return textParts.join('\n');
    }
    if (typeof content === 'string') {
        return content;
    }
    return String(content);
}
// ============================================================================
// Transcript navigation
// ============================================================================
/**
 * Find the index of the last actual user message, skipping tool results,
 * skill injections, and empty messages.
 */
export function findLastUserMessageIndex(transcript) {
    for (let i = transcript.length - 1; i >= 0; i--) {
        const entry = transcript[i];
        if (entry.type !== 'user' || entry.toolUseResult || entry.isCompactSummary) {
            continue;
        }
        // Skip skill content injections: a user message immediately following
        // a Skill tool result (which has toolUseResult with commandName)
        if (i > 0) {
            const prevToolResult = transcript[i - 1].toolUseResult;
            if (prevToolResult &&
                typeof prevToolResult === 'object' &&
                'commandName' in prevToolResult &&
                prevToolResult.commandName) {
                continue;
            }
        }
        const msg = entry.message;
        if (!msg) {
            continue;
        }
        const content = msg.content;
        // Skip tool result messages
        if (Array.isArray(content) && content.length > 0) {
            const first = content[0];
            if (typeof first === 'object' && first != null && 'type' in first) {
                if (first.type === 'tool_result') {
                    continue;
                }
            }
        }
        // Skip local command stdout
        if (typeof content === 'string' && content.includes('<local-command-stdout>')) {
            continue;
        }
        // Skip empty content
        if (!content || (typeof content === 'string' && content.trim() === '')) {
            continue;
        }
        return i;
    }
    return null;
}
/**
 * Find the final text response from the assistant after the given index.
 */
export function findFinalAssistantResponse(transcript, startIdx) {
    let finalResponse = null;
    for (let i = startIdx; i < transcript.length; i++) {
        const entry = transcript[i];
        if (entry.type !== 'assistant') {
            continue;
        }
        const content = entry.message?.content;
        if (!Array.isArray(content)) {
            continue;
        }
        for (const part of content) {
            if (typeof part === 'object' &&
                part != null &&
                'type' in part &&
                part.type === 'text' &&
                'text' in part) {
                const text = part.text;
                if (text.trim()) {
                    finalResponse = text;
                }
            }
        }
    }
    return finalResponse;
}
/**
 * Get the timestamp (in ns) of the next transcript entry that has one.
 */
export function getNextTimestampNs(transcript, currentIdx) {
    for (let i = currentIdx + 1; i < transcript.length; i++) {
        const ts = transcript[i].timestamp;
        if (ts) {
            return parseTimestampToNs(ts);
        }
    }
    return null;
}
