'use client';

import { BRAND } from '../../config/brand';
import uniqLogoColor from '../../assets/brand/uniqus-logo-color.png';
import uniqLogoMark from '../../assets/brand/uniqus-logo-white.png';

type Tone = 'light' | 'dark';

interface BrandMarkProps {
  size?: number;
  className?: string;
  tone?: Tone;
}

interface BrandLockupProps extends BrandMarkProps {
  compact?: boolean;
  tone?: Tone;
  showParent?: boolean;
}

function resolveLogoSource(tone: Tone) {
  return tone === 'light' ? uniqLogoMark.src : uniqLogoColor.src;
}

export function URCBrandMark({ size = 24, className, tone = 'light' }: BrandMarkProps) {
  return (
    <img
      // Tone-aware: the white mark disappears on light backgrounds
      src={resolveLogoSource(tone)}
      alt={BRAND.parentName}
      className={className}
      style={{
        display: 'block',
        height: `${size}px`,
        width: `${size}px`,
        objectFit: 'cover',
        objectPosition: 'left center',
      }}
    />
  );
}

export function URCBrandLockup({
  size = 24,
  compact = false,
  tone = 'light',
  showParent = false,
  className,
}: BrandLockupProps) {
  const textColor = tone === 'light' ? '#FFFFFF' : '#413F42';
  const subColor = tone === 'light' ? 'rgba(255,255,255,0.72)' : '#7A6C7B';
  const logoHeight = size + 10;
  const productLine = BRAND.productName.replace(`${BRAND.parentName} `, '');
  const supportingLine = 'SEC intelligence platform';

  return (
    <span
      className={className}
      aria-label={BRAND.productName}
      suppressHydrationWarning
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? '10px' : '12px',
        minWidth: 0,
        maxWidth: '100%',
      }}
    >
      <img
        src={resolveLogoSource(tone)}
        alt={BRAND.parentName}
        suppressHydrationWarning
        style={{
          display: 'block',
          // Fixed height always: 'width: 100%' inside an inline-flex parent
          // with min-width: 0 collapsed the image to 0×0 (invisible logo)
          height: `${logoHeight}px`,
          width: 'auto',
          maxWidth: '148px',
          objectFit: 'contain',
          flexShrink: 0,
          padding: compact ? '4px 0' : undefined,
          boxSizing: 'border-box',
        }}
      />
      {showParent && !compact && (
        <span
          suppressHydrationWarning
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            minWidth: 0,
            lineHeight: 1.05,
          }}
        >
          <span
            suppressHydrationWarning
            style={{
              color: textColor,
              fontWeight: 700,
              fontSize: '0.88rem',
              letterSpacing: '0.02em',
              textTransform: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {productLine}
          </span>
          <span
            suppressHydrationWarning
            style={{
              color: subColor,
              fontSize: '0.7rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginTop: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            {supportingLine}
          </span>
        </span>
      )}
    </span>
  );
}
