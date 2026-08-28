import { readFile } from 'node:fs/promises'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { clientBundle } from '../tsdown.client.ts'

const PACKAGE_ID = '@deepseek-ai/dsh-client-ui-deliverables'
const MONACO_CSS_PREFIX = '\0dsh-monaco-css:'
const MONACO_CSS_SUFFIX = '.mjs'

type BuildPlugin = NonNullable<UserConfig['plugins']>[number]

/** Inline Monaco's ordinary CSS into the plugin factory; Harness normally only inlines CSS Modules. */
function monacoCssInlinePlugin(): BuildPlugin {
  return {
    name: 'dsh-monaco-css-inline',
    async resolveId(source, importer) {
      if (!source.endsWith('.css') || importer === undefined || !importer.includes('monaco-editor')) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      return resolved === null ? null : MONACO_CSS_PREFIX + resolved.id + MONACO_CSS_SUFFIX
    },
    async load(id) {
      if (!id.startsWith(MONACO_CSS_PREFIX)) return null
      if (!id.endsWith(MONACO_CSS_SUFFIX)) return null
      const physical = id.slice(MONACO_CSS_PREFIX.length, -MONACO_CSS_SUFFIX.length)
      this.addWatchFile(physical)
      const source = await readFile(physical)
      const { code } = transform({ filename: physical, code: source, minify: true })
      const css = code.toString()
      const tagId = `${PACKAGE_ID}/monaco/${physical.split(/[\\/]/).pop() ?? 'style.css'}`
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `const pluginId = ${JSON.stringify(PACKAGE_ID)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        '  tag.dataset.plugin = pluginId;',
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export default undefined;',
      ].join('\n')
    },
  }
}

const bundle = clientBundle(PACKAGE_ID, ['lib/types/index.js', 'lib/types/invariant.js'])

export default (inlineConfig: Parameters<typeof bundle>[0]): ReturnType<typeof bundle> =>
  bundle(inlineConfig).map((config) => config.name === `${PACKAGE_ID}/client`
    ? { ...config, plugins: [...(config.plugins ?? []), monacoCssInlinePlugin()] }
    : config)
