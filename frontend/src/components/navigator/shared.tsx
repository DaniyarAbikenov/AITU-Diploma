import type { ReactNode } from "react";
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`nav-panel ${className}`}>
      {title && (
        <div className="nav-panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="nav-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
export function City() {
  return (
    <svg className="nav-city" viewBox="0 0 450 270" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="land" x1="100" y1="90" x2="350" y2="270" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e7f4df" />
          <stop offset="1" stopColor="#abcfa8" />
        </linearGradient>
      </defs>
      <ellipse cx="239" cy="230" rx="182" ry="30" fill="#194c3c" opacity=".07" />
      <path d="M33 178 213 87 419 176 242 264Z" fill="#8fb491" />
      <path d="M33 169 213 78 419 167 242 255Z" fill="url(#land)" />
      <path d="m49 176 188-76 17 7-185 79Zm111 45 180-90 19 8-179 91Z" fill="#fff" opacity=".7" />
      <path d="m126 125 225 76 18-9-226-75Z" fill="#fff" opacity=".7" />
      <path d="m190 149 0-81 46-23 0 83Z" fill="#e3eee3" />
      <path d="m236 45 43 22v83l-43-22Z" fill="#9ab8a2" />
      <path d="m190 68 46-23 43 22-45 24Z" fill="#fff" />
      <path
        d="m204 82 18-9v15l-18 9Zm0 28 18-9v15l-18 9Zm42-29 18 9v15l-18-9Zm0 27 18 9v15l-18-9Z"
        fill="#568477"
      />
      <path d="m278 179 0-59 39-20v60Z" fill="#f5f2d7" />
      <path d="m317 100 34 17v60l-34-17Z" fill="#c4c5a3" />
      <path d="m271 122 45-38 43 34-42-14Z" fill="#437e65" />
      <path d="m290 137 15-7v17l-15 7Zm34-4 13 6v18l-13-6Z" fill="#6b9c8c" />
      <path d="m97 175 0-43 37-18v43Z" fill="#faf8e9" />
      <path d="m134 114 39 19v44l-39-20Z" fill="#b7c7ae" />
      <path d="m88 136 44-41 49 40-47-17Z" fill="#3b8065" />
      <path d="m111 144 13-7v16l-13 7Zm35-4 14 7v18l-14-7Z" fill="#6b9c8c" />
      {[
        [80, 177],
        [179, 181],
        [365, 177],
        [285, 215],
        [170, 112],
      ].map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x} ${y}v-25`} stroke="#54765a" strokeWidth="4" />
          <ellipse cx={x} cy={y - 30} rx="13" ry="20" fill={i % 2 ? "#7ca775" : "#4b8c69"} />
          <ellipse cx={x - 4} cy={y - 36} rx="7" ry="12" fill="#93b784" />
        </g>
      ))}
      <circle cx="362" cy="68" r="25" fill="#f2e6b3" opacity=".8" />
      <path
        d="m67 80 8 3 8-3m237-45 8 3 8-3"
        stroke="#82a894"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Field({
  label,
  name,
  type = "number",
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  placeholder?: string;
}) {
  return (
    <label className="nav-field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required
        min={type === "number" ? 1 : undefined}
        step={type === "number" ? 1 : undefined}
        maxLength={type === "text" ? 80 : undefined}
      />
    </label>
  );
}
