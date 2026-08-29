import type { SVGProps } from 'react';

export default function OpenCreatorMark({
  size = 18,
  className,
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number }) {
  return (
    <svg
      {...props}
      className={className === undefined ? 'opencreator-mark' : `opencreator-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      focusable="false"
    >
      <path
        d="M21.4 8.2A10.5 10.5 0 1 0 21.4 23.8"
        stroke="currentColor"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <path
        d="M24.5 11.5 25.7 14.8 29 16l-3.3 1.2-1.2 3.3-1.2-3.3L20 16l3.3-1.2 1.2-3.3Z"
        fill="currentColor"
      />
    </svg>
  );
}
