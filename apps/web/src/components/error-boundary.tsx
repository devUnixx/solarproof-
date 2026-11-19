'use client'

import React from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface Props {
  children: React.ReactNode
  /** Smaller inline fallback for panel-level boundaries */
  inline?: boolean
  label?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children

    return <ErrorFallback inline={this.props.inline} label={this.props.label} onReset={this.reset} />
  }
}

interface FallbackProps {
  inline?: boolean
  label?: string
  onReset: () => void
}

function ErrorFallback({ inline, label, onReset }: FallbackProps) {
  const t = useTranslations('errors.boundary')

  if (inline) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/40"
      >
        <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden="true" />
        <p className="text-sm font-medium text-red-700 dark:text-red-400">
          {label ? t('panelFailedWithLabel', { label }) : t('panelFailed')}
        </p>
        <button
          onClick={onReset}
          className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60"
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center"
    >
      <AlertTriangle className="h-12 w-12 text-red-500" aria-hidden="true" />
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {label ? t('panelFailedWithLabel', { label }) : t('title')}
      </h2>
      <p className="max-w-md text-gray-500 dark:text-gray-400">{t('description')}</p>
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="rounded-lg bg-yellow-400 px-5 py-2.5 font-semibold text-gray-900 hover:bg-yellow-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2"
        >
          {t('tryAgain')}
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {t('reloadPage')}
        </button>
      </div>
    </div>
  )
}
