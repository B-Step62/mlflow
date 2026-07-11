import { useEffect, useState } from 'react';
import { getLocalStorageItem, setLocalStorageItem } from '@databricks/web-shared/hooks';

// MOCKUP ONLY: previews the page as an admin (full controls) or a developer
// (read-only consumption). A real build would derive this from permissions.
//
// Backed by a module-level external store rather than useLocalStorage so the
// toggle in the sidebar and the consumers in the routed page (different React
// subtrees) share one source of truth and re-render together.
export type MockPersona = 'admin' | 'developer';

const KEY = 'mlflow.mcp_registry.mock_persona';
const VERSION = 1;

let currentPersona = getLocalStorageItem<MockPersona>(KEY, VERSION, false, 'admin');
const listeners = new Set<(persona: MockPersona) => void>();

export const setMockPersona = (persona: MockPersona) => {
  currentPersona = persona;
  setLocalStorageItem(KEY, VERSION, false, persona);
  listeners.forEach((listener) => listener(persona));
};

export const useMockPersona = (): [MockPersona, (persona: MockPersona) => void] => {
  const [persona, setPersona] = useState(currentPersona);

  useEffect(() => {
    listeners.add(setPersona);
    // Catch a change that happened between initial render and effect mount.
    setPersona(currentPersona);
    return () => {
      listeners.delete(setPersona);
    };
  }, []);

  return [persona, setMockPersona];
};
