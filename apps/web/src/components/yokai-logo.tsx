type YokaiLogoProps = {
  className?: string;
  subtitle?: string;
};

export function YokaiLogo({ className, subtitle = 'Control room' }: YokaiLogoProps) {
  return (
    <div className={className}>
      <svg
        aria-hidden="true"
        className="brand-mark"
        viewBox="0 0 96 96"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="yokai-logo-fill" x1="18" x2="78" y1="16" y2="80">
            <stop offset="0%" stopColor="#8ea6c7" />
            <stop offset="55%" stopColor="#5c7597" />
            <stop offset="100%" stopColor="#283a53" />
          </linearGradient>
        </defs>
        <rect
          fill="rgba(11, 17, 32, 0.72)"
          height="72"
          rx="24"
          stroke="rgba(203, 213, 225, 0.16)"
          width="72"
          x="12"
          y="12"
        />
        <path
          d="M31 28h34l-17 18 17 22H52L41 54 31 68H18l17-22-4-4Z"
          fill="url(#yokai-logo-fill)"
        />
        <circle cx="68" cy="28" fill="#d8e4f7" r="4" />
      </svg>

      <div className="brand-copy">
        <strong>Yokai</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

