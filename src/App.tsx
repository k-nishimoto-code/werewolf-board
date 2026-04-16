import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import jinroIcon from './assets/JINRO_ICON.png'

import {
  STREAM_OVERLAY_STORAGE_KEY,
  STREAM_WINDOW_QUERY_KEY,
  STREAM_WINDOW_QUERY_VALUE,
  type StreamDaySummary,
  type StreamOverlayPayload,
  type StreamRoleResultItem,
} from './streaming'

type RoleKey = 'seer' | 'medium' | 'guard'

type Participant = {
  id: string
  name: string
  score: number
  note: string
}

type RoleTrack = {
  id: string
  playerId: string
  results: RoleResult[]
}

type DayRecord = {
  executedId: string
  bittenId: string
}

type RoleResult = {
  targetId: string
  result: string
}

type DayVotes = Record<string, string>
type RunoffRound = {
  candidateIds: string[]
  votes: DayVotes
}
type RunoffDay = {
  rounds: RunoffRound[]
}
type SelfRole = '人狼' | '狂人' | '占い師' | '霊媒師' | '騎士' | '村人'
type SavedBoardData = {
  version: 1 | 2
  participants: Participant[]
  days: DayRecord[]
  roleTracks: Record<RoleKey, RoleTrack[]>
  votesByDay: DayVotes[]
  runoffByDay: (RunoffDay | null)[]
  activeVoteDayIndex: number
  freeMemo: string
  streamComment?: string
}

const ROLE_KEYS: RoleKey[] = ['seer', 'medium', 'guard']
const RESULT_VALUES = new Set(['白', '黒', '結果なし'])
const SELF_ROLE_OPTIONS: SelfRole[] = ['人狼', '狂人', '占い師', '霊媒師', '騎士', '村人']

const ROLE_LABELS: Record<RoleKey, string> = {
  seer: '占い師',
  medium: '霊媒師',
  guard: '騎士',
}

const COLOR_MODE_STORAGE_KEY = 'werewolf-board-color-mode'
const APP_TITLE = 'JINRO MEMO'
const HELP_ITEMS = [
  '参加者を追加し、盤面整理表で吊り・噛み・役職結果を入力します。',
  '投票記録では投票者を選んでから投票先をクリックして記録します。',
  '配信用コメントとフリーメモは配信補助やメモ書きとして自由に使えます。',
]

const createDayRecord = (): DayRecord => ({
  executedId: '',
  bittenId: '',
})

const createRoleResult = (): RoleResult => ({
  targetId: '',
  result: '結果なし',
})

const createRoleTrack = (dayCount: number): RoleTrack => ({
  id: crypto.randomUUID(),
  playerId: '',
  results: Array.from({ length: dayCount }, () => createRoleResult()),
})

const createInitialRoleTracks = (dayCount: number): Record<RoleKey, RoleTrack[]> => ({
  seer: [createRoleTrack(dayCount)],
  medium: [createRoleTrack(dayCount)],
  guard: [createRoleTrack(dayCount)],
})

const normalizeVisibleDays = (source: DayRecord[]): DayRecord[] => {
  let lastNonEmptyDayIndex = -1

  source.forEach((day, index) => {
    if (day.executedId !== '' || day.bittenId !== '') {
      lastNonEmptyDayIndex = index
    }
  })

  const requiredDayCount = Math.max(2, lastNonEmptyDayIndex + 2)
  const trimmed = source.slice(0, requiredDayCount)

  if (trimmed.length < requiredDayCount) {
    trimmed.push(...Array.from({ length: requiredDayCount - trimmed.length }, () => createDayRecord()))
  }

  return trimmed
}

const normalizeTextNames = (text: string): string[] =>
  text
    .split(/[\r\n]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

const normalizeTracks = (tracks: RoleTrack[], dayCount: number): RoleTrack[] => {
  return tracks.map((track) => {
    const results = [...track.results]

    if (results.length < dayCount) {
      results.push(...Array.from({ length: dayCount - results.length }, () => createRoleResult()))
    }

    if (results.length > dayCount) {
      results.splice(dayCount)
    }

    return {
      ...track,
      results,
    }
  })
}

const pruneDaysByValidIds = (source: DayRecord[], validIds: Set<string>): DayRecord[] =>
  source.map((day) => ({
    ...day,
    executedId: validIds.has(day.executedId) ? day.executedId : '',
    bittenId: validIds.has(day.bittenId) ? day.bittenId : '',
  }))

const pruneTracksByValidIds = (
  source: Record<RoleKey, RoleTrack[]>,
  validIds: Set<string>,
  dayCount: number,
): Record<RoleKey, RoleTrack[]> => ({
  seer: normalizeTracks(
    source.seer.map((track) => ({
      ...track,
      playerId: validIds.has(track.playerId) ? track.playerId : '',
      results: track.results.map((result) => ({
        ...result,
        targetId: validIds.has(result.targetId) ? result.targetId : '',
      })),
    })),
    dayCount,
  ),
  medium: normalizeTracks(
    source.medium.map((track) => ({
      ...track,
      playerId: validIds.has(track.playerId) ? track.playerId : '',
      results: track.results.map((result) => ({
        ...result,
        targetId: validIds.has(result.targetId) ? result.targetId : '',
      })),
    })),
    dayCount,
  ),
  guard: normalizeTracks(
    source.guard.map((track) => ({
      ...track,
      playerId: validIds.has(track.playerId) ? track.playerId : '',
      results: track.results.map((result) => ({
        ...result,
        targetId: validIds.has(result.targetId) ? result.targetId : '',
      })),
    })),
    dayCount,
  ),
})

const applyMediumTargets = (
  source: Record<RoleKey, RoleTrack[]>,
  days: DayRecord[],
): Record<RoleKey, RoleTrack[]> => ({
  ...source,
  medium: source.medium.map((track) => ({
    ...track,
    results: track.results.map((result, dayIndex) => ({
      ...result,
      targetId: dayIndex === 0 ? '' : (days[dayIndex - 1]?.executedId ?? ''),
    })),
  })),
})

const normalizeVotesByDay = (source: DayVotes[], dayCount: number): DayVotes[] => {
  const next = source.slice(0, dayCount).map((votes) => ({ ...votes }))
  while (next.length < dayCount) {
    next.push({})
  }
  return next
}

const pruneVotesByValidIds = (votes: DayVotes, validIds: Set<string>): DayVotes =>
  Object.fromEntries(
    Object.entries(votes).filter(([fromId, toId]) => validIds.has(fromId) && validIds.has(toId)),
  )

const normalizeRunoffByDay = (source: (RunoffDay | null)[], dayCount: number): (RunoffDay | null)[] => {
  const next = source.slice(0, dayCount).map((runoff) =>
    runoff
      ? {
          rounds: runoff.rounds.map((round) => ({
            candidateIds: [...round.candidateIds],
            votes: { ...round.votes },
          })),
        }
      : null,
  )
  while (next.length < dayCount) {
    next.push(null)
  }
  return next
}

const pruneRunoffByValidIds = (
  runoff: RunoffDay | null,
  validIds: Set<string>,
): RunoffDay | null => {
  if (!runoff) {
    return null
  }
  const rounds = runoff.rounds
    .map((round) => {
      const candidateIds = round.candidateIds.filter((id) => validIds.has(id))
      if (candidateIds.length < 2) {
        return null
      }
      const candidateSet = new Set(candidateIds)
      const votes = Object.fromEntries(
        Object.entries(round.votes).filter(([fromId, toId]) => validIds.has(fromId) && candidateSet.has(toId)),
      )
      return { candidateIds, votes }
    })
    .filter((round): round is RunoffRound => round !== null)
  if (rounds.length === 0) {
    return null
  }
  return { rounds }
}

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const areVoteMapsEqual = (left: DayVotes, right: DayVotes): boolean => {
  const leftEntries = Object.entries(left)
  if (leftEntries.length !== Object.keys(right).length) {
    return false
  }
  return leftEntries.every(([fromId, toId]) => right[fromId] === toId)
}

const areRunoffRoundsEqual = (left: RunoffRound[], right: RunoffRound[]): boolean =>
  left.length === right.length &&
  left.every(
    (round, index) =>
      areStringArraysEqual(round.candidateIds, right[index]?.candidateIds ?? []) &&
      areVoteMapsEqual(round.votes, right[index]?.votes ?? {}),
  )

const clampParticipantScore = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(10, Math.round(value)))
}

const isPlayerDeadBeforeDay = (days: DayRecord[], playerId: string, dayIndex: number): boolean => {
  if (!playerId) {
    return false
  }
  for (let i = 0; i < dayIndex; i += 1) {
    const day = days[i]
    if (!day) {
      continue
    }
    if (day.executedId === playerId || day.bittenId === playerId) {
      return true
    }
  }
  return false
}

const getTodayLocalDateString = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const toObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null

const normalizeImportedParticipants = (source: unknown): Participant[] => {
  if (!Array.isArray(source)) {
    return []
  }
  return source
    .map((item) => {
      const obj = toObject(item)
      if (!obj) {
        return null
      }
      const id = typeof obj.id === 'string' && obj.id ? obj.id : crypto.randomUUID()
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : '名前未設定'
      const score = clampParticipantScore(Number(obj.score))
      const note = typeof obj.note === 'string' ? obj.note : ''
      return { id, name, score, note }
    })
    .filter((item): item is Participant => item !== null)
}

const normalizeImportedDays = (source: unknown): DayRecord[] => {
  if (!Array.isArray(source)) {
    return [createDayRecord(), createDayRecord()]
  }
  const mapped = source.map((item) => {
    const obj = toObject(item)
    return {
      executedId: typeof obj?.executedId === 'string' ? obj.executedId : '',
      bittenId: typeof obj?.bittenId === 'string' ? obj.bittenId : '',
    }
  })
  return normalizeVisibleDays(mapped)
}

const normalizeImportedTracks = (source: unknown, dayCount: number): Record<RoleKey, RoleTrack[]> => {
  const roleTracksObject = toObject(source)
  const normalizeRole = (role: RoleKey): RoleTrack[] => {
    const raw = roleTracksObject?.[role]
    if (!Array.isArray(raw)) {
      return [createRoleTrack(dayCount)]
    }
    const tracks = raw
      .map((item) => {
        const obj = toObject(item)
        if (!obj) {
          return null
        }
        const results = Array.isArray(obj.results)
          ? obj.results.map((resultItem) => {
              const resultObj = toObject(resultItem)
              const targetId = typeof resultObj?.targetId === 'string' ? resultObj.targetId : ''
              const resultValue = typeof resultObj?.result === 'string' && RESULT_VALUES.has(resultObj.result)
                ? resultObj.result
                : '結果なし'
              return {
                targetId,
                result: resultValue,
              }
            })
          : []
        return {
          id: typeof obj.id === 'string' && obj.id ? obj.id : crypto.randomUUID(),
          playerId: typeof obj.playerId === 'string' ? obj.playerId : '',
          results,
        }
      })
      .filter((item): item is RoleTrack => item !== null)
    if (tracks.length === 0) {
      return [createRoleTrack(dayCount)]
    }
    return normalizeTracks(tracks, dayCount)
  }

  return {
    seer: normalizeRole('seer'),
    medium: normalizeRole('medium'),
    guard: normalizeRole('guard'),
  }
}

const normalizeImportedVotesByDay = (source: unknown, dayCount: number): DayVotes[] => {
  if (!Array.isArray(source)) {
    return normalizeVotesByDay([], dayCount)
  }
  const mapped = source.map((item) => {
    const obj = toObject(item)
    if (!obj) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, toId]) => typeof toId === 'string')
        .map(([fromId, toId]) => [fromId, toId as string]),
    )
  })
  return normalizeVotesByDay(mapped, dayCount)
}

const normalizeImportedRunoffByDay = (source: unknown, dayCount: number): (RunoffDay | null)[] => {
  if (!Array.isArray(source)) {
    return normalizeRunoffByDay([], dayCount)
  }
  const mapped = source.map((item) => {
    if (item === null) {
      return null
    }
    const obj = toObject(item)
    if (!obj) {
      return null
    }
    const roundsRaw = Array.isArray(obj.rounds) ? obj.rounds : [obj]
    const rounds = roundsRaw
      .map((roundItem) => {
        const roundObj = toObject(roundItem)
        if (!roundObj) {
          return null
        }
        const candidateIds = Array.isArray(roundObj.candidateIds)
          ? roundObj.candidateIds.filter((id): id is string => typeof id === 'string')
          : []
        const votesObj = toObject(roundObj.votes)
        const votes = votesObj
          ? Object.fromEntries(
              Object.entries(votesObj)
                .filter(([, toId]) => typeof toId === 'string')
                .map(([fromId, toId]) => [fromId, toId as string]),
            )
          : {}
        if (candidateIds.length < 2) {
          return null
        }
        return { candidateIds, votes }
      })
      .filter((round): round is RunoffRound => round !== null)
    if (rounds.length === 0) {
      return null
    }
    return { rounds }
  })
  return normalizeRunoffByDay(mapped, dayCount)
}

function App() {
  const initialDayCount = 2
  const [participants, setParticipants] = useState<Participant[]>([])
  const [days, setDays] = useState<DayRecord[]>([
    createDayRecord(),
    createDayRecord(),
  ])
  const [roleTracks, setRoleTracks] = useState<Record<RoleKey, RoleTrack[]>>(
    createInitialRoleTracks(initialDayCount),
  )
  const [votesByDay, setVotesByDay] = useState<DayVotes[]>(() =>
    Array.from({ length: initialDayCount }, () => ({})),
  )
  const [runoffByDay, setRunoffByDay] = useState<(RunoffDay | null)[]>(() =>
    Array.from({ length: initialDayCount }, () => null),
  )
  const [activeVoteDayIndex, setActiveVoteDayIndex] = useState(0)
  const [draggingFromId, setDraggingFromId] = useState<string | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  const [isRunoffPopupOpen, setIsRunoffPopupOpen] = useState(false)
  const [activeRunoffRoundIndex, setActiveRunoffRoundIndex] = useState(0)

  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [selfRole, setSelfRole] = useState<SelfRole>('村人')
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [exportResult, setExportResult] = useState<'○' | '●'>('○')
  const [exportDate, setExportDate] = useState(getTodayLocalDateString())
  const [exportMatchNumber, setExportMatchNumber] = useState(1)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingScore, setEditingScore] = useState(5)
  const [editingNote, setEditingNote] = useState('')
  const [isEditDeleteVisible, setIsEditDeleteVisible] = useState(true)
  const [streamComment, setStreamComment] = useState('')
  const [freeMemo, setFreeMemo] = useState('')
  const [openResultPickerKey, setOpenResultPickerKey] = useState<string | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }
    return window.localStorage.getItem(COLOR_MODE_STORAGE_KEY) === 'dark'
  })

  const voteLinkBoardRef = useRef<HTMLDivElement | null>(null)
  const fromDotRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const toDotRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const importJsonInputRef = useRef<HTMLInputElement | null>(null)
  const streamWindowRef = useRef<Window | null>(null)
  const helpPopoverRef = useRef<HTMLDivElement | null>(null)

  const deadPlayerIds = useMemo(() => {
    const dead = new Set<string>()

    for (const day of days) {
      if (day.executedId) {
        dead.add(day.executedId)
      }
      if (day.bittenId) {
        dead.add(day.bittenId)
      }
    }

    return dead
  }, [days])

  const participantNameMap = useMemo(
    () => new Map(participants.map((player) => [player.id, player.name])),
    [participants],
  )

  const streamDaySummaries = useMemo<StreamDaySummary[]>(() => {
    const roleResultsByDay = new Map<number, StreamRoleResultItem[]>()

    ROLE_KEYS.forEach((role) => {
      roleTracks[role].forEach((track) => {
        const actorName = participantNameMap.get(track.playerId) ?? ''
        if (!actorName) {
          return
        }

        track.results.forEach((result, dayIndex) => {
          if (role === 'medium' && isPlayerDeadBeforeDay(days, track.playerId, dayIndex)) {
            return
          }

          const targetName = participantNameMap.get(result.targetId) ?? ''
          const resultMark =
            result.result === '白' ? '○' : result.result === '黒' ? '●' : ''
          const resultText =
            result.result === '結果なし'
              ? ''
              : `${result.result}${targetName ? ` (${targetName})` : ''}`

          if (!targetName && !resultMark && !resultText) {
            return
          }

          const items = roleResultsByDay.get(dayIndex) ?? []
          items.push({
            id: `${role}-${track.id}-${dayIndex}`,
            roleLabel: ROLE_LABELS[role],
            actorName,
            targetName,
            resultMark,
            resultText,
          })
          roleResultsByDay.set(dayIndex, items)
        })
      })
    })

    return days
      .map((day, dayIndex) => ({
        dayNumber: dayIndex + 1,
        executedName: participantNameMap.get(day.executedId) ?? '',
        bittenName: participantNameMap.get(day.bittenId) ?? '',
        roleResults: roleResultsByDay.get(dayIndex) ?? [],
      }))
      .filter((summary) =>
        summary.executedName !== '' ||
        summary.bittenName !== '' ||
        summary.roleResults.length > 0,
      )
  }, [days, participantNameMap, roleTracks])

  const streamOverlayPayload = useMemo<StreamOverlayPayload>(
    () => ({
      updatedAt: new Date().toISOString(),
      activeDayNumber: activeVoteDayIndex + 1,
      latestDayNumber: streamDaySummaries.at(-1)?.dayNumber ?? activeVoteDayIndex + 1,
      daySummaries: streamDaySummaries,
      roleActorsByLabel: {
        占い師: roleTracks.seer
          .map((track) => participantNameMap.get(track.playerId) ?? '')
          .filter((name) => name !== ''),
        霊媒師: roleTracks.medium
          .map((track) => participantNameMap.get(track.playerId) ?? '')
          .filter((name) => name !== ''),
        騎士: roleTracks.guard
          .map((track) => participantNameMap.get(track.playerId) ?? '')
          .filter((name) => name !== ''),
      },
      comment: streamComment,
    }),
    [activeVoteDayIndex, participantNameMap, roleTracks, streamComment, streamDaySummaries],
  )

  useEffect(() => {
    setVotesByDay((prev) => normalizeVotesByDay(prev, days.length))
    setRunoffByDay((prev) => normalizeRunoffByDay(prev, days.length))
    setActiveVoteDayIndex((prev) => Math.min(prev, days.length - 1))
  }, [days.length])

  useEffect(() => {
    const validIds = new Set(participants.map((player) => player.id))
    setVotesByDay((prev) => prev.map((votes) => pruneVotesByValidIds(votes, validIds)))
    setRunoffByDay((prev) => prev.map((runoff) => pruneRunoffByValidIds(runoff, validIds)))
  }, [participants])

  useEffect(() => {
    const updateLayout = (): void => setLayoutTick((prev) => prev + 1)
    updateLayout()
    window.addEventListener('resize', updateLayout)
    window.addEventListener('scroll', updateLayout, true)
    return () => {
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('scroll', updateLayout, true)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      STREAM_OVERLAY_STORAGE_KEY,
      JSON.stringify(streamOverlayPayload),
    )
  }, [streamOverlayPayload])

  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode)
    window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, isDarkMode ? 'dark' : 'light')
  }, [isDarkMode])

  useEffect(() => {
    if (!isHelpOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (!helpPopoverRef.current?.contains(event.target as Node)) {
        setIsHelpOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isHelpOpen])

  const addParticipant = (): void => {
    setParticipants((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: `参加者${prev.length + 1}`, score: 5, note: '' },
    ])
  }

  const addParticipantsFromText = (): void => {
    const names = normalizeTextNames(importText)
    if (names.length === 0) {
      window.alert('取り込める名前がありません。')
      return
    }

    setParticipants((prev) => [
      ...prev,
      ...names.map((name) => ({ id: crypto.randomUUID(), name, score: 5, note: '' })),
    ])
    setImportText('')
    setIsImportOpen(false)
  }

  const buildExportFileName = (): string => {
    const matchNumber = Math.max(1, Math.floor(Number(exportMatchNumber) || 1))
    const date = exportDate || getTodayLocalDateString()
    return `${date}_${matchNumber}戦目_${exportResult}${selfRole}.json`
  }

  const openExportPopup = (): void => {
    setExportDate(getTodayLocalDateString())
    setIsExportOpen(true)
  }

  const downloadJson = (): void => {
    const payload: SavedBoardData = {
      version: 2,
      participants,
      days,
      roleTracks,
      votesByDay,
      runoffByDay,
      activeVoteDayIndex,
      freeMemo,
      streamComment,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = buildExportFileName()
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setIsExportOpen(false)
  }

  const applyImportedJson = (raw: unknown): void => {
    const root = toObject(raw)
    if (!root) {
      throw new Error('invalid-json-root')
    }

    const nextParticipants = normalizeImportedParticipants(root.participants)
    const validIds = new Set(nextParticipants.map((player) => player.id))
    const nextDays = pruneDaysByValidIds(normalizeImportedDays(root.days), validIds)
    const nextRoleTracks = applyMediumTargets(
      pruneTracksByValidIds(
        normalizeImportedTracks(root.roleTracks, nextDays.length),
        validIds,
        nextDays.length,
      ),
      nextDays,
    )
    const nextVotesByDay = normalizeImportedVotesByDay(root.votesByDay, nextDays.length)
      .map((votes) => pruneVotesByValidIds(votes, validIds))
    const nextRunoffByDay = normalizeImportedRunoffByDay(root.runoffByDay, nextDays.length)
      .map((runoff) => pruneRunoffByValidIds(runoff, validIds))
    const parsedDayIndex = Number(root.activeVoteDayIndex)
    const nextActiveVoteDayIndex = Number.isFinite(parsedDayIndex)
      ? Math.min(Math.max(0, Math.floor(parsedDayIndex)), Math.max(0, nextDays.length - 1))
      : 0
    const nextFreeMemo = typeof root.freeMemo === 'string' ? root.freeMemo : ''
    const nextStreamComment = typeof root.streamComment === 'string' ? root.streamComment : ''

    setParticipants(nextParticipants)
    setDays(nextDays)
    setRoleTracks(nextRoleTracks)
    setVotesByDay(nextVotesByDay)
    setRunoffByDay(nextRunoffByDay)
    setActiveVoteDayIndex(nextActiveVoteDayIndex)
    setFreeMemo(nextFreeMemo)
    setStreamComment(nextStreamComment)
    setOpenResultPickerKey(null)
    setIsImportOpen(false)
    closeEditPopupWithoutSaving()
    setIsRunoffPopupOpen(false)
    setActiveRunoffRoundIndex(0)
    setDraggingFromId(null)
  }

  const uploadJson = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      applyImportedJson(parsed)
    } catch {
      window.alert('JSONの読み込みに失敗しました。ファイル形式を確認してください。')
    }
  }

  const closeEditPopup = (): void => {
    if (editingId) {
      setParticipants((prev) =>
        prev.map((player) =>
          player.id === editingId
            ? {
                ...player,
                name: editingName.trim() || '名前未設定',
                score: clampParticipantScore(editingScore),
                note: editingNote,
              }
            : player,
        ),
      )
    }
    setEditingId(null)
    setEditingName('')
    setEditingScore(5)
    setEditingNote('')
    setIsEditDeleteVisible(true)
  }

  const closeEditPopupWithoutSaving = (): void => {
    setEditingId(null)
    setEditingName('')
    setEditingScore(5)
    setEditingNote('')
    setIsEditDeleteVisible(true)
  }

  const openEditPopup = (id: string, showDeleteButton = true): void => {
    const target = participants.find((player) => player.id === id)
    if (!target) {
      return
    }

    setEditingId(id)
    setEditingName(target.name)
    setEditingScore(clampParticipantScore(target.score))
    setEditingNote(target.note)
    setIsEditDeleteVisible(showDeleteButton)
  }

  const deleteParticipant = (): void => {
    if (!editingId) {
      return
    }

    const nextParticipants = participants.filter((player) => player.id !== editingId)
    const validIds = new Set(nextParticipants.map((player) => player.id))
    const nextDays = normalizeVisibleDays(pruneDaysByValidIds(days, validIds))

    setParticipants(nextParticipants)
    setDays(nextDays)
    setRoleTracks((prev) =>
      applyMediumTargets(
        pruneTracksByValidIds(prev, validIds, nextDays.length),
        nextDays,
      ),
    )
    setVotesByDay((prev) =>
      normalizeVotesByDay(prev, nextDays.length).map((votes) => pruneVotesByValidIds(votes, validIds)),
    )
    closeEditPopupWithoutSaving()
  }

  const updateDaySelect = (
    dayIndex: number,
    key: keyof DayRecord,
    value: string,
  ): void => {
    setDays((prev) => {
      const updatedDays = prev.map((day, index) =>
        index === dayIndex
          ? {
              ...day,
              [key]: value,
            }
          : day,
      )
      const nextDays = normalizeVisibleDays(updatedDays)

      setRoleTracks((prevRoleTracks) => {
        const adjustedTracks = {
          seer: normalizeTracks(prevRoleTracks.seer, nextDays.length),
          medium: normalizeTracks(prevRoleTracks.medium, nextDays.length),
          guard: normalizeTracks(prevRoleTracks.guard, nextDays.length),
        }

        return applyMediumTargets(adjustedTracks, nextDays)
      })
      return nextDays
    })
  }

  const updateRoleCo = (
    role: RoleKey,
    trackIndex: number,
    playerId: string,
  ): void => {
    setRoleTracks((prev) => {
      const next = prev[role].map((track, currentTrackIndex) =>
        currentTrackIndex === trackIndex
          ? {
              ...track,
              playerId,
              results:
                playerId === ''
                  ? Array.from({ length: days.length }, () => createRoleResult())
                  : track.results,
            }
          : track,
      )

      return {
        ...prev,
        [role]: normalizeTracks(next, days.length),
      }
    })
  }

  const addRoleCo = (role: RoleKey): void => {
    setRoleTracks((prev) => ({
      ...prev,
      [role]: [...prev[role], createRoleTrack(days.length)],
    }))
  }

  const removeRoleCo = (role: RoleKey, trackId: string): void => {
    setRoleTracks((prev) => {
      const filtered = prev[role].filter((track) => track.id !== trackId)
      const nextTracks = filtered.length > 0 ? filtered : [createRoleTrack(days.length)]

      return {
        ...prev,
        [role]: nextTracks,
      }
    })
  }

  const updateRoleResult = (
    role: RoleKey,
    trackIndex: number,
    dayIndex: number,
    value: string,
  ): void => {
    setRoleTracks((prev) => ({
      ...prev,
      [role]: prev[role].map((track, currentTrackIndex) =>
        currentTrackIndex === trackIndex
          ? (role === 'seer' || role === 'medium') &&
            isPlayerDeadBeforeDay(days, track.playerId, dayIndex)
            ? track
            : {
                ...track,
                results: track.results.map((result, currentDayIndex) =>
                  currentDayIndex === dayIndex
                    ? {
                        ...result,
                        result: value,
                      }
                    : result,
                ),
              }
          : track,
      ),
    }))
  }

  const updateRoleTarget = (
    role: RoleKey,
    trackIndex: number,
    dayIndex: number,
    targetId: string,
  ): void => {
    if (role === 'medium') {
      return
    }

    setRoleTracks((prev) => ({
      ...prev,
      [role]: prev[role].map((track, currentTrackIndex) =>
        currentTrackIndex === trackIndex
          ? role === 'seer' && isPlayerDeadBeforeDay(days, track.playerId, dayIndex)
            ? track
            : {
                ...track,
                results: track.results.map((result, currentDayIndex) =>
                  currentDayIndex === dayIndex
                    ? {
                        ...result,
                        targetId,
                      }
                    : result,
                ),
              }
          : track,
      ),
    }))
  }

  const getResultMark = (value: string): string => {
    if (value === '白') {
      return '○'
    }
    if (value === '黒') {
      return '●'
    }
    return ''
  }

  const getAlivePlayerIdsAtDay = (dayIndex: number): Set<string> => {
    const deadIds = new Set<string>()
    for (let i = 0; i < dayIndex; i += 1) {
      const day = days[i]
      if (!day) {
        continue
      }
      if (day.executedId) {
        deadIds.add(day.executedId)
      }
      if (day.bittenId) {
        deadIds.add(day.bittenId)
      }
    }
    return new Set(
      participants.filter((player) => !deadIds.has(player.id)).map((player) => player.id),
    )
  }

  const getVoteCounts = (votes: DayVotes): Record<string, number> => {
    const counts: Record<string, number> = {}
    Object.values(votes).forEach((toId) => {
      counts[toId] = (counts[toId] ?? 0) + 1
    })
    return counts
  }

  const getTopCandidateIds = (candidateIds: string[], votes: DayVotes): string[] => {
    if (candidateIds.length === 0) {
      return []
    }
    const counts = getVoteCounts(votes)
    const maxCount = Math.max(0, ...candidateIds.map((id) => counts[id] ?? 0))
    if (maxCount === 0) {
      return []
    }
    return candidateIds.filter((id) => (counts[id] ?? 0) === maxCount)
  }

  const getRunoffVoterIds = (aliveIds: Set<string>, candidateIds: string[]): string[] => {
    const candidateSet = new Set(candidateIds)
    return [...aliveIds].filter((id) => !candidateSet.has(id))
  }

  const aliveIdsOnActiveVoteDay = useMemo(
    () => getAlivePlayerIdsAtDay(activeVoteDayIndex),
    [activeVoteDayIndex, days, participants],
  )

  const alivePlayersOnActiveVoteDay = useMemo(
    () => participants.filter((player) => aliveIdsOnActiveVoteDay.has(player.id)),
    [participants, aliveIdsOnActiveVoteDay],
  )

  const currentDayVotes = useMemo(
    () => pruneVotesByValidIds(votesByDay[activeVoteDayIndex] ?? {}, aliveIdsOnActiveVoteDay),
    [votesByDay, activeVoteDayIndex, aliveIdsOnActiveVoteDay],
  )

  const voteRows = useMemo(() => {
    const runningCounts: Record<string, number> = {}
    return Object.entries(currentDayVotes).map(([fromId, toId]) => {
      runningCounts[toId] = (runningCounts[toId] ?? 0) + 1
      return {
        fromId,
        toId,
        countAtThatPoint: runningCounts[toId],
      }
    })
  }, [currentDayVotes])

  const firstVoteCounts = useMemo(() => getVoteCounts(currentDayVotes), [currentDayVotes])

  const hasAllAliveVoted = useMemo(
    () =>
      alivePlayersOnActiveVoteDay.length > 0 &&
      alivePlayersOnActiveVoteDay.every((player) => currentDayVotes[player.id] !== undefined),
    [alivePlayersOnActiveVoteDay, currentDayVotes],
  )

  const tiedTopCandidateIds = useMemo(() => {
    if (!hasAllAliveVoted) {
      return [] as string[]
    }
    const maxCount = Math.max(0, ...Object.values(firstVoteCounts))
    if (maxCount === 0) {
      return [] as string[]
    }
    return alivePlayersOnActiveVoteDay
      .filter((player) => (firstVoteCounts[player.id] ?? 0) === maxCount)
      .map((player) => player.id)
  }, [hasAllAliveVoted, firstVoteCounts, alivePlayersOnActiveVoteDay])

  const needsFirstRunoff = tiedTopCandidateIds.length >= 2
  const tiedTopCandidateKey = tiedTopCandidateIds.join('|')

  const firstRunoffVoterIdsForActiveDay = useMemo(
    () => getRunoffVoterIds(aliveIdsOnActiveVoteDay, tiedTopCandidateIds),
    [aliveIdsOnActiveVoteDay, tiedTopCandidateIds],
  )

  const firstRunoffVoterKey = firstRunoffVoterIdsForActiveDay.join('|')

  const activeRunoffDay = runoffByDay[activeVoteDayIndex] ?? null
  const firstRunoffRound = activeRunoffDay?.rounds[0] ?? null
  const secondRunoffRound = activeRunoffDay?.rounds[1] ?? null
  const firstRunoffCandidateIds = firstRunoffRound?.candidateIds ?? tiedTopCandidateIds
  const firstRunoffVotes = firstRunoffRound?.votes ?? {}

  const firstRunoffCandidatesOnActiveDay = useMemo(() => {
    const candidateSet = new Set(firstRunoffCandidateIds)
    return participants.filter((player) => candidateSet.has(player.id))
  }, [participants, firstRunoffCandidateIds])

  const firstRunoffVotersOnActiveDay = useMemo(() => {
    const voterSet = new Set(firstRunoffVoterIdsForActiveDay)
    return participants.filter((player) => voterSet.has(player.id))
  }, [participants, firstRunoffVoterIdsForActiveDay])

  const isFirstRunoffComplete = useMemo(
    () => firstRunoffVoterIdsForActiveDay.every((fromId) => firstRunoffVotes[fromId] !== undefined),
    [firstRunoffVoterIdsForActiveDay, firstRunoffVotes],
  )

  const tiedTopCandidateIdsAfterFirstRunoff = useMemo(() => {
    if (!isFirstRunoffComplete) {
      return [] as string[]
    }
    return getTopCandidateIds(firstRunoffCandidateIds, firstRunoffVotes)
  }, [isFirstRunoffComplete, firstRunoffCandidateIds, firstRunoffVotes])

  const needsSecondRunoff = tiedTopCandidateIdsAfterFirstRunoff.length >= 2

  const secondRunoffVoterIdsForActiveDay = useMemo(
    () => getRunoffVoterIds(aliveIdsOnActiveVoteDay, tiedTopCandidateIdsAfterFirstRunoff),
    [aliveIdsOnActiveVoteDay, tiedTopCandidateIdsAfterFirstRunoff],
  )

  const secondRunoffVotes = secondRunoffRound?.votes ?? {}

  const secondRunoffCandidatesOnActiveDay = useMemo(() => {
    const candidateSet = new Set(tiedTopCandidateIdsAfterFirstRunoff)
    return participants.filter((player) => candidateSet.has(player.id))
  }, [participants, tiedTopCandidateIdsAfterFirstRunoff])

  const secondRunoffVotersOnActiveDay = useMemo(() => {
    const voterSet = new Set(secondRunoffVoterIdsForActiveDay)
    return participants.filter((player) => voterSet.has(player.id))
  }, [participants, secondRunoffVoterIdsForActiveDay])

  const isSecondRunoffComplete = useMemo(
    () => secondRunoffVoterIdsForActiveDay.every((fromId) => secondRunoffVotes[fromId] !== undefined),
    [secondRunoffVoterIdsForActiveDay, secondRunoffVotes],
  )

  const isRunoffFullyComplete = isFirstRunoffComplete && (!needsSecondRunoff || isSecondRunoffComplete)

  useEffect(() => {
    setRunoffByDay((prev) => {
      const normalized = normalizeRunoffByDay(prev, days.length)
      const currentRunoff = normalized[activeVoteDayIndex] ?? null

      if (!needsFirstRunoff) {
        if (currentRunoff === null) {
          return prev
        }
        normalized[activeVoteDayIndex] = null
        return normalized
      }

      const firstRound = currentRunoff?.rounds[0]
      const firstRoundCandidateIds = [...tiedTopCandidateIds]
      const firstAllowedFromIds = new Set(firstRunoffVoterIdsForActiveDay)
      const firstAllowedToIds = new Set(firstRoundCandidateIds)
      const firstRoundVotes =
        firstRound && areStringArraysEqual(firstRound.candidateIds, firstRoundCandidateIds)
          ? Object.fromEntries(
              Object.entries(firstRound.votes).filter(
                ([fromId, toId]) => firstAllowedFromIds.has(fromId) && firstAllowedToIds.has(toId),
              ),
            )
          : {}

      const nextRounds: RunoffRound[] = [
        {
          candidateIds: firstRoundCandidateIds,
          votes: firstRoundVotes,
        },
      ]

      const firstRoundComplete = firstRunoffVoterIdsForActiveDay.every((fromId) => firstRoundVotes[fromId] !== undefined)
      if (firstRoundComplete) {
        const secondRoundCandidateIds = getTopCandidateIds(firstRoundCandidateIds, firstRoundVotes)
        if (secondRoundCandidateIds.length >= 2) {
          const secondRound = currentRunoff?.rounds[1]
          const secondAllowedFromIds = new Set(getRunoffVoterIds(aliveIdsOnActiveVoteDay, secondRoundCandidateIds))
          const secondAllowedToIds = new Set(secondRoundCandidateIds)
          const secondRoundVotes =
            secondRound && areStringArraysEqual(secondRound.candidateIds, secondRoundCandidateIds)
              ? Object.fromEntries(
                  Object.entries(secondRound.votes).filter(
                    ([fromId, toId]) => secondAllowedFromIds.has(fromId) && secondAllowedToIds.has(toId),
                  ),
                )
              : {}
          nextRounds.push({
            candidateIds: secondRoundCandidateIds,
            votes: secondRoundVotes,
          })
        }
      }

      if (currentRunoff && areRunoffRoundsEqual(currentRunoff.rounds, nextRounds)) {
        return prev
      }

      normalized[activeVoteDayIndex] = {
        rounds: nextRounds,
      }
      return normalized
    })

    if (!needsFirstRunoff) {
      setIsRunoffPopupOpen(false)
    }
  }, [
    needsFirstRunoff,
    tiedTopCandidateKey,
    firstRunoffVoterKey,
    firstRunoffVotes,
    activeVoteDayIndex,
    days.length,
    aliveIdsOnActiveVoteDay,
    firstRunoffVoterIdsForActiveDay,
  ])

  useEffect(() => {
    if (!needsSecondRunoff && activeRunoffRoundIndex > 0) {
      setActiveRunoffRoundIndex(0)
    }
  }, [needsSecondRunoff, activeRunoffRoundIndex])

  const updateRunoffVote = (roundIndex: 0 | 1, fromId: string, toId: string, checked: boolean): void => {
    setRunoffByDay((prev) => {
      const normalized = normalizeRunoffByDay(prev, days.length)
      const runoff = normalized[activeVoteDayIndex]
      if (!runoff) {
        return prev
      }
      const round = runoff.rounds[roundIndex]
      if (!round) {
        return prev
      }

      const nextVotes = { ...round.votes }
      if (!checked && round.votes[fromId] === toId) {
        delete nextVotes[fromId]
      } else if (checked) {
        nextVotes[fromId] = toId
      }

      if (areVoteMapsEqual(round.votes, nextVotes)) {
        return prev
      }

      const nextRounds = runoff.rounds.map((currentRound, index) =>
        index === roundIndex
          ? {
              candidateIds: currentRound.candidateIds,
              votes: nextVotes,
            }
          : currentRound,
      )
      normalized[activeVoteDayIndex] = {
        rounds: nextRounds,
      }
      return normalized
    })
  }

  const selectVoteFrom = (fromId: string): void => {
    if (!aliveIdsOnActiveVoteDay.has(fromId)) {
      return
    }
    setDraggingFromId((prev) => (prev === fromId ? null : fromId))
  }

  const selectVoteTarget = (toId: string): void => {
    if (
      !draggingFromId ||
      toId === draggingFromId ||
      !aliveIdsOnActiveVoteDay.has(draggingFromId) ||
      !aliveIdsOnActiveVoteDay.has(toId)
    ) {
      return
    }

    setVotesByDay((prev) =>
      prev.map((votes, dayIndex) =>
        dayIndex === activeVoteDayIndex ? { ...votes, [draggingFromId]: toId } : votes,
      ),
    )
    setDraggingFromId(null)
  }

  const cancelVote = (fromId: string): void => {
    setVotesByDay((prev) =>
      prev.map((votes, dayIndex) => {
        if (dayIndex !== activeVoteDayIndex || !(fromId in votes)) {
          return votes
        }
        const next = { ...votes }
        delete next[fromId]
        return next
      }),
    )
  }

  const voteLines = useMemo(() => {
    const board = voteLinkBoardRef.current
    if (!board) {
      return [] as { fromId: string; toId: string; x1: number; y1: number; x2: number; y2: number }[]
    }
    const boardRect = board.getBoundingClientRect()
    const lines: { fromId: string; toId: string; x1: number; y1: number; x2: number; y2: number }[] = []

    Object.entries(currentDayVotes).forEach(([fromId, toId]) => {
      const fromDot = fromDotRefs.current[fromId]
      const toDot = toDotRefs.current[toId]
      if (!fromDot || !toDot) {
        return
      }
      const fromRect = fromDot.getBoundingClientRect()
      const toRect = toDot.getBoundingClientRect()
      const fromCenterX = fromRect.left - boardRect.left + fromRect.width / 2
      const fromCenterY = fromRect.top - boardRect.top + fromRect.height / 2
      const toCenterX = toRect.left - boardRect.left + toRect.width / 2
      const toCenterY = toRect.top - boardRect.top + toRect.height / 2
      const deltaX = toCenterX - fromCenterX
      const deltaY = toCenterY - fromCenterY
      const distance = Math.hypot(deltaX, deltaY)
      if (distance === 0) {
        return
      }
      lines.push({
        fromId,
        toId,
        x1: fromCenterX,
        y1: fromCenterY,
        x2: toCenterX,
        y2: toCenterY,
      })
    })
    return lines
  }, [currentDayVotes, layoutTick, activeVoteDayIndex, participants])

  const openStreamWindow = (): void => {
    const url = new URL(window.location.href)
    url.searchParams.set(STREAM_WINDOW_QUERY_KEY, STREAM_WINDOW_QUERY_VALUE)

    const existingWindow = streamWindowRef.current
    if (existingWindow && !existingWindow.closed) {
      existingWindow.location.href = url.toString()
      existingWindow.focus()
      return
    }

    const nextWindow = window.open(
      url.toString(),
      'werewolf-board-stream-window',
      'popup=yes,width=1800,height=360',
    )

    if (!nextWindow) {
      window.alert('配信用ウィンドウを開けませんでした。ポップアップ設定を確認してください。')
      return
    }

    streamWindowRef.current = nextWindow
    nextWindow.focus()
  }

  return (
    <main className="app">
      <header className="app-header">
        <div className="header-help" ref={helpPopoverRef}>
          <button
            type="button"
            className="header-icon-button"
            aria-label="使い方を表示"
            aria-expanded={isHelpOpen}
            onClick={() => setIsHelpOpen((prev) => !prev)}
          >
            ?
          </button>
          {isHelpOpen && (
            <div className="help-popover">
              <h2>使い方</h2>
              <ul>
                {HELP_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="header-brand">
          <div className="brand-icon" aria-hidden="true">
            <img src={jinroIcon} alt="" />
          </div>
          <div className="brand-text">
            <strong>{APP_TITLE}</strong>
            <span>人狼盤面・投票メモ</span>
          </div>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="mini-action-btn"
            onClick={openStreamWindow}
          >
            配信用ウィンドウ
          </button>
          <button
            type="button"
            className="mini-action-btn"
            onClick={() => importJsonInputRef.current?.click()}
          >
            読み込み
          </button>
          <button
            type="button"
            className="mini-action-btn"
            onClick={openExportPopup}
          >
            保存
          </button>
          <button
            type="button"
            className="theme-toggle"
            aria-label={isDarkMode ? 'ライトモードに切り替え' : 'ナイトモードに切り替え'}
            onClick={() => setIsDarkMode((prev) => !prev)}
          >
            <span className={`theme-toggle-icon sun ${isDarkMode ? 'is-hidden' : ''}`}>☀</span>
            <span className={`theme-toggle-icon moon ${isDarkMode ? '' : 'is-hidden'}`}>☾</span>
          </button>
          <input
            ref={importJsonInputRef}
            type="file"
            accept="application/json,.json"
            onChange={uploadJson}
            className="hidden-file-input"
          />
        </div>
      </header>

      <div className="app-layout">
      <aside className="sidebar">
        <h2>参加者</h2>
        <ul className="participant-list">
          {participants.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                className={`name-button ${deadPlayerIds.has(player.id) ? 'is-dead' : ''}`}
                onClick={() => openEditPopup(player.id)}
              >
                {player.name}
              </button>
            </li>
          ))}
        </ul>

        <div className="sidebar-actions">
          <button type="button" className="btn btn--primary" onClick={addParticipant}>
            参加者の追加
          </button>
          <button type="button" className="btn" onClick={() => setIsImportOpen(true)}>
            テキストから取り込む
          </button>
        </div>
      </aside>

      <div className="content-column">
      <section className="board">
        <div className="board-header">
          <h1>盤面整理表</h1>
          <div className="self-role-selector">
            <label htmlFor="self-role-select">自分の役職</label>
            <select
              id="self-role-select"
              value={selfRole}
              onChange={(event) => setSelfRole(event.target.value as SelfRole)}
            >
              {SELF_ROLE_OPTIONS.map((role) => (
                <option key={`self-role-${role}`} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th></th>
                {days.map((_, index) => (
                  <th key={`day-${index}`}>{index + 1}日目</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>吊り</th>
                <td className="placeholder-cell">-</td>
                {days.map((day, dayIndex) => (
                  <td key={`executed-${dayIndex}`}>
                    <select
                      value={day.executedId}
                      onChange={(event) =>
                        updateDaySelect(dayIndex, 'executedId', event.target.value)
                      }
                    >
                      <option value="">なし</option>
                      {participants.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>

              <tr>
                <th>噛み</th>
                <td className="placeholder-cell">-</td>
                {days.map((day, dayIndex) => (
                  <td key={`bitten-${dayIndex}`}>
                    <select
                      value={day.bittenId}
                      onChange={(event) =>
                        updateDaySelect(dayIndex, 'bittenId', event.target.value)
                      }
                    >
                      <option value="">なし</option>
                      {participants.map((player) => (
                        <option key={player.id} value={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>

              <tr className="spacer-row">
                <th colSpan={days.length + 2} aria-hidden="true">
                  &nbsp;
                </th>
              </tr>

              {ROLE_KEYS.flatMap((role) =>
                roleTracks[role].map((track, trackIndex) => (
                  <tr key={`${role}-${track.id}`}>
                    <th>
                      {trackIndex === 0 ? (
                        <div className="role-header-main">
                          <span>{ROLE_LABELS[role]}</span>
                          <button
                            type="button"
                            className="btn co-add-btn"
                            onClick={() => addRoleCo(role)}
                          >
                            COを追加
                          </button>
                        </div>
                      ) : (
                        <div className="role-header-main">
                          <span>{`${ROLE_LABELS[role]} ${trackIndex + 1}`}</span>
                        </div>
                      )}
                    </th>
                    <td>
                      <div className="role-co-cell">
                        <select
                          value={track.playerId}
                          onChange={(event) =>
                            updateRoleCo(role, trackIndex, event.target.value)
                          }
                        >
                          <option value="">COなし</option>
                          {participants.map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="co-delete-box"
                          aria-label="COを削除"
                          onClick={() => removeRoleCo(role, track.id)}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                    {days.map((_, dayIndex) => (
                      <td key={`${role}-${track.id}-${dayIndex}`}>
                        {(() => {
                          const isRoleResultInputDisabled =
                            (role === 'seer' || role === 'medium') &&
                            isPlayerDeadBeforeDay(days, track.playerId, dayIndex)
                          return (
                        <div className="role-cell">
                          <select
                            value={
                              role === 'medium'
                                ? dayIndex === 0
                                  ? ''
                                  : (days[dayIndex - 1]?.executedId ?? '')
                                : (track.results[dayIndex]?.targetId ?? '')
                            }
                            disabled={role === 'medium' || isRoleResultInputDisabled}
                            onChange={(event) =>
                              updateRoleTarget(
                                role,
                                trackIndex,
                                dayIndex,
                                event.target.value,
                              )
                            }
                          >
                            <option value="">未選択</option>
                            {participants.map((player) => (
                              <option key={player.id} value={player.id}>
                                {player.name}
                              </option>
                            ))}
                          </select>
                          {role !== 'guard' && (
                            <div className="result-picker">
                              <button
                                type="button"
                                className="result-box"
                                disabled={isRoleResultInputDisabled}
                                onClick={() => {
                                  if (isRoleResultInputDisabled) {
                                    return
                                  }
                                  const key = `${role}-${track.id}-${dayIndex}`
                                  setOpenResultPickerKey((prev) =>
                                    prev === key ? null : key,
                                  )
                                }}
                              >
                                {getResultMark(track.results[dayIndex]?.result ?? '結果なし')}
                              </button>
                              {!isRoleResultInputDisabled &&
                                openResultPickerKey === `${role}-${track.id}-${dayIndex}` && (
                                <div className="result-menu">
                                  <button
                                    type="button"
                                    className="result-menu-item"
                                    onClick={() => {
                                      updateRoleResult(role, trackIndex, dayIndex, '白')
                                      setOpenResultPickerKey(null)
                                    }}
                                  >
                                    ○
                                  </button>
                                  <button
                                    type="button"
                                    className="result-menu-item"
                                    onClick={() => {
                                      updateRoleResult(role, trackIndex, dayIndex, '黒')
                                      setOpenResultPickerKey(null)
                                    }}
                                  >
                                    ●
                                  </button>
                                  <button
                                    type="button"
                                    className="result-menu-item result-menu-item--clear"
                                    onClick={() => {
                                      updateRoleResult(role, trackIndex, dayIndex, '結果なし')
                                      setOpenResultPickerKey(null)
                                    }}
                                  >
                                    未選択
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                          )
                        })()}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="vote-record">
        <div className="vote-record-header">
          <h2>投票記録</h2>
          <div className="vote-tabs">
            {days.map((_, index) => (
              <button
                key={`vote-tab-${index}`}
                type="button"
                className={`vote-tab ${activeVoteDayIndex === index ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveVoteDayIndex(index)
                  setActiveRunoffRoundIndex(0)
                  setDraggingFromId(null)
                }}
              >
                {index + 1}日目
              </button>
            ))}
          </div>
        </div>

        <div className="vote-layout">
          <div className="vote-link-board" ref={voteLinkBoardRef}>
            <svg className="vote-link-lines" aria-hidden="true">
              {voteLines.map((line) => (
                <line
                  key={`${activeVoteDayIndex}-${line.fromId}-${line.toId}`}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  className="vote-link-line"
                />
              ))}
            </svg>

            <div className="vote-link-columns">
              <div className="vote-link-column">
                <h3>投票者</h3>
                {alivePlayersOnActiveVoteDay.map((player) => (
                  <div key={`from-${player.id}`} className="vote-link-row is-from">
                    <button
                      type="button"
                      className="vote-link-name-button"
                      onClick={() => openEditPopup(player.id, false)}
                    >
                      {player.name}
                    </button>
                    <button
                      type="button"
                      className={`vote-link-dot ${
                        draggingFromId === player.id || currentDayVotes[player.id] ? 'is-active' : ''
                      }`}
                      onClick={() => selectVoteFrom(player.id)}
                      ref={(element) => {
                        fromDotRefs.current[player.id] = element
                      }}
                      title="クリックして投票先を選択"
                      aria-label={`${player.name}を投票者として選択`}
                    />
                  </div>
                ))}
              </div>

              <div className="vote-link-column">
                <h3>投票先</h3>
                {alivePlayersOnActiveVoteDay.map((player) => (
                  <div
                    key={`to-${player.id}`}
                    className={`vote-link-row is-to ${draggingFromId && draggingFromId !== player.id ? 'is-hover-target' : ''}`}
                  >
                    <button
                      type="button"
                      className={`vote-link-dot ${firstVoteCounts[player.id] ? 'is-active' : ''}`}
                      data-vote-to-id={player.id}
                      ref={(element) => {
                        toDotRefs.current[player.id] = element
                      }}
                      onClick={() => selectVoteTarget(player.id)}
                      disabled={!draggingFromId || draggingFromId === player.id}
                      aria-label={`${player.name}に投票`}
                    />
                    <span>{player.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="vote-table-wrap">
            <table className="vote-table">
              <thead>
                <tr>
                  <th>投票者</th>
                  <th>投票先</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {voteRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="placeholder-cell">
                      投票なし
                    </td>
                  </tr>
                ) : (
                  voteRows.map((row) => {
                    const fromName = participants.find((player) => player.id === row.fromId)?.name ?? '(不明)'
                    const toName = participants.find((player) => player.id === row.toId)?.name ?? '(不明)'
                    return (
                      <tr key={`${activeVoteDayIndex}-${row.fromId}`}>
                        <td>{fromName}</td>
                        <td>
                          {toName} ({row.countAtThatPoint})
                        </td>
                        <td>
                          <button
                            type="button"
                            className="vote-cancel-btn"
                            onClick={() => cancelVote(row.fromId)}
                            aria-label="投票をキャンセル"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        {needsFirstRunoff && (
          <div className="runoff-launch">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setActiveRunoffRoundIndex(needsSecondRunoff ? 1 : 0)
                setIsRunoffPopupOpen(true)
              }}
            >
              {needsSecondRunoff ? '再決戦投票' : '決戦投票'}
            </button>
            <span className="runoff-launch-note">
              同票のため決戦投票が必要です
              {needsSecondRunoff
                ? isRunoffFullyComplete
                  ? '（1回目・2回目とも入力完了）'
                  : '（2回目の入力が必要）'
                : isRunoffFullyComplete
                  ? '（入力完了）'
                  : ''}
            </span>
          </div>
        )}
      </section>
      </div>

      <div className="side-column">
      <section className="stream-comment">
        <h2>配信用コメント</h2>
        <textarea
          value={streamComment}
          onChange={(event) => setStreamComment(event.target.value)}
          placeholder="配信用ウィンドウに表示するコメントを入力できます。"
          rows={2}
        />
      </section>
      <section className="free-memo">
        <h2>フリーメモ</h2>
        <textarea
          value={freeMemo}
          onChange={(event) => setFreeMemo(event.target.value)}
          placeholder="自由にメモできます。"
          rows={18}
        />
      </section>
      </div>
      </div>

      {isRunoffPopupOpen && needsFirstRunoff && activeRunoffDay && (
        <div className="modal-backdrop" onClick={() => setIsRunoffPopupOpen(false)}>
          <div className="modal runoff-modal" onClick={(event) => event.stopPropagation()}>
            <h3>決戦投票</h3>
            <p>
              同票のため決戦投票を入力してください。
              {needsSecondRunoff
                ? isRunoffFullyComplete
                  ? '（1回目・2回目とも入力完了）'
                  : '（2回目の入力が必要）'
                : isRunoffFullyComplete
                  ? '（入力完了）'
                  : ''}
            </p>
            {needsSecondRunoff && (
              <div className="runoff-round-tabs" role="tablist" aria-label="決戦投票ラウンド">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeRunoffRoundIndex === 0}
                  className={`runoff-round-tab ${activeRunoffRoundIndex === 0 ? 'is-active' : ''}`}
                  onClick={() => setActiveRunoffRoundIndex(0)}
                >
                  1回目
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeRunoffRoundIndex === 1}
                  className={`runoff-round-tab ${activeRunoffRoundIndex === 1 ? 'is-active' : ''}`}
                  onClick={() => setActiveRunoffRoundIndex(1)}
                >
                  2回目
                </button>
              </div>
            )}
            <div className="runoff-table-wrap">
              <table className="runoff-table">
                <thead>
                  <tr>
                    <th>投票者</th>
                    {(activeRunoffRoundIndex === 1
                      ? secondRunoffCandidatesOnActiveDay
                      : firstRunoffCandidatesOnActiveDay).map((candidate) => (
                      <th key={`runoff-col-${candidate.id}`}>{candidate.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(activeRunoffRoundIndex === 1
                    ? secondRunoffVotersOnActiveDay
                    : firstRunoffVotersOnActiveDay).length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          (activeRunoffRoundIndex === 1
                            ? secondRunoffCandidatesOnActiveDay
                            : firstRunoffCandidatesOnActiveDay).length + 1
                        }
                        className="placeholder-cell"
                      >
                        決戦投票の対象外プレイヤーがいません。
                      </td>
                    </tr>
                  ) : (
                    (activeRunoffRoundIndex === 1
                      ? secondRunoffVotersOnActiveDay
                      : firstRunoffVotersOnActiveDay).map((voter) => (
                      <tr key={`runoff-row-${voter.id}`}>
                        <td>{voter.name}</td>
                        {(activeRunoffRoundIndex === 1
                          ? secondRunoffCandidatesOnActiveDay
                          : firstRunoffCandidatesOnActiveDay).map((candidate) => (
                          <td key={`runoff-cell-${voter.id}-${candidate.id}`} className="runoff-check-cell">
                            <input
                              type="checkbox"
                              checked={
                                (activeRunoffRoundIndex === 1 ? secondRunoffVotes : firstRunoffVotes)[voter.id] ===
                                candidate.id
                              }
                              onChange={(event) =>
                                updateRunoffVote(
                                  activeRunoffRoundIndex === 1 ? 1 : 0,
                                  voter.id,
                                  candidate.id,
                                  event.target.checked,
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setIsRunoffPopupOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {isImportOpen && (
        <div className="modal-backdrop" onClick={() => setIsImportOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>テキストから取り込む</h3>
            <p>改行区切りで名前を入力してください。</p>
            <textarea
              rows={8}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setIsImportOpen(false)}>
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={addParticipantsFromText}
              >
                取り込む
              </button>
            </div>
          </div>
        </div>
      )}

      {isExportOpen && (
        <div className="modal-backdrop" onClick={() => setIsExportOpen(false)}>
          <div className="modal export-modal" onClick={(event) => event.stopPropagation()}>
            <h3>JSON保存</h3>
            <div className="export-form-row">
              <label htmlFor="export-result">勝敗</label>
              <select
                id="export-result"
                value={exportResult}
                onChange={(event) => setExportResult(event.target.value as '○' | '●')}
              >
                <option value="○">○（勝ち）</option>
                <option value="●">●（負け）</option>
              </select>
            </div>
            <div className="export-form-row">
              <label htmlFor="export-date">日付</label>
              <input
                id="export-date"
                type="date"
                value={exportDate}
                onChange={(event) => setExportDate(event.target.value)}
              />
            </div>
            <div className="export-form-row">
              <label htmlFor="export-match-number">何戦目</label>
              <input
                id="export-match-number"
                type="number"
                min={1}
                step={1}
                value={exportMatchNumber}
                onChange={(event) => setExportMatchNumber(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
              />
            </div>
            <p className="export-file-preview">{buildExportFileName()}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setIsExportOpen(false)}>
                キャンセル
              </button>
              <button type="button" className="btn btn--primary" onClick={downloadJson}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {editingId && (
        <div className="modal-backdrop" onClick={closeEditPopup}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>参加者の編集</h3>
            <input
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
            />
            <div className="edit-score-row">
              <button
                type="button"
                className="score-step-btn"
                onClick={() => setEditingScore((prev) => clampParticipantScore(prev - 1))}
                aria-label="数値を1下げる"
              >
                -
              </button>
              <input
                type="number"
                min={0}
                max={10}
                value={editingScore}
                onChange={(event) => setEditingScore(clampParticipantScore(Number(event.target.value)))}
              />
              <button
                type="button"
                className="score-step-btn"
                onClick={() => setEditingScore((prev) => clampParticipantScore(prev + 1))}
                aria-label="数値を1上げる"
              >
                +
              </button>
            </div>
            <textarea
              rows={4}
              value={editingNote}
              onChange={(event) => setEditingNote(event.target.value)}
              placeholder="メモ"
            />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={closeEditPopup}>
                閉じる
              </button>
              {isEditDeleteVisible && (
                <button type="button" className="btn btn--danger" onClick={deleteParticipant}>
                  削除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </main>
  )
}

export default App

