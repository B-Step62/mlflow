import type { RouteHandle } from '../common/utils/RoutingUtils';
import { createLazyRouteElement } from '../common/utils/RoutingUtils';
import { PageId, RoutePaths } from '../experiment-tracking/routes';

export const getPlaygroundRouteDefs = () => [
  {
    path: RoutePaths.playgroundPage,
    element: createLazyRouteElement(() => import('./PlaygroundPage')),
    pageId: PageId.playgroundPage,
    handle: {
      getPageTitle: () => 'Agent Playground',
      getAssistantPrompts: () => [
        'Open the latest trace from this conversation.',
        'How do I leave feedback on an assistant response?',
        'Which tool calls happened in this thread?',
      ],
    } satisfies RouteHandle,
  },
];
