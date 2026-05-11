import { readStdin } from '../utils/stdin.js';
import { isTracingEnabled, ensureInitialized } from '../config.js';
import { processTranscript } from '../tracing.js';
async function main() {
    try {
        const input = await readStdin();
        if (!isTracingEnabled()) {
            return;
        }
        if (!(await ensureInitialized())) {
            return;
        }
        await processTranscript(input.transcript_path, input.session_id);
    }
    catch (err) {
        console.error('[mlflow]', err);
    }
}
void main();
