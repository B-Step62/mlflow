import { createLazyRouteElement } from '../common/utils/RoutingUtils';

import { ModelRegistryRoutePaths } from './routes';

export const getRouteDefs = () => [
  {
    path: ModelRegistryRoutePaths.modelListPage,
    element: createLazyRouteElement(() => import('./components/ModelListPageWrapper')),
    pageId: 'mlflow.model-registry.model-list',
  },
  {
    path: ModelRegistryRoutePaths.modelPage,
    element: createLazyRouteElement(() => import('./components/ModelPage')),
    pageId: 'mlflow.model-registry.model-page',
  },
  {
    path: ModelRegistryRoutePaths.modelSubpage,
    element: createLazyRouteElement(() => import('./components/ModelPage')),
    pageId: 'mlflow.model-registry.model-page.subpage',
  },
  {
    path: ModelRegistryRoutePaths.modelSubpageRouteWithName,
    element: createLazyRouteElement(() => import('./components/ModelPage')),
    pageId: 'mlflow.model-registry.model-page.subpage.section',
  },
  {
    path: ModelRegistryRoutePaths.modelVersionPage,
    element: createLazyRouteElement(() => import('./components/ModelVersionPage')),
    pageId: 'mlflow.model-registry.model-version-page',
  },
  {
    path: ModelRegistryRoutePaths.compareModelVersionsPage,
    element: createLazyRouteElement(() => import('./components/CompareModelVersionsPage')),
    pageId: 'mlflow.model-registry.compare-model-versions',
  },
  /* Prompt Management */
  {
    path: ModelRegistryRoutePaths.promptListPage,
    element: createLazyRouteElement(() => import('./components/prompts/PromptListPage')),
    pageId: 'mlflow.model-registry.prompt-list',
  },
  {
    path: ModelRegistryRoutePaths.promptSubpage,
    element: createLazyRouteElement(() => import('./components/prompts/PromptPage')),
    pageId: 'mlflow.model-registry.prompt-page',
  },
  // {
  //   path: ModelRegistryRoutePaths.promptVersionPage,
  //   element: createLazyRouteElement(() => import('./components/prompts/PromptVersionPage')),
  //   pageId: 'mlflow.model-registry.prompt-version-page',
  // }
];
