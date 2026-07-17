import React, { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { Drawer } from '@databricks/design-system';

import type { ModelTraceInfoV3 } from './ModelTrace.types';

export interface RenderExportTracesToDatasetsModalParams {
  selectedTraceInfos: ModelTraceInfoV3[];
  experimentId: string;
  visible: boolean;
  setVisible: (visible: boolean) => void;
}

export interface RenderAddToReviewQueueDropdownParams {
  selectedTraceInfos: ModelTraceInfoV3[];
  experimentId: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  popoverAlign?: 'start' | 'end';
}

export type DrawerComponentType = {
  Root: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    modal?: boolean;
    children: ReactNode;
  }) => React.ReactElement;
  Content: (props: Drawer.DrawerContentProps) => React.ReactElement;
};

export interface AddToDatasetAction {
  openModal: () => void;
}

export interface ModelTraceExplorerContextValue {
  renderExportTracesToDatasetsModal?: (params: RenderExportTracesToDatasetsModalParams) => React.ReactNode;
  renderAddToReviewQueueDropdown?: React.ComponentType<RenderAddToReviewQueueDropdownParams>;
  DrawerComponent: DrawerComponentType;
  /** When set (e.g. by the evaluation review drawer), content can show "Add to dataset" that calls openModal */
  addToDatasetAction?: AddToDatasetAction;
  rightPaneHeaderActions?: ReactNode;
  drawerWidth?: string | number;
  isSearchVisible?: boolean;
  setSearchVisible?: (visible: boolean) => void;
}

const ModelTraceExplorerContext = createContext<ModelTraceExplorerContextValue>({
  renderExportTracesToDatasetsModal: () => null,
  DrawerComponent: Drawer,
  addToDatasetAction: undefined,
  rightPaneHeaderActions: undefined,
  isSearchVisible: false,
});

interface ModelTraceExplorerContextProviderProps {
  children: React.ReactNode;
  renderExportTracesToDatasetsModal?: (params: RenderExportTracesToDatasetsModalParams) => React.ReactNode;
  renderAddToReviewQueueDropdown?: React.ComponentType<RenderAddToReviewQueueDropdownParams>;
  DrawerComponent?: DrawerComponentType;
  drawerWidth?: string | number;
}

export const ModelTraceExplorerContextProvider: React.FC<ModelTraceExplorerContextProviderProps> = ({
  children,
  renderExportTracesToDatasetsModal,
  renderAddToReviewQueueDropdown,
  DrawerComponent = Drawer,
  drawerWidth,
}) => {
  const value = useMemo(
    () => ({
      renderExportTracesToDatasetsModal,
      renderAddToReviewQueueDropdown,
      DrawerComponent,
      drawerWidth,
    }),
    [renderExportTracesToDatasetsModal, renderAddToReviewQueueDropdown, DrawerComponent, drawerWidth],
  );

  return <ModelTraceExplorerContext.Provider value={value}>{children}</ModelTraceExplorerContext.Provider>;
};

/** Use inside the drawer to expose "Add to dataset" to trace content (e.g. next to Show assessments). */
export const ModelTraceExplorerAddToDatasetProvider: React.FC<{
  openModal: () => void;
  children: ReactNode;
}> = ({ openModal, children }) => {
  const parent = useContext(ModelTraceExplorerContext);
  const value = useMemo(() => ({ ...parent, addToDatasetAction: { openModal } }), [parent, openModal]);
  return <ModelTraceExplorerContext.Provider value={value}>{children}</ModelTraceExplorerContext.Provider>;
};

export const ModelTraceExplorerRightPaneHeaderActionsProvider: React.FC<{
  openAddToDatasetModal?: () => void;
  rightPaneHeaderActions?: ReactNode;
  isSearchVisible?: boolean;
  setSearchVisible?: (visible: boolean) => void;
  children: ReactNode;
}> = ({ openAddToDatasetModal, rightPaneHeaderActions, isSearchVisible, setSearchVisible, children }) => {
  const parent = useContext(ModelTraceExplorerContext);
  const value = useMemo(
    () => ({
      ...parent,
      addToDatasetAction: openAddToDatasetModal ? { openModal: openAddToDatasetModal } : parent.addToDatasetAction,
      rightPaneHeaderActions,
      isSearchVisible: isSearchVisible ?? parent.isSearchVisible,
      setSearchVisible: setSearchVisible ?? parent.setSearchVisible,
    }),
    [parent, openAddToDatasetModal, rightPaneHeaderActions, isSearchVisible, setSearchVisible],
  );
  return <ModelTraceExplorerContext.Provider value={value}>{children}</ModelTraceExplorerContext.Provider>;
};

export const useModelTraceExplorerContext = () => {
  return useContext(ModelTraceExplorerContext);
};
