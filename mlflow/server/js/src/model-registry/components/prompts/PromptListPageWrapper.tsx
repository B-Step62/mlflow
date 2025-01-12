import { withErrorBoundary } from '../../../common/utils/withErrorBoundary';
import ErrorUtils from '../../../common/utils/ErrorUtils';
import { PromptListPage } from './PromptListPage';
const PromptListPageWrapperImpl = () => {
  return <PromptListPage />;
};
export const PromptListPageWrapper = withErrorBoundary(
  ErrorUtils.mlflowServices.MODEL_REGISTRY,
  PromptListPageWrapperImpl,
);

export default PromptListPageWrapper;
