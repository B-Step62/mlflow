import { useCallback } from 'react';
import { getLocalStorageItem, useLocalStorage } from '@databricks/web-shared/hooks';

// MOCKUP ONLY: which connection options an admin has hidden from developers,
// per server, in localStorage. A real build would persist a visibility flag on
// each access binding / connection option server-side.
const HIDDEN_VERSION = 1;
const hiddenKey = (serverName: string) => `mlflow.mcp_registry.mock_hidden_options.${serverName}`;

export const useMockConnectVisibility = (serverName: string): [string[], (optionKey: string) => void] => {
  const [hiddenKeys, setHiddenKeys] = useLocalStorage<string[]>({
    key: hiddenKey(serverName),
    version: HIDDEN_VERSION,
    initialValue: [],
  });

  const toggleKey = useCallback(
    (optionKey: string) => {
      setHiddenKeys((current) =>
        current.includes(optionKey) ? current.filter((k) => k !== optionKey) : [...current, optionKey],
      );
    },
    [setHiddenKeys],
  );

  return [hiddenKeys, toggleKey];
};

// Non-hook snapshot for the quick-connect modal opened from a card, which must
// not subscribe to a per-server hook instance.
export const getHiddenOptionKeys = (serverName: string): string[] =>
  getLocalStorageItem<string[]>(hiddenKey(serverName), HIDDEN_VERSION, false, []);
