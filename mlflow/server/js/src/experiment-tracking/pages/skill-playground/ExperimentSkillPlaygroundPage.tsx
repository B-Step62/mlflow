import invariant from 'invariant';
import { useParams } from '../../../common/utils/RoutingUtils';
import { SkillPlaygroundPage } from './SkillPlaygroundPage';

const ExperimentSkillPlaygroundPage = () => {
  const { experimentId } = useParams();
  invariant(experimentId, 'Experiment ID must be defined');

  return <SkillPlaygroundPage experimentId={experimentId} />;
};

export default ExperimentSkillPlaygroundPage;
