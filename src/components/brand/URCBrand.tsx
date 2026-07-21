'use client';

import Image from 'next/image';
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

export function URCBrandMark({ size = 24, className, tone = 'light' }: BrandMarkProps) {
  return (
    <Image
      // Tone-aware: the white mark disappears on light backgrounds
      src={tone === 'light' ? uniqLogoMark : uniqLogoColor}
      alt={BRAND.parentName}
      width={size}
      height={size}
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
  const logoSource = tone === 'light' ? uniqLogoMark : uniqLogoColor;
  const logoWidth = Math.max(1, Math.round((logoSource.width / logoSource.height) * logoHeight));
  // Show the full product name ("Uniqus Research Center") rather than stripping
  // the parent — for an internal launch the firm's name belongs in the wordmark,
  // not only implied by the logo mark.
  const productLine = BRAND.productName;
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
      <Image
        src={logoSource}
        alt={BRAND.parentName}
        width={logoWidth}
        height={logoHeight}
        suppressHydrationWarning
        style={{
          display: 'block',
          // Match the rendered CSS dimensions to the image attributes. An
          // auto width can round the imported bitmap's ratio differently and
          // makes Next report a one-axis resize even though the ratio is kept.
          height: `${logoHeight}px`,
          width: `${logoWidth}px`,
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
