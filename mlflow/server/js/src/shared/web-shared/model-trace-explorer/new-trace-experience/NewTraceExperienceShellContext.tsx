import React, { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

export interface NewTraceExperienceShellContextValue {
  selectPreviousTrace: () => void;
  selectNextTrace: () => void;
  isPreviousAvailable: boolean;
  isNextAvailable: boolean;
  onShare: () => void;
  onOpenInNewTab?: () => void;
  onClose: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
}

const NewTraceExperienceShellContext = createContext<NewTraceExperienceShellContextValue | undefined>(undefined);

export const NewTraceExperienceShellProvider: React.FC<{
  value: NewTraceExperienceShellContextValue;
  children: ReactNode;
}> = ({ value, children }) => {
  const memoized = useMemo(() => value, [value]);
  return <NewTraceExperienceShellContext.Provider value={memoized}>{children}</NewTraceExperienceShellContext.Provider>;
};

export const useNewTraceExperienceShellContext = (): NewTraceExperienceShellContextValue | undefined => {
  return useContext(NewTraceExperienceShellContext);
};
