export const STREAM_WINDOW_QUERY_KEY = 'view'
export const STREAM_WINDOW_QUERY_VALUE = 'stream'
export const STREAM_OVERLAY_STORAGE_KEY = 'werewolf-board-stream-overlay'

export type StreamRoleResultItem = {
  id: string
  roleLabel: string
  actorName: string
  targetName: string
  resultMark: string
  resultText: string
}

export type StreamDaySummary = {
  dayNumber: number
  executedName: string
  bittenName: string
  roleResults: StreamRoleResultItem[]
}

export type StreamOverlayPayload = {
  updatedAt: string
  activeDayNumber: number
  latestDayNumber: number
  daySummaries: StreamDaySummary[]
  roleActorsByLabel: Partial<Record<'占い師' | '霊媒師' | '騎士', string[]>>
  comment: string
}

export const readStreamOverlayPayload = (): StreamOverlayPayload | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(STREAM_OVERLAY_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StreamOverlayPayload
  } catch {
    return null
  }
}
