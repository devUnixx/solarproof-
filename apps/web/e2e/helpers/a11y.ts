/**
 * Accessibility testing helper using @axe-core/playwright — issue #124.
 *
 * Usage in any Playwright test:
 *   import { checkA11y } from '../e2e/helpers/a11y'
 *   await checkA11y(page)
 */

import { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export interface A11yViolation {
  id: string
  impact: string | null
  description: string
  nodes: { target: string[]; failureSummary?: string }[]
}

export interface CheckA11yOptions {
  /** Rules to disable for this run. */
  disableRules?: string[]
  /**
   * When true, every violation is treated as blocking regardless of impact
   * level (used by the dashboard test to assert zero violations).
   */
  allImpacts?: boolean
}

/**
 * Run axe-core on the current page and throw if violations are found.
 * By default only critical and serious violations block; pass
 * `allImpacts: true` to fail on violations of any impact level.
 * Color-contrast violations include the per-node failure summary so the
 * offending colors are visible in the report.
 *
 * @param page     - Playwright Page object.
 * @param options  - Optional AxeBuilder configuration overrides.
 */
export async function checkA11y(
  page: Page,
  options: CheckA11yOptions = {}
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])

  if (options.disableRules?.length) {
    builder = builder.disableRules(options.disableRules)
  }

  const results = await builder.analyze()

  const blocking = options.allImpacts
    ? results.violations
    : results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')

  if (blocking.length === 0) return

  const report = blocking
    .map((v) => {
      const selectors = v.nodes
        .map((n) => {
          const target = n.target.join(' > ')
          if (v.id === 'color-contrast' && n.failureSummary) {
            return `${target}\n      ${n.failureSummary.replace(/\n/g, '\n      ')}`
          }
          return target
        })
        .join('\n    ')
      return `[${(v.impact ?? 'unknown').toUpperCase()}] ${v.id}: ${v.description}\n  Fix: ${v.helpUrl}\n  Elements:\n    ${selectors}`
    })
    .join('\n\n')

  throw new Error(
    `${blocking.length} accessibility violation(s) found:\n\n${report}`
  )
}
