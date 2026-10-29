import React, { useEffect, useState } from 'react'
import { Download, Trash2, X } from 'lucide-react'
import {
  StoredRecording,
  listStoredRecordings,
  downloadStoredRecording,
  deleteStoredRecording,
  formatBytes,
  displayNameFor,
} from '@/lib/recording/storage'
import { logger } from '@/lib/logger'

// Offers recordings left in browser storage — from a tab that closed or
// crashed mid-recording, or a download that didn't get cleared in time.
export default function RecordingRecovery() {
  const [recordings, setRecordings] = useState<StoredRecording[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    listStoredRecordings()
      .then(setRecordings)
      .catch(error => logger.warn('Could not list stored recordings', error))
  }, [])

  if (dismissed || recordings.length === 0) return null

  const removeFromList = (name: string) => setRecordings(prev => prev.filter(r => r.name !== name))

  const handleDownload = (name: string) => {
    downloadStoredRecording(name)
      .then(() => removeFromList(name))
      .catch(error => logger.error('Error downloading stored recording', error))
  }

  const handleDiscard = (name: string) => {
    if (!window.confirm('Delete this recording? This cannot be undone.')) return
    deleteStoredRecording(name)
      .then(() => removeFromList(name))
      .catch(error => logger.error('Error deleting stored recording', error))
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:right-auto sm:w-96 z-40 bg-white rounded-2xl shadow-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-gray-900">
          {recordings.length === 1 ? 'A meeting recording was not downloaded' : `${recordings.length} meeting recordings were not downloaded`}
        </p>
        <button onClick={() => setDismissed(true)} className="p-1 -m-1 rounded-full text-gray-400 hover:text-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {recordings.map(recording => (
          <li key={recording.name} className="flex items-center gap-2">
            <div className="min-w-0 flex-grow">
              <p className="text-xs text-gray-700 truncate">{displayNameFor(recording.name)}</p>
              <p className="text-[11px] text-gray-400">{formatBytes(recording.size)} · {new Date(recording.lastModified).toLocaleString()}</p>
            </div>
            <button onClick={() => handleDownload(recording.name)} className="p-2 rounded-full bg-brand text-white hover:opacity-90" title="Download">
              <Download className="h-4 w-4" />
            </button>
            <button onClick={() => handleDiscard(recording.name)} className="p-2 rounded-full text-gray-500 hover:bg-gray-100" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
