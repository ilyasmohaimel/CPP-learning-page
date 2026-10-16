export function ForgeMark({ size = 42 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="46"
        height="46"
        rx="12"
        fill="currentColor"
        fillOpacity=".1"
      />
      <path
        d="m12 15-6 9 6 9m24-18 6 9-6 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M25 8c1 8-8 10-7 18 1 6 9 7 13 2 4-6-1-12-2-15 0 7-4 9-4 9 2-6 0-10 0-14Z"
        fill="var(--amber)"
      />
      <path
        d="M24 23c1 3-2 4-2 7 0 3 4 4 6 1 1-2-1-4-2-5 0 3-1 4-1 4 1-3-1-5-1-7Z"
        fill="currentColor"
      />
    </svg>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <ForgeMark />
      <div>
        <strong>
          C Forge<span className="brand-dot">.</span>
        </strong>
        <small>Your coding workshop</small>
      </div>
    </div>
  );
}

export function LanguageLogo({
  cpp = false,
  small = false,
}: {
  cpp?: boolean;
  small?: boolean;
}) {
  return (
    <svg
      className={`language-logo${small ? " small" : ""}`}
      width="38"
      height="42"
      viewBox="0 0 48 52"
      fill="none"
      aria-hidden="true"
    >
      <path d="M24 1 46 13.5v25L24 51 2 38.5v-25Z" fill="#5389c6" />
      <path d="m24 26 22-12.5v25L24 51 2 38.5Z" fill="#245b98" />
      <path
        d="M33.6 18a12.5 12.5 0 1 0 0 16l-4.2-3.5a7 7 0 1 1 0-9Z"
        transform={cpp ? "translate(-4 0)" : undefined}
        fill="#fff"
      />
      {cpp ? (
        <path
          d="M31 26h5m-2.5-2.5v5m5-2.5h5m-2.5-2.5v5"
          stroke="#fff"
          strokeWidth="1.8"
        />
      ) : null}
    </svg>
  );
}
