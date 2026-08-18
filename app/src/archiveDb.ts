import type { ApprovedArchiveItem } from './types'

const DB_NAME = 'lihisms-approved-archive'
const STORE_NAME = 'approved_creatives'
const DB_VERSION = 1

function openArchiveDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('approvedAt', 'approvedAt')
        store.createIndex('productName', 'productName')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open archive database.'))
  })
}

export async function listApprovedArchive() {
  const database = await openArchiveDb()

  return new Promise<ApprovedArchiveItem[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const results = (request.result as ApprovedArchiveItem[]).sort((left, right) =>
        right.approvedAt.localeCompare(left.approvedAt),
      )
      resolve(results)
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to read archive database.'))
  })
}

export async function upsertApprovedArchive(item: ApprovedArchiveItem) {
  const database = await openArchiveDb()

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.put(item)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to save approved creative.'))
  })
}
