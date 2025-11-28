import React, { useRef, useState } from 'react';
import { useDesignSystemTheme, Button } from '@databricks/design-system';
import AiLogoUrl from '../components/ai-logo.svg';

export interface InsightQueryBannerProps {
  placeholder: string;
  ariaLabel?: string;
  onSubmit?: (value: string) => void;
  initialValue?: string;
  size?: 'normal' | 'compact';
}

export const InsightQueryBanner = ({ placeholder, ariaLabel = 'Insight query', onSubmit, initialValue = '', size = 'normal' }: InsightQueryBannerProps) => {
  const { theme } = useDesignSystemTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.(value);
      }}
      onClick={() => inputRef.current?.focus()}
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        width: '100%',
        padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
        textAlign: 'left',
        cursor: 'text',
        borderRadius: theme.borders.borderRadiusMd,
        border: '1px solid transparent',
        background:
          'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, rgb(74, 174, 255) 20.5%, rgb(202, 66, 224) 46.91%, rgb(255, 95, 70) 79.5%) border-box',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
        boxShadow: '0 0 0 0 rgba(0,0,0,0)',
        '&:hover': {
          transform: 'translateY(-0.5px)',
          boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06)'
        },
        '&:active': {
          transform: 'translateY(0)'
        },
        '&:focus-within': {
          outline: `2px solid ${theme.colors.actionPrimaryTextDefault}`,
          outlineOffset: 2,
        },
      }}
    >
      <span css={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden>
        <img src={AiLogoUrl} alt="" width={20} height={20} css={{ display: 'block' }} />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit?.(value);
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        css={{
          flex: 1,
          minWidth: 0,
          border: 0,
          outline: 'none',
          background: 'transparent',
          color: theme.colors.textPrimary,
          fontSize: 14,
          lineHeight: '20px',
          '::placeholder': { color: theme.colors.textSecondary },
        }}
      />
      {/* Optional hidden submit to allow Enter key without extra UI */}
      <Button css={{ display: 'none' }} htmlType="submit" />
    </form>
  );
};

export default InsightQueryBanner;
