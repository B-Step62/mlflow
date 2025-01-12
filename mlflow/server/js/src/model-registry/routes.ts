import { createMLflowRoutePath, generatePath } from '../common/utils/RoutingUtils';

// Route path definitions (used in defining route elements)
export class ModelRegistryRoutePaths {
  static get modelListPage() {
    return createMLflowRoutePath('/models');
  }
  static get modelPage() {
    return createMLflowRoutePath('/models/:modelName');
  }
  static get modelSubpage() {
    return createMLflowRoutePath('/models/:modelName/:subpage');
  }
  static get modelSubpageRouteWithName() {
    return createMLflowRoutePath('/models/:modelName/:subpage/:name');
  }
  static get modelVersionPage() {
    return createMLflowRoutePath('/models/:modelName/versions/:version');
  }
  static get compareModelVersionsPage() {
    return createMLflowRoutePath('/compare-model-versions');
  }
  static get createModel() {
    return createMLflowRoutePath('/createModel');
  }

  /* Prompt Management */
  static get promptListPage() {
    return createMLflowRoutePath('/prompts');
  }

  static get promptSubpage() {
    return createMLflowRoutePath('/prompts/:promptName/:subpage');
  }

  static get promptVersionPage() {
    return createMLflowRoutePath('/prompts/:promptName/versions/:version');
  }
}

// Concrete routes and functions for generating parametrized paths
export class ModelRegistryRoutes {
  static get modelListPageRoute() {
    return ModelRegistryRoutePaths.modelListPage;
  }
  static getModelPageRoute(modelName: string) {
    return generatePath(ModelRegistryRoutePaths.modelPage, {
      modelName: encodeURIComponent(modelName),
    });
  }
  static getModelPageServingRoute(modelName: string) {
    return generatePath(ModelRegistryRoutePaths.modelSubpage, {
      modelName: encodeURIComponent(modelName),
      subpage: PANES.SERVING,
    });
  }
  static getModelVersionPageRoute(modelName: string, version: string) {
    return generatePath(ModelRegistryRoutePaths.modelVersionPage, {
      modelName: encodeURIComponent(modelName),
      version,
    });
  }
  static getCompareModelVersionsPageRoute(modelName: string, runsToVersions: Record<string, string>) {
    const path = generatePath(ModelRegistryRoutePaths.compareModelVersionsPage);
    const query =
      `?name=${JSON.stringify(encodeURIComponent(modelName))}` +
      `&runs=${JSON.stringify(runsToVersions, (_, v) => (v === undefined ? null : v))}`;

    return [path, query].join('');
  }

  /* Prompt Management */
  static get promptListPageRoute() {
    return ModelRegistryRoutePaths.promptListPage;
  }

  static getPromptPageRoute(promptName: string) {
    return generatePath(ModelRegistryRoutePaths.promptSubpage, {
      promptName: encodeURIComponent(promptName),
      subpage: PANES.DETAILS,
    });
  }

  static getPromptVersionPageRoute(promptName: string, version: string) {
    return generatePath(ModelRegistryRoutePaths.promptVersionPage, {
      promptName: encodeURIComponent(promptName),
      version,
    });
  }
}

export const PANES = Object.freeze({
  DETAILS: 'details',
  SERVING: 'serving',
});
