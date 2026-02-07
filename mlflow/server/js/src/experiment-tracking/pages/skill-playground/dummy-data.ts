import type { PanelConfig, ChatMessage, SkillEntry } from './types';

export const DUMMY_SKILLS_A: SkillEntry[] = [
  { name: 'analyze-ci', repo: 'https://github.com/mlflow/mlflow-skills', commitId: 'abc1234' },
  { name: 'fetch-diff', repo: 'https://github.com/mlflow/mlflow-skills', commitId: 'abc1234' },
];

export const DUMMY_SKILLS_B: SkillEntry[] = [
  { name: 'analyze-ci', repo: 'https://github.com/mlflow/mlflow-skills', commitId: 'working-tree' },
  { name: 'fetch-diff', repo: '/Users/yuki/projects/mlflow-skills', commitId: 'working-tree' },
  { name: 'fetch-unresolved-comments', repo: 'https://github.com/mlflow/mlflow-skills', commitId: 'def5678' },
];

export const DUMMY_CONFIG_A: PanelConfig = {
  panelId: 'a',
  name: 'Panel A',
  skills: DUMMY_SKILLS_A,
  allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
  model: 'sonnet',
};

export const DUMMY_CONFIG_B: PanelConfig = {
  panelId: 'b',
  name: 'Panel B',
  skills: DUMMY_SKILLS_B,
  allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Skill'],
  model: 'opus',
};

export const AVAILABLE_SKILL_REPOS = [
  'https://github.com/mlflow/mlflow-skills',
  '/Users/yuki/projects/mlflow-skills',
];

export const SKILL_NAME_LOOKUP: Record<string, string> = {
  'https://github.com/mlflow/mlflow-skills': 'mlflow-skills',
  '/Users/yuki/projects/mlflow-skills': 'local-skills',
};

export const AVAILABLE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'WebFetch'];

export const DUMMY_COMMITS = [
  { hash: 'working-tree', label: 'Working tree (uncommitted)' },
  { hash: 'abc1234', label: 'abc1234 - Fix analyze-ci timeout handling' },
  { hash: 'def5678', label: 'def5678 - Add retry logic to fetch-diff' },
  { hash: '9012ghi', label: '9012ghi - Initial skill implementations' },
];

export const DUMMY_MESSAGES_A: ChatMessage[] = [
  {
    id: 'a-1',
    role: 'user',
    content: 'Analyze the CI failure for PR #1234',
  },
  {
    id: 'a-2',
    role: 'assistant',
    content: `I'll analyze the CI failure for PR #1234.

The CI failure is in the \`test-python\` job. Looking at the logs:

**Root cause:** The test \`test_model_registry_crud\` is failing due to a timeout when connecting to the tracking server.

\`\`\`
FAILED tests/test_model_registry.py::test_model_registry_crud - TimeoutError: Connection timed out after 30s
\`\`\`

**Analysis:**
1. The test tries to connect to a local tracking server on port 5000
2. The server startup is racing with the test execution
3. The CI runner has slower I/O which makes this race condition more likely

**Suggested fix:** Add a health check retry loop before running the test, or increase the connection timeout.`,
    toolCalls: [
      { name: 'Skill(analyze-ci)', description: 'Analyzing CI logs for PR #1234', status: 'success', durationMs: 3200 },
      { name: 'Read(logs.txt)', description: 'Reading test output logs', status: 'success', durationMs: 150 },
      { name: 'Bash(grep ...)', description: 'Searching for error patterns', status: 'success', durationMs: 80 },
    ],
    traceId: 'tr-abc-123',
    judgeScores: { Relevance: 0.92, Completeness: 0.85 },
  },
];

export const DUMMY_MESSAGES_B: ChatMessage[] = [
  {
    id: 'b-1',
    role: 'user',
    content: 'Analyze the CI failure for PR #1234',
  },
  {
    id: 'b-2',
    role: 'assistant',
    content: `Let me look into the CI failure for PR #1234.

After analyzing the failed GitHub Actions workflow, I found the issue:

**Failed job:** \`test-python\` (ubuntu-latest)
**Failed step:** \`Run pytest\`

The failure is a **flaky test** caused by a race condition in \`test_model_registry_crud\`. The test assumes the tracking server is ready immediately after startup, but the CI environment is slower.

Here's the relevant error:
\`\`\`
TimeoutError: Connection timed out after 30s
\`\`\`

I recommend adding a \`wait_for_server()\` utility that retries the connection with exponential backoff before running tests. This pattern is already used in \`tests/helper_functions.py\`.`,
    toolCalls: [
      { name: 'Bash(gh pr view ...)', description: 'Fetching PR details', status: 'success', durationMs: 1200 },
      { name: 'Read(workflow.yml)', description: 'Reading workflow configuration', status: 'success', durationMs: 120 },
      { name: 'Skill(analyze-ci)', description: 'Analyzing CI logs', status: 'success', durationMs: 4500 },
      { name: 'Grep(wait_for_server)', description: 'Searching for existing patterns', status: 'success', durationMs: 200 },
    ],
    traceId: 'tr-def-456',
    judgeScores: { Relevance: 0.88, Completeness: 0.91 },
  },
];
