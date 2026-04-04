/*
 * ЧТО: Единая иконка severity для всех уровней UI.
 * ЗАЧЕМ: Один визуальный язык — error и warning выглядят одинаково
 *        на страницах, в sidebar, на табах.
 * КТО ИСПОЛЬЗУЕТ: StatusTable, PageStatusIcon, TabButton.
 */
import type { Severity } from '../../../../shared/types'

interface SeverityIconProps {
  severity: Severity
  /** sm = 12px (tab indicators), md = 16px (sidebar, page rows). Default: md. */
  size?: 'sm' | 'md'
}

export function SeverityIcon({ severity, size = 'md' }: SeverityIconProps): React.ReactElement {
  const px = size === 'sm' ? 12 : 16
  const innerPx = size === 'sm' ? 7 : 10
  const strokeW = size === 'sm' ? 1.2 : 1.5

  if (severity === 'error') {
    return (
      <div
        className="rounded-full bg-red-500 flex items-center justify-center flex-shrink-0"
        style={{ width: px, height: px }}
      >
        <svg width={innerPx} height={innerPx} viewBox="0 0 10 10" fill="none">
          <path
            d="M3 3L7 7M7 3L3 7"
            stroke="white"
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        </svg>
      </div>
    )
  }

  // warning
  return (
    <div
      className="rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0"
      style={{ width: px, height: px }}
    >
      <svg width={innerPx} height={innerPx} viewBox="0 0 10 10" fill="none">
        <path d="M5 3V5.5" stroke="white" strokeWidth={strokeW} strokeLinecap="round" />
        <circle cx="5" cy="7.5" r="0.75" fill="white" />
      </svg>
    </div>
  )
}
