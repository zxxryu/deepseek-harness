import { useEffect, useMemo, useRef, useState } from 'react'
import { diffLines } from 'diff'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ProducedFileChange } from './turn-deliverables.ts'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

interface UndoActionResult {
  readonly ok: boolean
  readonly message?: string
}

export interface ProducedFilesInjected {
  undo: (change: ProducedFileChange) => Promise<UndoActionResult>
}

export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly ProducedFileChange[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

/** Legacy rc.5 chip-fitting helper retained for source-level compatibility. */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  const prefix = [0]
  let prefixWidth = 0
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  let largestFit = 0
  for (const [shown, width] of prefix.entries()) {
    const more = moreWidthsByShown[shown]
    const items = shown + (more === undefined ? 0 : 1)
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

interface LineStats {
  readonly additions: number
  readonly deletions: number
}

function lineStats(before: string, after: string): LineStats {
  let additions = 0
  let deletions = 0
  for (const chunk of diffLines(before, after)) {
    const count = chunk.count ?? (chunk.value === '' ? 0 : chunk.value.split('\n').length)
    if (chunk.added) additions += count
    if (chunk.removed) deletions += count
  }
  return { additions, deletions }
}

function changeCounts(change: ProducedFileChange): LineStats {
  if (change.snapshot !== undefined) return lineStats(change.snapshot.before ?? '', change.snapshot.after)
  return change.diffs.reduce<LineStats>((total, diff) => {
    const current = lineStats(diff.oldText ?? '', diff.newText)
    return {
      additions: total.additions + current.additions,
      deletions: total.deletions + current.deletions,
    }
  }, { additions: 0, deletions: 0 })
}

function canUndo(change: ProducedFileChange): boolean {
  return change.snapshot !== undefined
    || (change.diffs.length > 0 && change.diffs.every(diff => diff.oldText !== null && diff.newText.length > 0))
}

interface DiffText {
  readonly before: string
  readonly after: string
}

/** Collapse contextual hunk-only data into one Monaco model pair for this file. */
function diffText(change: ProducedFileChange): DiffText | undefined {
  if (change.snapshot !== undefined) {
    return { before: change.snapshot.before ?? '', after: change.snapshot.after }
  }
  if (change.diffs.length === 0) return undefined
  const separator = '\n⋯\n'
  return {
    before: change.diffs.map(diff => diff.oldText ?? '').join(separator),
    after: change.diffs.map(diff => diff.newText).join(separator),
  }
}

function lineCount(value: string): number {
  if (value === '') return 1
  return value.split('\n').length
}

function editorHeight(before: string, after: string): number {
  const longer = Math.max(lineCount(before), lineCount(after))
  const delta = Math.abs(lineCount(before) - lineCount(after))
  return Math.min(520, Math.max(140, (longer + Math.min(delta, 8) + 3) * 20))
}

function isDarkSurface(node: HTMLElement): boolean {
  const raw = getComputedStyle(node).backgroundColor
  const channels = raw.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (channels === undefined || channels.length < 3 || channels.some(value => !Number.isFinite(value))) {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  }
  const [r = 255, g = 255, b = 255] = channels
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128
}

function MonacoInlineDiff({ before, after, ariaLabel }: {
  before: string
  after: string
  ariaLabel: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const height = useMemo(() => editorHeight(before, after), [before, after])

  useEffect(() => {
    const element = host.current
    if (element === null) return

    const original = monaco.editor.createModel(before)
    const modified = monaco.editor.createModel(after)
    const editor = monaco.editor.createDiffEditor(element, {
      ariaLabel,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      experimental: { useTrueInlineView: true },
      diffAlgorithm: 'advanced',
      compactMode: true,
      automaticLayout: true,
      minimap: { enabled: false },
      glyphMargin: false,
      folding: false,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      renderMarginRevertIcon: false,
      renderIndicators: false,
      overviewRulerLanes: 0,
      diffCodeLens: false,
      wordWrap: 'off',
      diffWordWrap: 'off',
      stickyScroll: { enabled: false },
      padding: { top: 8, bottom: 8 },
      fontSize: 12,
      lineHeight: 20,
      theme: isDarkSurface(element) ? 'vs-dark' : 'vs',
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
        alwaysConsumeMouseWheel: false,
      },
    })
    editor.setModel({ original, modified })

    return () => {
      editor.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [ariaLabel, before, after])

  return (
    <div
      ref={host}
      className={css.monacoDiff}
      data-monaco-inline-diff
      style={{ height }}
      aria-label={ariaLabel}
    />
  )
}

function ExpandedDiff({ change, t }: { change: ProducedFileChange; t: ProducedFilesProps['t'] }) {
  const text = diffText(change)
  if (text === undefined) return null
  return (
    <MonacoInlineDiff
      before={text.before}
      after={text.after}
      ariaLabel={t('produced.diffAria', { name: change.path })}
    />
  )
}

export function ProducedFiles({
  matched: changes, openFile, undo, t,
}: ProducedFilesProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [undone, setUndone] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const counts = useMemo(() => new Map(changes.map(change => [change.path, changeCounts(change)])), [changes])

  const onUndo = async (change: ProducedFileChange): Promise<void> => {
    if (undoing !== null || undone.has(change.path) || !canUndo(change)) return
    setUndoing(change.path)
    setErrors((previous) => {
      const next = new Map(previous)
      next.delete(change.path)
      return next
    })
    try {
      const result = await undo(change)
      if (!result.ok) {
        setErrors(previous => new Map(previous).set(change.path, result.message ?? 'Undo failed'))
        return
      }
      setUndone(previous => new Set(previous).add(change.path))
      setExpanded(current => current === change.path ? null : current)
    } catch (error) {
      setErrors(previous => new Map(previous).set(
        change.path,
        error instanceof Error ? error.message : String(error),
      ))
    } finally {
      setUndoing(null)
    }
  }

  return (
    <section className={css.root} aria-label={t('produced.label')}>
      <div className={css.titleRow}>
        <span className={css.label}>{t('produced.label')}</span>
        <span className={css.count}>{t('produced.files', { count: String(changes.length) })}</span>
      </div>
      <div className={css.table}>
        {changes.map((change) => {
          const hasDiff = diffText(change) !== undefined
          const isExpanded = expanded === change.path
          const isUndone = undone.has(change.path)
          const isUndoing = undoing === change.path
          const reversible = canUndo(change)
          const stats = counts.get(change.path) ?? { additions: 0, deletions: 0 }
          return (
            <div key={change.path} className={`${css.item} ${isUndone ? css.undone : ''}`}>
              <div className={css.fileRow}>
                <button
                  type="button"
                  className={css.fileMain}
                  title={change.path}
                  aria-label={hasDiff
                    ? t(isExpanded ? 'produced.collapse' : 'produced.expand', { name: change.path })
                    : t('produced.open', { name: change.path })}
                  onClick={() => {
                    if (isUndone) return
                    if (hasDiff) setExpanded(current => current === change.path ? null : change.path)
                    else openFile(change.path)
                  }}
                >
                  <span className={css.chevron}>{hasDiff ? (isExpanded ? '▾' : '▸') : '•'}</span>
                  <span className={css.path}>{basename(change.path)}</span>
                  <span className={css.fullPath}>{change.path}</span>
                  <span className={css.stats}>
                    {stats.additions > 0 && <span className={css.add}>+{stats.additions}</span>}
                    {stats.deletions > 0 && <span className={css.del}>−{stats.deletions}</span>}
                  </span>
                </button>
                <button
                  type="button"
                  className={css.undo}
                  disabled={isUndone || isUndoing || !reversible}
                  {...!reversible ? { title: t('produced.undoUnavailable') } : {}}
                  onClick={(event) => {
                    event.stopPropagation()
                    void onUndo(change)
                  }}
                >
                  {isUndone ? t('produced.undone') : isUndoing ? t('produced.undoing') : t('produced.undo')}
                </button>
              </div>
              {errors.get(change.path) !== undefined && <div className={css.error}>{errors.get(change.path)}</div>}
              {isExpanded && !isUndone && hasDiff && (
                <div className={css.expanded}><ExpandedDiff change={change} t={t} /></div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
