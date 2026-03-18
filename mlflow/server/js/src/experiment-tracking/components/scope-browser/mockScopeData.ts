export interface MockScope {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  children: MockScope[];
  description?: string;
}

export interface MockResource {
  id: string;
  name: string;
  type: 'trace' | 'run' | 'dataset';
  scopeId: string;
  scopeName: string;
  status: string;
  timestamp: string;
  sharedFrom?: { scopeId: string; scopeName: string; scopePath: string };
  // Trace-specific
  traceType?: string;
  latency?: string;
  // Run-specific
  duration?: string;
  metrics?: Record<string, number>;
  // Dataset-specific
  digest?: string;
  profile?: string;
}

export const MOCK_SCOPES: MockScope[] = [
  {
    id: 'scp-1',
    name: 'team-ml',
    parentId: null,
    depth: 0,
    description: 'Machine learning team workspace',
    children: [
      {
        id: 'scp-2',
        name: 'vision',
        parentId: 'scp-1',
        depth: 1,
        description: 'Computer vision projects',
        children: [
          {
            id: 'scp-4',
            name: 'detection',
            parentId: 'scp-2',
            depth: 2,
            description: 'Object detection models',
            children: [],
          },
          {
            id: 'scp-5',
            name: 'segmentation',
            parentId: 'scp-2',
            depth: 2,
            description: 'Image segmentation models',
            children: [],
          },
        ],
      },
      {
        id: 'scp-3',
        name: 'nlp',
        parentId: 'scp-1',
        depth: 1,
        description: 'Natural language processing projects',
        children: [
          {
            id: 'scp-6',
            name: 'sentiment',
            parentId: 'scp-3',
            depth: 2,
            description: 'Sentiment analysis',
            children: [],
          },
        ],
      },
      {
        id: 'scp-7',
        name: 'data-pipeline',
        parentId: 'scp-1',
        depth: 1,
        description: 'Data ingestion and transformation',
        children: [],
      },
    ],
  },
  {
    id: 'scp-8',
    name: 'personal',
    parentId: null,
    depth: 0,
    description: 'Personal experiments',
    children: [
      {
        id: 'scp-9',
        name: 'yuki-experiments',
        parentId: 'scp-8',
        depth: 1,
        description: "Yuki's scratch experiments",
        children: [],
      },
    ],
  },
];

export const MOCK_RESOURCES: MockResource[] = [
  // team-ml > vision > detection
  {
    id: 'tr-1',
    name: 'yolo-v8-inference',
    type: 'trace',
    scopeId: 'scp-4',
    scopeName: 'detection',
    status: 'OK',
    timestamp: '2026-03-17T10:30:00Z',
    traceType: 'LLM',
    latency: '245ms',
  },
  {
    id: 'tr-2',
    name: 'detr-batch-predict',
    type: 'trace',
    scopeId: 'scp-4',
    scopeName: 'detection',
    status: 'ERROR',
    timestamp: '2026-03-17T09:15:00Z',
    traceType: 'CHAIN',
    latency: '1.2s',
  },
  {
    id: 'run-1',
    name: 'yolo-v8-train-ep50',
    type: 'run',
    scopeId: 'scp-4',
    scopeName: 'detection',
    status: 'FINISHED',
    timestamp: '2026-03-16T18:00:00Z',
    duration: '2h 15m',
    metrics: { mAP: 0.87, loss: 0.032 },
  },
  {
    id: 'ds-1',
    name: 'coco-2024-subset',
    type: 'dataset',
    scopeId: 'scp-4',
    scopeName: 'detection',
    status: 'Active',
    timestamp: '2026-03-15T12:00:00Z',
    digest: 'abc123',
    profile: '50k images',
  },
  // team-ml > vision > segmentation
  {
    id: 'tr-3',
    name: 'sam-segment-all',
    type: 'trace',
    scopeId: 'scp-5',
    scopeName: 'segmentation',
    status: 'OK',
    timestamp: '2026-03-17T08:00:00Z',
    traceType: 'AGENT',
    latency: '890ms',
  },
  {
    id: 'run-2',
    name: 'unet-finetune-v3',
    type: 'run',
    scopeId: 'scp-5',
    scopeName: 'segmentation',
    status: 'RUNNING',
    timestamp: '2026-03-17T06:00:00Z',
    duration: '45m (running)',
    metrics: { iou: 0.72, loss: 0.15 },
  },
  // team-ml > vision (parent scope resources)
  {
    id: 'ds-2',
    name: 'imagenet-val',
    type: 'dataset',
    scopeId: 'scp-2',
    scopeName: 'vision',
    status: 'Active',
    timestamp: '2026-03-10T12:00:00Z',
    digest: 'def456',
    profile: '100k images',
  },
  // team-ml > nlp > sentiment
  {
    id: 'tr-4',
    name: 'bert-classify-review',
    type: 'trace',
    scopeId: 'scp-6',
    scopeName: 'sentiment',
    status: 'OK',
    timestamp: '2026-03-17T11:00:00Z',
    traceType: 'LLM',
    latency: '120ms',
  },
  {
    id: 'run-3',
    name: 'bert-sentiment-v2',
    type: 'run',
    scopeId: 'scp-6',
    scopeName: 'sentiment',
    status: 'FINISHED',
    timestamp: '2026-03-16T22:00:00Z',
    duration: '1h 30m',
    metrics: { accuracy: 0.94, f1: 0.91 },
  },
  // Shared resource example: a detection dataset shared into sentiment
  {
    id: 'ds-shared-1',
    name: 'coco-2024-subset',
    type: 'dataset',
    scopeId: 'scp-6',
    scopeName: 'sentiment',
    status: 'Active',
    timestamp: '2026-03-15T12:00:00Z',
    digest: 'abc123',
    profile: '50k images',
    sharedFrom: {
      scopeId: 'scp-4',
      scopeName: 'detection',
      scopePath: 'team-ml / vision / detection',
    },
  },
  // team-ml > data-pipeline
  {
    id: 'run-4',
    name: 'etl-daily-batch',
    type: 'run',
    scopeId: 'scp-7',
    scopeName: 'data-pipeline',
    status: 'FINISHED',
    timestamp: '2026-03-17T05:00:00Z',
    duration: '12m',
    metrics: { rows_processed: 1500000 },
  },
  // personal > yuki-experiments
  {
    id: 'tr-5',
    name: 'gpt4-summarizer-test',
    type: 'trace',
    scopeId: 'scp-9',
    scopeName: 'yuki-experiments',
    status: 'OK',
    timestamp: '2026-03-17T14:00:00Z',
    traceType: 'LLM',
    latency: '340ms',
  },
  {
    id: 'run-5',
    name: 'quick-prototype-v1',
    type: 'run',
    scopeId: 'scp-9',
    scopeName: 'yuki-experiments',
    status: 'FAILED',
    timestamp: '2026-03-17T13:00:00Z',
    duration: '5m',
    metrics: { loss: 2.45 },
  },
];

export const MOCK_FAVORITES = ['scp-4', 'scp-6', 'scp-9'];
export const MOCK_RECENTS = ['scp-4', 'scp-5', 'scp-9', 'scp-7', 'scp-3'];

// Utility: find a scope by ID in the tree
export function findScopeById(id: string, scopes: MockScope[] = MOCK_SCOPES): MockScope | null {
  for (const scope of scopes) {
    if (scope.id === id) return scope;
    const found = findScopeById(id, scope.children);
    if (found) return found;
  }
  return null;
}

// Utility: find a scope by name path (e.g. ['team-ml', 'vision', 'detection'])
export function findScopeByPath(path: string[], scopes: MockScope[] = MOCK_SCOPES): MockScope | null {
  if (path.length === 0) return null;
  const [head, ...rest] = path;
  const found = scopes.find((s) => s.name === head);
  if (!found) return null;
  if (rest.length === 0) return found;
  return findScopeByPath(rest, found.children);
}

// Utility: get full path of a scope
export function getScopePath(scopeId: string): string[] {
  const path: string[] = [];
  const walk = (id: string) => {
    const scope = findScopeById(id);
    if (!scope) return;
    path.unshift(scope.name);
    if (scope.parentId) walk(scope.parentId);
  };
  walk(scopeId);
  return path;
}

// Utility: get all descendant scope IDs
export function getDescendantScopeIds(scope: MockScope): string[] {
  const ids: string[] = [];
  for (const child of scope.children) {
    ids.push(child.id);
    ids.push(...getDescendantScopeIds(child));
  }
  return ids;
}

// Utility: get resources for a scope, optionally including children
export function getResourcesForScope(scopeId: string, includeChildren: boolean): MockResource[] {
  const scope = findScopeById(scopeId);
  if (!scope) return [];
  const scopeIds = [scopeId, ...(includeChildren ? getDescendantScopeIds(scope) : [])];
  return MOCK_RESOURCES.filter((r) => scopeIds.includes(r.scopeId));
}

// Utility: count resources in a scope (direct only)
export function countResourcesInScope(scopeId: string): number {
  return MOCK_RESOURCES.filter((r) => r.scopeId === scopeId).length;
}
