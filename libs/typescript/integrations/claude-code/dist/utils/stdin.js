/**
 * Read all data from stdin and parse as JSON.
 */
export function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (chunk) => chunks.push(chunk));
        process.stdin.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(JSON.parse(raw));
            }
            catch (err) {
                reject(new Error(`Failed to parse stdin as JSON: ${String(err)}`));
            }
        });
        process.stdin.on('error', reject);
    });
}
