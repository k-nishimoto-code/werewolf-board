import { useEffect, useMemo, useState } from 'react'
import './StreamWindow.css'
import {
  readStreamOverlayPayload,
  STREAM_OVERLAY_STORAGE_KEY,
  type StreamDaySummary,
  type StreamOverlayPayload,
  type StreamRoleResultItem,
} from './streaming'

type StreamRoleSection = {
  title: '占い師' | '霊媒師' | '騎士'
  lines: string[]
}

const ROLE_SECTION_ORDER: StreamRoleSection['title'][] = ['占い師', '霊媒師', '騎士']

const formatRoleChunk = (item: StreamRoleResultItem): string => {
  const target = item.targetName || ''
  const mark = item.resultMark || ''
  return `${target}${mark}`
}

const hasAnyDayData = (summary: StreamDaySummary | undefined): boolean =>
  Boolean(summary && (summary.executedName || summary.bittenName || summary.roleResults.length > 0))

const buildOrderedDaySummaries = (payload: StreamOverlayPayload | null): (StreamDaySummary | undefined)[] => {
  if (!payload) {
    return []
  }

  const summaryMap = new Map(payload.daySummaries.map((summary) => [summary.dayNumber, summary]))
  return Array.from({ length: payload.latestDayNumber }, (_, index) => summaryMap.get(index + 1))
}

const buildExecutedHistory = (orderedSummaries: (StreamDaySummary | undefined)[]): string => {
  const values: string[] = []

  orderedSummaries.forEach((summary, index) => {
    if (summary?.executedName) {
      values.push(summary.executedName)
      return
    }

    const hasProgressedPastExecution =
      Boolean(summary?.bittenName) ||
      orderedSummaries.slice(index + 1).some((nextSummary) => hasAnyDayData(nextSummary))

    if (hasProgressedPastExecution) {
      values.push('なし')
    }
  })

  return values.join(' > ')
}

const buildBittenHistory = (orderedSummaries: (StreamDaySummary | undefined)[]): string => {
  const values: string[] = []

  orderedSummaries.forEach((summary, index) => {
    if (summary?.bittenName) {
      values.push(summary.bittenName)
      return
    }

    const hasProgressedPastBite = orderedSummaries
      .slice(index + 1)
      .some((nextSummary) => hasAnyDayData(nextSummary))

    if (hasProgressedPastBite) {
      values.push('なし')
    }
  })

  return values.join(' > ')
}

function StreamWindow() {
  const [payload, setPayload] = useState<StreamOverlayPayload | null>(() => readStreamOverlayPayload())

  useEffect(() => {
    document.title = '配信用ミニウィンドウ'

    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== STREAM_OVERLAY_STORAGE_KEY) {
        return
      }
      setPayload(readStreamOverlayPayload())
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const orderedSummaries = useMemo(() => buildOrderedDaySummaries(payload), [payload])

  const executedHistory = useMemo(
    () => buildExecutedHistory(orderedSummaries),
    [orderedSummaries],
  )

  const bittenHistory = useMemo(
    () => buildBittenHistory(orderedSummaries),
    [orderedSummaries],
  )

  const roleSections = useMemo<StreamRoleSection[]>(() => {
    if (!payload) {
      return ROLE_SECTION_ORDER.map((title) => ({ title, lines: [] }))
    }

    const groupedByRole = new Map<string, Map<string, string[]>>()

    payload.daySummaries.forEach((summary) => {
      summary.roleResults.forEach((item) => {
        const chunk = formatRoleChunk(item)
        if (!chunk) {
          return
        }

        const roleMap = groupedByRole.get(item.roleLabel) ?? new Map<string, string[]>()
        const actorChunks = roleMap.get(item.actorName) ?? []
        actorChunks.push(chunk)
        roleMap.set(item.actorName, actorChunks)
        groupedByRole.set(item.roleLabel, roleMap)
      })
    })

    return ROLE_SECTION_ORDER.map((title) => {
      const roleMap = groupedByRole.get(title)
      const actorNames = payload.roleActorsByLabel[title] ?? []
      const actorNameSet = new Set<string>([
        ...actorNames,
        ...(roleMap ? [...roleMap.keys()] : []),
      ])
      const lines = [...actorNameSet].map((actorName) => {
        const chunks = roleMap?.get(actorName) ?? []
        return chunks.length > 0 ? `${actorName}：${chunks.join(' ')}` : `${actorName}：`
      })
      return { title, lines }
    })
  }, [payload])

  const roleSectionMap = useMemo(
    () => new Map(roleSections.map((section) => [section.title, section.lines])),
    [roleSections],
  )

  return (
    <main className="stream-window">
      <section className="stream-strip">
        <div className="stream-strip-head">
          <p>{payload ? `${payload.latestDayNumber}日目まで表示中` : '本体画面の入力待ち'}</p>
        </div>

        <div className="stream-grid">
          <div className="stream-column">
            <section className="stream-block">
              <h2>【吊り】</h2>
              <p>{executedHistory}</p>
            </section>

            <section className="stream-block">
              <h2>【占い師】</h2>
              {(roleSectionMap.get('占い師')?.length ?? 0) > 0 ? (
                <div className="stream-lines">
                  {roleSectionMap.get('占い師')!.map((line) => (
                    <p key={`占い師-${line}`}>{line}</p>
                  ))}
                </div>
              ) : (
                <div className="stream-lines stream-lines--empty">
                  <p>&nbsp;</p>
                </div>
              )}
            </section>

            <section className="stream-block">
              <h2>【騎士】</h2>
              {(roleSectionMap.get('騎士')?.length ?? 0) > 0 ? (
                <div className="stream-lines">
                  {roleSectionMap.get('騎士')!.map((line) => (
                    <p key={`騎士-${line}`}>{line}</p>
                  ))}
                </div>
              ) : (
                <div className="stream-lines stream-lines--empty">
                  <p>&nbsp;</p>
                </div>
              )}
            </section>
          </div>

          <div className="stream-column">
            <section className="stream-block">
              <h2>【噛み】</h2>
              <p>{bittenHistory}</p>
            </section>

            <section className="stream-block">
              <h2>【霊媒師】</h2>
              {(roleSectionMap.get('霊媒師')?.length ?? 0) > 0 ? (
                <div className="stream-lines">
                  {roleSectionMap.get('霊媒師')!.map((line) => (
                    <p key={`霊媒師-${line}`}>{line}</p>
                  ))}
                </div>
              ) : (
                <div className="stream-lines stream-lines--empty">
                  <p>&nbsp;</p>
                </div>
              )}
            </section>

            <section className="stream-block">
              <h2>【コメント】</h2>
              <p>{payload?.comment ?? ''}</p>
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}

export default StreamWindow
