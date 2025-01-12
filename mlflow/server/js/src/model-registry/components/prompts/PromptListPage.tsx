/**
 * NOTE: this code file was automatically migrated to TypeScript using ts-migrate and
 * may contain multiple `any` type annotations and `@ts-expect-error` directives.
 * If possible, please improve types while making changes to this file. If the type
 * annotations are already looking good, please remove this comment.
 */

import React from 'react';
import { PromptListView } from './PromptListView';
import { connect } from 'react-redux';
import { getUUID } from '../../../common/utils/ActionUtils';
import Utils from '../../../common/utils/Utils';
import { getCombinedSearchFilter, constructSearchInputFromURLState } from '../../utils/SearchUtils';
import {
  AntdTableSortOrder,
  REGISTERED_MODELS_PER_PAGE_COMPACT,
  REGISTERED_MODELS_SEARCH_NAME_FIELD,
} from '../../constants';
import { searchPromptsApi } from '../../actions';
import LocalStorageUtils from '../../../common/utils/LocalStorageUtils';
import { withRouterNext } from '../../../common/utils/withRouterNext';
import type { WithRouterNextProps } from '../../../common/utils/withRouterNext';
import { ScrollablePageWrapper } from '../../../common/components/ScrollablePageWrapper';
import { createMLflowRoutePath } from '../../../common/utils/RoutingUtils';
import ErrorUtils from '@mlflow/mlflow/src/common/utils/ErrorUtils';
import { withErrorBoundary } from '@mlflow/mlflow/src/common/utils/withErrorBoundary';

type PromptListPageImplProps = WithRouterNextProps & {
  prompts?: any[];
  searchPromptsApi: (...args: any[]) => any;
};

type PromptListPageImplState = {
  orderByKey: string;
  orderByAsc: boolean;
  currentPage: number;
  maxResultsSelection: number;
  pageTokens: Record<number, string | null>;
  loading: boolean;
  error: Error | undefined;
  searchInput: string;
};

export class PromptListPageImpl extends React.Component<PromptListPageImplProps, PromptListPageImplState> {
  constructor(props: PromptListPageImplProps) {
    super(props);
    this.state = {
      orderByKey: REGISTERED_MODELS_SEARCH_NAME_FIELD,
      orderByAsc: true,
      currentPage: 1,
      maxResultsSelection: this.getPersistedMaxResults(),
      pageTokens: {},
      loading: true,
      error: undefined,
      searchInput: constructSearchInputFromURLState(this.getUrlState()),
    };
  }
  promptListPageStoreKey = 'PromptListPageStore';
  defaultPersistedPageTokens = { 1: null };
  initialSearchPromptsApiId = getUUID();
  searchRegisteredPromptsApiId = getUUID();
  criticalInitialRequestIds = [this.initialSearchPromptsApiId];

  getUrlState() {
    return this.props.location ? Utils.getSearchParamsFromUrl(this.props.location.search) : {};
  }

  componentDidMount() {
    const urlState = this.getUrlState();
    const persistedPageTokens = this.getPersistedPageTokens();
    const maxResultsForTokens = this.getPersistedMaxResults();
    // eslint-disable-next-line react/no-did-mount-set-state
    this.setState(
      {
        // @ts-expect-error TS(4111): Property 'orderByKey' comes from an index signatur... Remove this comment to see the full error message
        orderByKey: urlState.orderByKey === undefined ? this.state.orderByKey : urlState.orderByKey,
        orderByAsc:
          // @ts-expect-error TS(4111): Property 'orderByAsc' comes from an index signatur... Remove this comment to see the full error message
          urlState.orderByAsc === undefined
            ? this.state.orderByAsc
            : // @ts-expect-error TS(4111): Property 'orderByAsc' comes from an index signatur... Remove this comment to see the full error message
              urlState.orderByAsc === 'true',
        currentPage:
          // @ts-expect-error TS(4111): Property 'page' comes from an index signature, so ... Remove this comment to see the full error message
          urlState.page !== undefined && (urlState as any).page in persistedPageTokens
            ? // @ts-expect-error TS(2345): Argument of type 'unknown' is not assignable to pa... Remove this comment to see the full error message
              parseInt(urlState.page, 10)
            : this.state.currentPage,
        maxResultsSelection: maxResultsForTokens,
        pageTokens: persistedPageTokens,
      },
      () => {
        this.loadModels(true);
      },
    );
  }

  getPersistedPageTokens() {
    const store = PromptListPageImpl.getLocalStore(this.promptListPageStoreKey);
    if (store && store.getItem('page_tokens')) {
      return JSON.parse(store.getItem('page_tokens'));
    } else {
      return this.defaultPersistedPageTokens;
    }
  }

  setPersistedPageTokens(page_tokens: any) {
    const store = PromptListPageImpl.getLocalStore(this.promptListPageStoreKey);
    if (store) {
      store.setItem('page_tokens', JSON.stringify(page_tokens));
    }
  }

  getPersistedMaxResults() {
    const store = PromptListPageImpl.getLocalStore(this.promptListPageStoreKey);
    if (store && store.getItem('max_results')) {
      return parseInt(store.getItem('max_results'), 10);
    } else {
      return REGISTERED_MODELS_PER_PAGE_COMPACT;
    }
  }

  setMaxResultsInStore(max_results: any) {
    const store = PromptListPageImpl.getLocalStore(this.promptListPageStoreKey);
    store.setItem('max_results', max_results.toString());
  }

  /**
   * Returns a LocalStorageStore instance that can be used to persist data associated with the
   * ModelRegistry component.
   */
  static getLocalStore(key: any) {
    return LocalStorageUtils.getSessionScopedStoreForComponent('PromptListPage', key);
  }

  // Loads the initial set of models.
  loadModels(isInitialLoading = false) {
    this.loadPage(this.state.currentPage, isInitialLoading);
  }

  resetHistoryState() {
    this.setState((prevState: any) => ({
      currentPage: 1,
      pageTokens: this.defaultPersistedPageTokens,
    }));
    this.setPersistedPageTokens(this.defaultPersistedPageTokens);
  }

  /**
   *
   * @param orderByKey column key to sort by
   * @param orderByAsc is sort by ascending order
   * @returns {string} ex. 'name ASC'
   */
  static getOrderByExpr = (orderByKey: any, orderByAsc: any) =>
    orderByKey ? `${orderByKey} ${orderByAsc ? 'ASC' : 'DESC'}` : '';

  pollIntervalId: any;

  isEmptyPageResponse = (value: any) => {
    return !value || !value.registered_models || !value.next_page_token;
  };

  getNextPageTokenFromResponse(response: any) {
    const { value } = response;
    if (this.isEmptyPageResponse(value)) {
      // Why we could be here:
      // 1. There are no models returned: we went to the previous page but all models after that
      //    page's token has been deleted.
      // 2. If `next_page_token` is not returned, assume there is no next page.
      return null;
    } else {
      return value.next_page_token;
    }
  }

  updatePageState = (page: any, response = {}) => {
    const nextPageToken = this.getNextPageTokenFromResponse(response);
    this.setState(
      (prevState: any) => ({
        currentPage: page,

        pageTokens: {
          ...prevState.pageTokens,
          [page + 1]: nextPageToken,
        },
      }),
      () => {
        this.setPersistedPageTokens(this.state.pageTokens);
      },
    );
  };

  handleSearch = (searchInput: any) => {
    this.resetHistoryState();
    this.setState({ searchInput: searchInput }, () => {
      this.loadPage(1, false);
    });
  };

  // Note: this method is no longer used by the UI but is used in tests. Probably best to refactor at some point.
  handleSearchInputChange = (searchInput: any) => {
    this.setState({ searchInput: searchInput });
  };

  updateUrlWithSearchFilter = (searchInput: any, orderByKey: any, orderByAsc: any, page: any) => {
    const urlParams = {};
    if (searchInput) {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      urlParams['searchInput'] = searchInput;
    }
    if (orderByKey && orderByKey !== REGISTERED_MODELS_SEARCH_NAME_FIELD) {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      urlParams['orderByKey'] = orderByKey;
    }
    if (orderByAsc === false) {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      urlParams['orderByAsc'] = orderByAsc;
    }
    if (page && page !== 1) {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      urlParams['page'] = page;
    }
    const newUrl = createMLflowRoutePath(`/prompts?${Utils.getSearchUrlFromState(urlParams)}`);
    if (newUrl !== this.props.location.pathname + this.props.location.search) {
      this.props.navigate(newUrl);
    }
  };

  handleMaxResultsChange = (key: any) => {
    this.setState({ maxResultsSelection: parseInt(key, 10) }, () => {
      this.resetHistoryState();
      const { maxResultsSelection } = this.state;
      this.setMaxResultsInStore(maxResultsSelection);
      this.loadPage(1, false);
    });
  };

  handleClickNext = () => {
    const { currentPage } = this.state;
    this.loadPage(currentPage + 1, false);
  };

  handleClickPrev = () => {
    const { currentPage } = this.state;
    this.loadPage(currentPage - 1, false);
  };

  handleClickSortableColumn = (orderByKey: any, sortOrder: any) => {
    const orderByAsc = sortOrder !== AntdTableSortOrder.DESC; // default to true
    this.setState({ orderByKey, orderByAsc }, () => {
      this.resetHistoryState();
      this.loadPage(1, false);
    });
  };

  getMaxResultsSelection = () => {
    return this.state.maxResultsSelection;
  };

  loadPage(page: any, isInitialLoading: any) {
    const {
      searchInput,
      pageTokens,
      orderByKey,
      orderByAsc,
      // eslint-disable-nextline
    } = this.state;
    this.setState({ loading: true, error: undefined });
    this.updateUrlWithSearchFilter(searchInput, orderByKey, orderByAsc, page);
    this.props
      .searchPromptsApi(
        getCombinedSearchFilter({
          query: searchInput,
          // eslint-disable-nextline
        }),
        this.state.maxResultsSelection,
        PromptListPageImpl.getOrderByExpr(orderByKey, orderByAsc),
        pageTokens[page],
        isInitialLoading ? this.initialSearchPromptsApiId : this.initialSearchPromptsApiId,
      )
      .then((r: any) => {
        this.updatePageState(page, r);
      })
      .catch((e: any) => {
        this.setState({ currentPage: 1, error: e });
        this.resetHistoryState();
      })
      .finally(() => {
        this.setState({ loading: false });
      });
  }

  render() {
    const {
      orderByKey,
      orderByAsc,
      currentPage,
      pageTokens,
      searchInput,
      // eslint-disable-nextline
    } = this.state;
    // const { prompts } = this.props;
    const prompts = [
      {
        id: '1',
        name: 'test',
        description: 'this is test description',
        latest_versions: [
          {
            version: '1',
            description: 'this is version 1',
            template_text: 'Answer the following questions\n{question}',
            created_at: 123456789,
            tags: [{ key: 'tag1', value: 'value1' }],
          }
        ]
      }
    ]
    return (
      <ScrollablePageWrapper>
        <PromptListView
          prompts={prompts}
          searchInput={searchInput}
          orderByKey={orderByKey}
          orderByAsc={orderByAsc}
          currentPage={currentPage}
          nextPageToken={pageTokens[currentPage + 1]}
          loading={this.state.loading}
          error={this.state.error}
          onSearch={this.handleSearch}
          onClickNext={this.handleClickNext}
          onClickPrev={this.handleClickPrev}
          onClickSortableColumn={this.handleClickSortableColumn}
          onSetMaxResult={this.handleMaxResultsChange}
          maxResultValue={this.getMaxResultsSelection()}
        />
      </ScrollablePageWrapper>
    );
  }
}

const mapStateToProps = (state: any) => {
  const models = Object.values(state.entities.modelByName);
  return {
    models,
  };
};

const mapDispatchToProps = {
  searchPromptsApi,
};

const PromptListPageWithRouter = withRouterNext(connect(mapStateToProps, mapDispatchToProps)(PromptListPageImpl));

export const PromptListPage = withErrorBoundary(
  ErrorUtils.mlflowServices.MODEL_REGISTRY,
  PromptListPageWithRouter);

export default PromptListPage;