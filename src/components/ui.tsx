import { formatMoney, type Minor } from '@/lib/money';

/** Initials circle. Colour comes from the user record so it is stable everywhere. */
export function Avatar({
  name, color, size = 36, title,
}: { name: string; color: string; size?: number; title?: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      title={title ?? name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initials || '?'}
    </span>
  );
}

/** Overlapping avatars for a group row. */
export function AvatarStack({
  people, max = 4, size = 28,
}: { people: Array<{ name: string; avatarColor: string }>; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <span key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }} className="rounded-full ring-2" >
          <span className="block rounded-full ring-2" style={{ boxShadow: '0 0 0 2px var(--bg-elevated)' }}>
            <Avatar name={p.name} color={p.avatarColor} size={size} />
          </span>
        </span>
      ))}
      {extra > 0 && (
        <span
          className="ml-1 text-xs font-semibold"
          style={{ color: 'var(--text-muted)' }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/**
 * Money, coloured by sign when `signed` is set.
 *
 * Always tabular-nums: a column of amounts in proportional digits is
 * measurably harder to scan, and this app is mostly columns of amounts.
 */
export function Money({
  minor, currency, signed = false, className = '',
}: { minor: Minor; currency: string; signed?: boolean; className?: string }) {
  const color = !signed
    ? undefined
    : minor > 0
      ? 'var(--positive)'
      : minor < 0
        ? 'var(--negative)'
        : 'var(--text-muted)';
  return (
    <span className={`tabular ${className}`} style={color ? { color } : undefined}>
      {formatMoney(minor, currency)}
    </span>
  );
}

export function Badge({
  children, tone = 'neutral',
}: { children: React.ReactNode; tone?: 'neutral' | 'positive' | 'negative' | 'accent' }) {
  const styles: Record<string, React.CSSProperties> = {
    neutral:  { background: 'var(--bg-sunken)', color: 'var(--text-muted)' },
    positive: { background: 'color-mix(in srgb, var(--positive) 14%, transparent)', color: 'var(--positive)' },
    negative: { background: 'color-mix(in srgb, var(--negative) 14%, transparent)', color: 'var(--negative)' },
    accent:   { background: 'var(--accent-soft)', color: 'var(--accent)' },
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={styles[tone]}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  emoji, title, children,
}: { emoji: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <span className="text-4xl">{emoji}</span>
      <p className="font-semibold">{title}</p>
      {children && (
        <p className="max-w-sm text-sm" style={{ color: 'var(--text-muted)' }}>
          {children}
        </p>
      )}
    </div>
  );
}

export function Stat({
  label, value, hint,
}: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="card">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular">{value}</p>
      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}
