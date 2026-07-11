import type { ConnectOption } from './connectOptions';

// Picks the single "recommended" way to connect, for the quick Connect modal.
// Skips options an admin has hidden, then prefers a custom (approved) endpoint,
// then an official remote, then a package.
export const resolveCanonicalOption = (
  options: ConnectOption[],
  hiddenKeys: string[] = [],
): ConnectOption | undefined => {
  const visible = options.filter((o) => !hiddenKeys.includes(o.key));
  return (
    visible.find((o) => o.kind === 'endpoint') ??
    visible.find((o) => o.kind === 'remote') ??
    visible.find((o) => o.kind === 'package') ??
    visible[0]
  );
};
