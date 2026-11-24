export const KeyboardShortcutKey = ({ children }: { children: string }) => {
  return (
    <kbd
      aria-hidden="true"
      css={{
        minWidth: 'var(--db-size-5)',
        height: 'var(--db-size-5)',
        padding: '0 var(--db-space-1)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--db-border-base)',
        borderRadius: 'var(--db-shape-control)',
        backgroundColor: 'var(--db-surface-subtle)',
        color: 'var(--db-text-subtle)',
        fontFamily: 'inherit',
        fontSize: 'var(--db-font-size-sm)',
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  );
};
