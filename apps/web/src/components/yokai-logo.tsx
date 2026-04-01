type YokaiLogoProps = {
  className?: string;
  subtitle?: string;
};

export function YokaiLogo({ className, subtitle = 'Control room' }: YokaiLogoProps) {
  return (
    <div className={className}>
      {/* Sekiro-inspired mon (family crest) mark */}
      <svg
        aria-hidden="true"
        className="brand-mark"
        viewBox="0 0 96 96"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="yokai-mon-bg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1c0e08" />
            <stop offset="100%" stopColor="#100806" />
          </linearGradient>
          <linearGradient id="yokai-stroke-fill" x1="18" x2="78" y1="16" y2="80">
            <stop offset="0%" stopColor="#c9955a" />
            <stop offset="50%" stopColor="#a06838" />
            <stop offset="100%" stopColor="#6b3e1e" />
          </linearGradient>
          <linearGradient id="yokai-accent-fill" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#d44030" />
            <stop offset="100%" stopColor="#8b1a10" />
          </linearGradient>
        </defs>

        {/* Background — dark lacquered square */}
        <rect
          fill="url(#yokai-mon-bg)"
          height="72"
          rx="6"
          stroke="rgba(180, 140, 90, 0.22)"
          strokeWidth="1"
          width="72"
          x="12"
          y="12"
        />

        {/* Top red accent line */}
        <rect fill="url(#yokai-accent-fill)" height="2" rx="1" width="36" x="30" y="12" />

        {/* Yokai kanji-style mark — stylised 妖 (yokai) brushstroke shape */}
        {/* Central vertical stroke */}
        <rect fill="url(#yokai-stroke-fill)" height="36" rx="1.5" width="3" x="46.5" y="26" />

        {/* Left diagonal slash */}
        <path
          d="M34 28 L44 56"
          stroke="url(#yokai-stroke-fill)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* Right diagonal slash */}
        <path
          d="M62 28 L52 56"
          stroke="url(#yokai-stroke-fill)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* Horizontal cross-stroke */}
        <rect fill="url(#yokai-stroke-fill)" height="2.5" rx="1" width="28" x="34" y="40" />

        {/* Bottom foot strokes */}
        <path
          d="M40 56 L36 64"
          stroke="url(#yokai-stroke-fill)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M56 56 L60 64"
          stroke="url(#yokai-stroke-fill)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Blood-red accent dot — like the Sekiro resurrection mark */}
        <circle cx="68" cy="18" fill="url(#yokai-accent-fill)" r="3.5" />
        <circle cx="68" cy="18" fill="rgba(255,100,80,0.4)" r="5.5" />
      </svg>

      <div className="brand-copy">
        <strong>Yokai</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
