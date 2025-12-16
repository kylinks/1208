'use client'

import { ReactNode } from 'react'

type OverviewKpiCardProps = {
  title: string
  icon: ReactNode
  value: ReactNode
  footer?: ReactNode
  theme: {
    bg: string
    border: string
    titleText: string
    valueText: string
    iconBg: string
    iconText: string
  }
  loading?: boolean
}

export function OverviewKpiCard({
  title,
  icon,
  value,
  footer,
  theme,
  loading,
}: OverviewKpiCardProps) {
  return (
    <div
      className={[
        'rounded-2xl border shadow-sm transition-shadow hover:shadow-md',
        'p-5 sm:p-6',
        theme.bg,
        theme.border,
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <div
          className={[
            'h-10 w-10 rounded-xl flex items-center justify-center',
            theme.iconBg,
            theme.iconText,
          ].join(' ')}
        >
          {icon}
        </div>
        <div className={['text-sm sm:text-base font-semibold', theme.titleText].join(' ')}>{title}</div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="animate-pulse">
            <div className="h-10 sm:h-12 w-40 rounded bg-black/10" />
          </div>
        ) : (
          <div
            className={[
              'text-3xl sm:text-4xl font-extrabold leading-none tracking-tight',
              theme.valueText,
            ].join(' ')}
          >
            {value}
          </div>
        )}
      </div>

      {!loading && footer ? <div className="mt-5">{footer}</div> : null}
    </div>
  )
}


