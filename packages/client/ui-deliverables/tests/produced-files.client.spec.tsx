// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

const monacoMock = vi.hoisted(() => ({
  createDiffEditor: vi.fn(),
  createModel: vi.fn(),
  setModel: vi.fn(),
  disposeEditor: vi.fn(),
}))

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  editor: {
    createModel: monacoMock.createModel.mockImplementation((value: string) => ({
      value,
      dispose: vi.fn(),
    })),
    createDiffEditor: monacoMock.createDiffEditor.mockImplementation(() => ({
      setModel: monacoMock.setModel,
      dispose: monacoMock.disposeEditor,
    })),
  },
}))

import { ProducedFiles } from '../src/client/ProducedFiles.tsx'
import {
  changesForClosing, producedForClosing, selectProducedFiles,
  type DeliverablesTurnData, type ProducedFileChange,
} from '../src/client/turn-deliverables.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function owner(data: DeliverablesTurnData | undefined, seq = 99): TurnTailOwnerProps {
  return {
    seq,
    openFile: () => {},
    turn: {
      turn: 1, start: undefined, end: undefined, status: 'closed', steps: [],
      data: { get: (key: string) => key === 'deliverables' ? data : undefined } as never,
    },
  }
}

describe('final produced-file projection', () => {
  it('keeps rc.5 path-only Turn data readable', () => {
    const data = { produced: [{ seq: 2, path: 'a.ts' }, { seq: 3, path: 'b.ts' }, { seq: 4, path: 'a.ts' }] } satisfies DeliverablesTurnData
    expect(producedForClosing(data)).toEqual(['a.ts', 'b.ts'])
    expect(selectProducedFiles(owner(data))).toEqual(['a.ts', 'b.ts'])
  })

  it('folds a continuous full-snapshot chain into first-before and final-after', () => {
    const data = {
      produced: [
        { seq: 2, path: 'a.ts', diffs: [], snapshot: { created: false, before: 'A\n', after: 'B\n' } },
        { seq: 3, path: 'a.ts', diffs: [], snapshot: { created: false, before: 'B\n', after: 'C\n' } },
      ],
    } satisfies DeliverablesTurnData
    expect(changesForClosing(data)).toEqual([{
      path: 'a.ts', diffs: [], snapshot: { created: false, before: 'A\n', after: 'C\n' },
    }])
  })

  it('drops full-snapshot undo if any mutation in the path lacks a complete snapshot', () => {
    const data = {
      produced: [
        { seq: 2, path: 'a.ts', diffs: [], snapshot: { created: false, before: 'A', after: 'B' } },
        { seq: 3, path: 'a.ts', diffs: [{ path: 'a.ts', oldText: 'B', newText: 'C' }] },
        { seq: 4, path: 'a.ts', diffs: [], snapshot: { created: false, before: 'C', after: 'D' } },
      ],
    } satisfies DeliverablesTurnData
    expect(changesForClosing(data)[0]?.snapshot).toBeUndefined()
  })
})

describe('ProducedFiles V3.4 Monaco inline table', () => {
  const t = makeTranslate(zh)
  const changed: ProducedFileChange = {
    path: 'src/UserService.ts',
    diffs: [],
    snapshot: {
      created: false,
      before: 'export const value = 1\n',
      after: 'export const value = 2\nexport const added = true\n',
    },
  }

  it('renders one row, expands one Monaco inline diff editor, and undoes only that file', async () => {
    const undo = vi.fn().mockResolvedValue({ ok: true })
    const view = render(<ProducedFiles matched={[changed]} openFile={() => {}} undo={undo} t={t} />)
    expect(view.getByText('UserService.ts')).toBeTruthy()
    expect(view.getByText('+2')).toBeTruthy()
    expect(view.getByText('−1')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: '展开 src/UserService.ts 的差异' }))
    await waitFor(() => expect(monacoMock.createDiffEditor).toHaveBeenCalledTimes(1))
    const options = monacoMock.createDiffEditor.mock.calls[0]?.[1]
    expect(options?.renderSideBySide).toBe(false)
    expect(options?.experimental).toEqual({ useTrueInlineView: true })
    expect(options?.readOnly).toBe(true)
    expect(view.getByLabelText('src/UserService.ts 的 Monaco 差异编辑器')).toBeTruthy()
    expect(view.queryByText('修改前')).toBeNull()
    expect(view.queryByText('修改后')).toBeNull()
    expect(monacoMock.createModel).toHaveBeenNthCalledWith(1, changed.snapshot?.before)
    expect(monacoMock.createModel).toHaveBeenNthCalledWith(2, changed.snapshot?.after)
    expect(monacoMock.setModel).toHaveBeenCalledTimes(1)

    fireEvent.click(view.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(undo).toHaveBeenCalledWith(changed))
    expect((view.getByRole('button', { name: '已撤销' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a path-only/non-text deliverable as an external opener', () => {
    const openFile = vi.fn()
    const pathOnly: ProducedFileChange = { path: 'build/report.pdf', diffs: [] }
    const view = render(<ProducedFiles matched={[pathOnly]} openFile={openFile} undo={async () => ({ ok: true })} t={t} />)
    fireEvent.click(view.getByRole('button', { name: '打开 build/report.pdf' }))
    expect(openFile).toHaveBeenCalledWith('build/report.pdf')
    expect((view.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ships the same key set in English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
