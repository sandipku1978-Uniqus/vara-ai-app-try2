'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ANALYTICS_CONSENT_EVENT,
  ANALYTICS_CONSENT_STORAGE_KEY,
  readAnalyticsConsent,
} from '../../config/analytics'

const analyticsEnabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED === 'true'
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
let posthogInitialized = false

function stripUrlDetails(value: unknown): unknown {
  if (typeof value !== 'string') return value

  try {
    const parsed = new URL(value, window.location.origin)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return value.split(/[?#]/, 1)[0]
  }
}

function redactNavigationProperties(properties: Record<string, unknown> | undefined) {
  if (!properties) return properties

  const redacted = { ...properties }
  for (const key of ['$current_url', '$referrer', '$initial_referrer']) {
    redacted[key] = stripUrlDetails(redacted[key])
  }
  return redacted
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [analyticsActive, setAnalyticsActive] = useState(false)

  useEffect(() => {
    const syncAnalytics = () => {
      const shouldActivate = analyticsEnabled
        && Boolean(posthogKey)
        && readAnalyticsConsent() === 'granted'

      if (shouldActivate && posthogKey) {
        if (!posthogInitialized) {
          posthog.init(posthogKey, {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
            person_profiles: 'identified_only',
            capture_pageview: false,
            capture_pageleave: false,
            autocapture: false,
            disable_session_recording: true,
            before_send: event => {
              if (!event) return null
              return {
                ...event,
                properties: redactNavigationProperties(event.properties) || {},
              }
            },
          })
          posthogInitialized = true
        }
        posthog.opt_in_capturing()
      } else if (posthogInitialized) {
        posthog.opt_out_capturing()
      }

      setAnalyticsActive(shouldActivate)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ANALYTICS_CONSENT_STORAGE_KEY) syncAnalytics()
    }

    syncAnalytics()
    window.addEventListener('storage', handleStorage)
    window.addEventListener(ANALYTICS_CONSENT_EVENT, syncAnalytics)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, syncAnalytics)
    }
  }, [])

  useEffect(() => {
    if (!analyticsActive || !posthogInitialized || typeof window === 'undefined') return

    posthog.capture('$pageview', {
      $current_url: `${window.location.origin}${pathname}`,
      $pathname: pathname,
      title: document.title,
    })
  }, [analyticsActive, pathname])

  if (!analyticsActive) return children

  return <PHProvider client={posthog}>{children}</PHProvider>
}
