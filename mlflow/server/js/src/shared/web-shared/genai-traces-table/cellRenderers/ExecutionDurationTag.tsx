import React from 'react';

import { Typography } from '@databricks/design-system';

interface ExecutionDurationTagProps {
  value: string;
}

export const ExecutionDurationTag: React.FC<ExecutionDurationTagProps> = ({ value }) => (
  <Typography.Text
    css={{
      display: 'block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      width: 'fit-content',
      maxWidth: '100%',
    }}
    title={value}
  >
    {value}
  </Typography.Text>
);
