import { useEffect, useState } from 'react'

export function usePersistentState<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue
    }

    const existing = window.localStorage.getItem(key)
    if (!existing) {
      return initialValue
    }

    try {
      return JSON.parse(existing) as T
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])

  return [state, setState] as const
}
