import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';

type HeaderVisibilityContextValue = {
  headerHidden: boolean;
  setHeaderHidden: (hidden: boolean) => void;
  /** When true, the header's action buttons (management menu, share, description edit)
   *  are hidden so the active tab page can provide its own controls without duplication. */
  headerActionsHidden: boolean;
  setHeaderActionsHidden: (hidden: boolean) => void;
  breadcrumbChild: ReactNode;
  setBreadcrumbChild: (breadcrumbChild: ReactNode) => void;
  titleOverride: ReactNode;
  setTitleOverride: (titleOverride: ReactNode) => void;
  titleAdjacent: ReactNode;
  setTitleAdjacent: (titleAdjacent: ReactNode) => void;
  titleMetadata: ReactNode;
  setTitleMetadata: (titleMetadata: ReactNode) => void;
  actionSlot: ReactNode;
  setActionSlot: (actionSlot: ReactNode) => void;
};

const HeaderVisibilityContext = createContext<HeaderVisibilityContextValue>({
  headerHidden: false,
  setHeaderHidden: () => {},
  headerActionsHidden: false,
  setHeaderActionsHidden: () => {},
  breadcrumbChild: undefined,
  setBreadcrumbChild: () => {},
  titleOverride: undefined,
  setTitleOverride: () => {},
  titleAdjacent: undefined,
  setTitleAdjacent: () => {},
  titleMetadata: undefined,
  setTitleMetadata: () => {},
  actionSlot: undefined,
  setActionSlot: () => {},
});

export const HeaderVisibilityProvider = ({ children }: { children: ReactNode }) => {
  const [headerHidden, setHeaderHidden] = useState(false);
  const [headerActionsHidden, setHeaderActionsHidden] = useState(false);
  const [breadcrumbChild, setBreadcrumbChild] = useState<ReactNode>();
  const [titleOverride, setTitleOverride] = useState<ReactNode>();
  const [titleAdjacent, setTitleAdjacent] = useState<ReactNode>();
  const [titleMetadata, setTitleMetadata] = useState<ReactNode>();
  const [actionSlot, setActionSlot] = useState<ReactNode>();
  const value = useMemo(
    () => ({
      headerHidden,
      setHeaderHidden,
      headerActionsHidden,
      setHeaderActionsHidden,
      breadcrumbChild,
      setBreadcrumbChild,
      titleOverride,
      setTitleOverride,
      titleAdjacent,
      setTitleAdjacent,
      titleMetadata,
      setTitleMetadata,
      actionSlot,
      setActionSlot,
    }),
    [headerHidden, headerActionsHidden, breadcrumbChild, titleOverride, titleAdjacent, titleMetadata, actionSlot],
  );
  return <HeaderVisibilityContext.Provider value={value}>{children}</HeaderVisibilityContext.Provider>;
};

export const useHeaderVisibility = () => useContext(HeaderVisibilityContext);
