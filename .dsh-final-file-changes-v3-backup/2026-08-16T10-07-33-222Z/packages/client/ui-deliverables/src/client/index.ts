/**
 * Deliverables plugin, browser half: keeps the native produced-file Turn tail,
 * but renders it as an expandable final-changes table with per-file undo.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ProducedFiles } from './ProducedFiles.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, selectProducedChanges,
} from './turn-deliverables.ts'
import type { ProducedFileChange } from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    deliverables: DeliverablesKey
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { changesForClosing, producedForClosing } from './turn-deliverables.ts'
export type { ProducedFileChange } from './turn-deliverables.ts'

/** Required services for the tail-slot registration, Remote undo, and copy. */
export const inject = ['slots', 'locale', 'conversationEvents', 'remote', 'remote.fileChanges']

function undoRequest(sessionId: SessionId, change: ProducedFileChange) {
  if (change.snapshot !== undefined) {
    return {
      sessionId,
      path: change.path,
      created: change.snapshot.created,
      before: change.snapshot.before,
      after: change.snapshot.after,
    }
  }
  return {
    sessionId,
    path: change.path,
    diffs: change.diffs.map(diff => ({ oldText: diff.oldText, newText: diff.newText })),
  }
}

/** Register final produced-file rows and the closing-prose mention vocabulary. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectProducedChanges,
      locale: NS,
      inject: (sessionId: SessionId) => ({
        undo: async (change: ProducedFileChange) => {
          const carried = await ctx.remote.fileChanges.undo(undoRequest(sessionId, change))
          if (!carried.ok) {
            return { ok: false, message: `${carried.error.message} (${carried.error.code})` }
          }
          if (!carried.value.ok) return { ok: false, message: carried.value.message }
          return { ok: true }
        },
      }),
    }, ProducedFiles),
  )

  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      const changes = selectProducedChanges(owner)
      if (changes === null) return undefined
      const paths = changes.map(change => change.path)
      return producedFileMentions(paths, owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
