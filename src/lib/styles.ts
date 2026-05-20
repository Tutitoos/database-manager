/**
 * Style tokens mapped to the semantic design tokens defined in
 * `src/styles/tokens.css`. Importers don't need to change to pick up the
 * new dark/light/accent system; the className strings here resolve to
 * `var(--surface)` etc via the Tailwind `@theme` block in `index.css`.
 */

export const appBg = "bg-bg";
export const panel = "bg-surface backdrop-blur-xl";
export const surface = "border border-border-subtle bg-surface-elevated shadow-sm backdrop-blur-md";
export const mutedText = "text-text-muted";
export const softText = "text-text-faint";
export const sectionBorder = "border-border-subtle";

export const inputBase =
  "h-9 w-full rounded-md border border-border-subtle bg-surface-sunken px-3 text-h3 text-text " +
  "placeholder:text-text-faint outline-none transition-colors " +
  "hover:border-border-strong focus:border-border-focus focus:ring-1 focus:ring-accent-ring " +
  "disabled:pointer-events-none disabled:opacity-50";
