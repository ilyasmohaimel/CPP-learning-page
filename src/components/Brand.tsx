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
