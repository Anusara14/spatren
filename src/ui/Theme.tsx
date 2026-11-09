import { setThemePref, useTheme, type ThemePref } from '../lib/theme'

const OPTIONS: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export function ThemeToggle() {
  const { pref } = useTheme()
  return (
    <div className="segmented" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button key={o.id} role="radio" aria-checked={pref === o.id} aria-pressed={pref === o.id} onClick={() => setThemePref(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The SPATREN mark in the right colours for the current theme. */
export function Mark({ size = 30, className }: { size?: number; className?: string }) {
  const { theme } = useTheme()
  return <img className={className} src={theme === 'dark' ? '/mark-dark.svg' : '/mark.svg'} alt="SPATREN" width={size} height={size} />
}

export function StackedLogo({ style }: { style?: React.CSSProperties }) {
  const { theme } = useTheme()
  return <img src={theme === 'dark' ? '/logo-stacked-dark.svg' : '/logo-stacked.svg'} alt="SPATREN" style={style} />
}
