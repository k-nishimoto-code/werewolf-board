import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import './App.css'

type RoleKey = 'seer' | 'medium' | 'guard'

type Participant = {
  id: string
  name: string
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
type RunoffDay = {
  candidateIds: string[]
  votes: DayVotes
}

const ROLE_KEYS: RoleKey[] = ['seer', 'medium', 'guard']

const ROLE_LABELS: Record<RoleKey, string> = {
  seer: '占い師',
  medium: '霊媒師',
  guard: '騎士',
}

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
    .split(/[\r\n,、，\t ]+/)
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
          candidateIds: [...runoff.candidateIds],
          votes: { ...runoff.votes },
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
  const candidateIds = runoff.candidateIds.filter((id) => validIds.has(id))
  if (candidateIds.length < 2) {
    return null
  }
  const candidateSet = new Set(candidateIds)
  const votes = Object.fromEntries(
    Object.entries(runoff.votes).filter(([fromId, toId]) => validIds.has(fromId) && candidateSet.has(toId)),
  )
  return { candidateIds, votes }
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
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null)
  const [hoverVoteTargetId, setHoverVoteTargetId] = useState<string | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  const [isRunoffPopupOpen, setIsRunoffPopupOpen] = useState(false)

  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingNote, setEditingNote] = useState('')
  const [freeMemo, setFreeMemo] = useState('')
  const [openResultPickerKey, setOpenResultPickerKey] = useState<string | null>(null)

  const voteLinkBoardRef = useRef<HTMLDivElement | null>(null)
  const fromDotRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const toDotRefs = useRef<Record<string, HTMLButtonElement | null>>({})

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

  const addParticipant = (): void => {
    setParticipants((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: `参加者${prev.length + 1}`, note: '' },
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
      ...names.map((name) => ({ id: crypto.randomUUID(), name, note: '' })),
    ])
    setImportText('')
    setIsImportOpen(false)
  }

  const closeEditPopup = (): void => {
    setEditingId(null)
    setEditingName('')
    setEditingNote('')
  }

  const openEditPopup = (id: string): void => {
    const target = participants.find((player) => player.id === id)
    if (!target) {
      return
    }

    setEditingId(id)
    setEditingName(target.name)
    setEditingNote(target.note)
  }

  const saveEditedName = (): void => {
    if (!editingId) {
      return
    }

    setParticipants((prev) =>
      prev.map((player) =>
        player.id === editingId
          ? { ...player, name: editingName.trim() || '名前未設定', note: editingNote }
          : player,
      ),
    )
    closeEditPopup()
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
    closeEditPopup()
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
          ? {
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
          ? {
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

  const firstVoteCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    Object.values(currentDayVotes).forEach((toId) => {
      counts[toId] = (counts[toId] ?? 0) + 1
    })
    return counts
  }, [currentDayVotes])

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

  const needsRunoff = tiedTopCandidateIds.length >= 2
  const tiedTopCandidateKey = tiedTopCandidateIds.join('|')

  const runoffVoterIdsForActiveDay = useMemo(() => {
    const tiedSet = new Set(tiedTopCandidateIds)
    return alivePlayersOnActiveVoteDay
      .map((player) => player.id)
      .filter((playerId) => !tiedSet.has(playerId))
  }, [alivePlayersOnActiveVoteDay, tiedTopCandidateIds])

  const runoffVoterKey = runoffVoterIdsForActiveDay.join('|')

  const activeRunoffDay = runoffByDay[activeVoteDayIndex] ?? null
  const activeRunoffVotes = activeRunoffDay?.votes ?? {}

  const runoffCandidatesOnActiveDay = useMemo(() => {
    const candidateSet = new Set(tiedTopCandidateIds)
    return participants.filter((player) => candidateSet.has(player.id))
  }, [participants, tiedTopCandidateIds])

  const runoffVotersOnActiveDay = useMemo(() => {
    const voterSet = new Set(runoffVoterIdsForActiveDay)
    return participants.filter((player) => voterSet.has(player.id))
  }, [participants, runoffVoterIdsForActiveDay])

  const isRunoffComplete = useMemo(
    () => runoffVoterIdsForActiveDay.every((fromId) => activeRunoffVotes[fromId] !== undefined),
    [runoffVoterIdsForActiveDay, activeRunoffVotes],
  )

  useEffect(() => {
    setRunoffByDay((prev) => {
      const normalized = normalizeRunoffByDay(prev, days.length)
      const currentRunoff = normalized[activeVoteDayIndex] ?? null

      if (!needsRunoff) {
        if (currentRunoff === null) {
          return prev
        }
        normalized[activeVoteDayIndex] = null
        return normalized
      }

      if (currentRunoff && areStringArraysEqual(currentRunoff.candidateIds, tiedTopCandidateIds)) {
        const allowedFromIds = new Set(runoffVoterIdsForActiveDay)
        const allowedToIds = new Set(tiedTopCandidateIds)
        const nextVotes = Object.fromEntries(
          Object.entries(currentRunoff.votes).filter(
            ([fromId, toId]) => allowedFromIds.has(fromId) && allowedToIds.has(toId),
          ),
        )
        if (areVoteMapsEqual(currentRunoff.votes, nextVotes)) {
          return prev
        }
        normalized[activeVoteDayIndex] = {
          candidateIds: [...tiedTopCandidateIds],
          votes: nextVotes,
        }
        return normalized
      }

      normalized[activeVoteDayIndex] = {
        candidateIds: [...tiedTopCandidateIds],
        votes: {},
      }
      return normalized
    })

    if (!needsRunoff) {
      setIsRunoffPopupOpen(false)
    }
  }, [
    needsRunoff,
    tiedTopCandidateKey,
    runoffVoterKey,
    activeVoteDayIndex,
    days.length,
    tiedTopCandidateIds,
    runoffVoterIdsForActiveDay,
  ])

  const updateRunoffVote = (fromId: string, toId: string, checked: boolean): void => {
    setRunoffByDay((prev) => {
      const normalized = normalizeRunoffByDay(prev, days.length)
      const runoff = normalized[activeVoteDayIndex]
      if (!runoff) {
        return prev
      }

      const nextVotes = { ...runoff.votes }
      if (!checked && runoff.votes[fromId] === toId) {
        delete nextVotes[fromId]
      } else if (checked) {
        nextVotes[fromId] = toId
      }

      if (areVoteMapsEqual(runoff.votes, nextVotes)) {
        return prev
      }

      normalized[activeVoteDayIndex] = {
        candidateIds: runoff.candidateIds,
        votes: nextVotes,
      }
      return normalized
    })
  }

  const startVoteDrag = (fromId: string, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!aliveIdsOnActiveVoteDay.has(fromId)) {
      return
    }
    const board = voteLinkBoardRef.current
    if (board) {
      const rect = board.getBoundingClientRect()
      setDragPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    setDraggingFromId(fromId)
    setHoverVoteTargetId(null)
    event.preventDefault()
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

  useEffect(() => {
    if (!draggingFromId) {
      return
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const board = voteLinkBoardRef.current
      if (!board) {
        return
      }
      const rect = board.getBoundingClientRect()
      setDragPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }

    const handlePointerUp = (event: PointerEvent): void => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
      const toNode = target?.closest('[data-vote-to-id]') as HTMLElement | null
      const toId = toNode?.dataset.voteToId ?? ''
      if (
        toId &&
        toId !== draggingFromId &&
        aliveIdsOnActiveVoteDay.has(draggingFromId) &&
        aliveIdsOnActiveVoteDay.has(toId)
      ) {
        setVotesByDay((prev) =>
          prev.map((votes, dayIndex) =>
            dayIndex === activeVoteDayIndex ? { ...votes, [draggingFromId]: toId } : votes,
          ),
        )
      }
      setDraggingFromId(null)
      setDragPointer(null)
      setHoverVoteTargetId(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [draggingFromId, aliveIdsOnActiveVoteDay, activeVoteDayIndex])

  const voteLines = useMemo(() => {
    const EDGE_OFFSET = 12
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
      lines.push({
        fromId,
        toId,
        x1: fromRect.left - boardRect.left + fromRect.width / 2 + EDGE_OFFSET,
        y1: fromRect.top - boardRect.top + fromRect.height / 2,
        x2: toRect.left - boardRect.left + toRect.width / 2 - EDGE_OFFSET,
        y2: toRect.top - boardRect.top + toRect.height / 2,
      })
    })
    return lines
  }, [currentDayVotes, layoutTick, activeVoteDayIndex, participants])

  const previewLine = useMemo(() => {
    const EDGE_OFFSET = 12
    if (!draggingFromId || !dragPointer) {
      return null
    }
    const board = voteLinkBoardRef.current
    const fromDot = fromDotRefs.current[draggingFromId]
    if (!board || !fromDot) {
      return null
    }
    const boardRect = board.getBoundingClientRect()
    const fromRect = fromDot.getBoundingClientRect()
    return {
      x1: fromRect.left - boardRect.left + fromRect.width / 2 + EDGE_OFFSET,
      y1: fromRect.top - boardRect.top + fromRect.height / 2,
      x2: dragPointer.x,
      y2: dragPointer.y,
    }
  }, [draggingFromId, dragPointer, layoutTick])

  return (
    <main className="app">
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

      <div className="main-column">
      <section className="board">
        <div className="board-header">
          <h1>盤面整理表</h1>
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
                        <div className="role-cell">
                          <select
                            value={
                              role === 'medium'
                                ? dayIndex === 0
                                  ? ''
                                  : (days[dayIndex - 1]?.executedId ?? '')
                                : (track.results[dayIndex]?.targetId ?? '')
                            }
                            disabled={role === 'medium'}
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
                                onClick={() => {
                                  const key = `${role}-${track.id}-${dayIndex}`
                                  setOpenResultPickerKey((prev) =>
                                    prev === key ? null : key,
                                  )
                                }}
                              >
                                {getResultMark(track.results[dayIndex]?.result ?? '結果なし')}
                              </button>
                              {openResultPickerKey === `${role}-${track.id}-${dayIndex}` && (
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
                  setDraggingFromId(null)
                  setHoverVoteTargetId(null)
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
              {previewLine && (
                <line
                  x1={previewLine.x1}
                  y1={previewLine.y1}
                  x2={previewLine.x2}
                  y2={previewLine.y2}
                  className="vote-link-line is-preview"
                />
              )}
            </svg>

            <div className="vote-link-columns">
              <div className="vote-link-column">
                <h3>投票者</h3>
                {alivePlayersOnActiveVoteDay.map((player) => (
                  <div key={`from-${player.id}`} className="vote-link-row is-from">
                    <span>{player.name}</span>
                    <button
                      type="button"
                      className={`vote-link-dot ${draggingFromId === player.id ? 'is-active' : ''}`}
                      onPointerDown={(event) => startVoteDrag(player.id, event)}
                      ref={(element) => {
                        fromDotRefs.current[player.id] = element
                      }}
                      title="投票先へドラッグ"
                    >
                      ●
                    </button>
                  </div>
                ))}
              </div>

              <div className="vote-link-column">
                <h3>投票先</h3>
                {alivePlayersOnActiveVoteDay.map((player) => (
                  <div
                    key={`to-${player.id}`}
                    className={`vote-link-row is-to ${hoverVoteTargetId === player.id ? 'is-hover-target' : ''}`}
                  >
                    <button
                      type="button"
                      className="vote-link-dot"
                      data-vote-to-id={player.id}
                      ref={(element) => {
                        toDotRefs.current[player.id] = element
                      }}
                      onPointerEnter={() => {
                        if (draggingFromId && draggingFromId !== player.id) {
                          setHoverVoteTargetId(player.id)
                        }
                      }}
                      onPointerLeave={() => {
                        if (hoverVoteTargetId === player.id) {
                          setHoverVoteTargetId(null)
                        }
                      }}
                    >
                      ●
                    </button>
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
                  voteRows.map((row) => (
                    <tr key={`${activeVoteDayIndex}-${row.fromId}`}>
                      <td>{participants.find((player) => player.id === row.fromId)?.name ?? '(不明)'}</td>
                      <td>
                        {participants.find((player) => player.id === row.toId)?.name ?? '(不明)'} ({row.countAtThatPoint})
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        {needsRunoff && (
          <div className="runoff-launch">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setIsRunoffPopupOpen(true)}
            >
              決戦投票
            </button>
            <span className="runoff-launch-note">
              同票のため決戦投票が必要です{isRunoffComplete ? '（入力完了）' : ''}
            </span>
          </div>
        )}
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

      {isRunoffPopupOpen && needsRunoff && activeRunoffDay && (
        <div className="modal-backdrop" onClick={() => setIsRunoffPopupOpen(false)}>
          <div className="modal runoff-modal" onClick={(event) => event.stopPropagation()}>
            <h3>決戦投票</h3>
            <p>
              同票のため決戦投票を入力してください。
              {isRunoffComplete ? '（入力完了）' : ''}
            </p>
            <div className="runoff-table-wrap">
              <table className="runoff-table">
                <thead>
                  <tr>
                    <th>投票者</th>
                    {runoffCandidatesOnActiveDay.map((candidate) => (
                      <th key={`runoff-col-${candidate.id}`}>{candidate.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runoffVotersOnActiveDay.length === 0 ? (
                    <tr>
                      <td colSpan={runoffCandidatesOnActiveDay.length + 1} className="placeholder-cell">
                        決戦投票の対象外プレイヤーがいません。
                      </td>
                    </tr>
                  ) : (
                    runoffVotersOnActiveDay.map((voter) => (
                      <tr key={`runoff-row-${voter.id}`}>
                        <td>{voter.name}</td>
                        {runoffCandidatesOnActiveDay.map((candidate) => (
                          <td key={`runoff-cell-${voter.id}-${candidate.id}`} className="runoff-check-cell">
                            <input
                              type="checkbox"
                              checked={activeRunoffVotes[voter.id] === candidate.id}
                              onChange={(event) =>
                                updateRunoffVote(voter.id, candidate.id, event.target.checked)
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
            <p>改行・カンマ・空白区切りで名前を入力してください。</p>
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

      {editingId && (
        <div className="modal-backdrop" onClick={closeEditPopup}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>参加者の編集</h3>
            <input
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
            />
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
              <button type="button" className="btn btn--danger" onClick={deleteParticipant}>
                削除
              </button>
              <button type="button" className="btn btn--primary" onClick={saveEditedName}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}

export default App

