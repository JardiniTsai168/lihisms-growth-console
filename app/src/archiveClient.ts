import { listApprovedArchive, upsertApprovedArchive } from './archiveDb'
import type { ApprovedArchiveItem } from './types'

const configuredBase = import.meta.env.VITE_ARCHIVE_API_BASE?.trim() ?? ''

function getServerBase() {
  if (configuredBase) {
    return configuredBase.replace(/\/$/, '')
  }

  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8787'
  }

  return ''
}

export function getArchiveMode() {
  return getServerBase() ? 'server' : 'indexeddb'
}

export async function loadArchiveItems() {
  const serverBase = getServerBase()

  if (!serverBase) {
    return {
      mode: 'indexeddb' as const,
      items: await listApprovedArchive(),
    }
  }

  const response = await fetch(`${serverBase}/api/archive`)
  if (!response.ok) {
    throw new Error(`Archive API read failed with ${response.status}.`)
  }

  const payload = (await response.json()) as { items?: ApprovedArchiveItem[] }

  return {
    mode: 'server' as const,
    items: payload.items ?? [],
  }
}

export async function saveArchiveItem(item: ApprovedArchiveItem) {
  const serverBase = getServerBase()

  if (!serverBase) {
    await upsertApprovedArchive(item)
    return {
      mode: 'indexeddb' as const,
    }
  }

  const response = await fetch(`${serverBase}/api/archive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(item),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Archive API write failed with ${response.status}.`)
  }

  return {
    mode: 'server' as const,
  }
}
