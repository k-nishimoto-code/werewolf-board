import { useMemo, useState } from 'react'
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

  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importText, setImportText] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingNote, setEditingNote] = useState('')
  const [openResultPickerKey, setOpenResultPickerKey] = useState<string | null>(null)

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

