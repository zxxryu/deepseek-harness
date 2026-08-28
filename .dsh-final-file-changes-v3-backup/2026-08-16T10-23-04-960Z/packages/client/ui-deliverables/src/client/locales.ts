export const NS = 'deliverables'

export const zh = {
  'produced.label': '产物',
  'produced.open': '打开 {name}',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.showInFolder': '在文件夹中显示',
  'produced.files': '{count} 个文件',
  'produced.undo': '撤销',
  'produced.undoing': '撤销中…',
  'produced.undone': '已撤销',
  'produced.undoUnavailable': '此文件没有可安全撤销的完整变更信息',
  'produced.expand': '展开 {name} 的差异',
  'produced.collapse': '收起 {name} 的差异',
  'produced.diffAria': '{name} 的 Monaco 差异编辑器',
}

export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.open': 'Open {name}',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.showInFolder': 'Show in folder',
  'produced.files': '{count} files',
  'produced.undo': 'Undo',
  'produced.undoing': 'Undoing…',
  'produced.undone': 'Undone',
  'produced.undoUnavailable': 'No safely reversible change data was recorded for this file',
  'produced.expand': 'Expand diff for {name}',
  'produced.collapse': 'Collapse diff for {name}',
  'produced.diffAria': 'Monaco diff editor for {name}',
}

export type DeliverablesKey = keyof typeof zh

/**
 * Keep the locale namespace merge next to the dictionary itself so direct
 * component/test imports see PropsLocale<'deliverables'> as { t }, even when
 * the plugin entry module is not part of that compilation unit.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    deliverables: DeliverablesKey
  }
}
