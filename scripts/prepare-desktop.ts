/**
 * Materialize the dsh Web runtime and the current target's Node executable as
 * Tauri resources. The output contains no symlinks, so platform bundlers copy
 * package bytes instead of pnpm workspace links.
 */

import { existsSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const desktop = resolve(root, 'apps/desktop')
const output = resolve(root, 'apps/desktop/src-tauri/resources/backend')
const sourceNodeModules = resolve(root, 'apps/desktop/node_modules')

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function tauriBin(): string {
  return join(desktop, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri')
}

async function run(command: string, args: string[], cwd = root): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
    child.once('error', (error) => {
      reject(new Error(`prepare-desktop: failed to start ${command}: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`prepare-desktop: ${command} failed (${code === null ? `signal ${signal ?? 'unknown'}` : `exit ${String(code)}`})`))
    })
  })
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function restoreDirectDependencies(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const destination = join(output, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) throw new Error(`prepare-desktop: deployed dependency ${dependency} is missing`)
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

async function materializeLinks(): Promise<void> {
  const nodeModules = join(output, 'node_modules')
  let link = await findSymlink(nodeModules)
  while (link !== undefined) {
    const relative = link.slice(nodeModules.length + 1).split(sep)
    const binIndex = relative.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...relative.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      const source = await realpath(link)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(link, { recursive: true, force: true })
      await cp(source, link, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
    }
    link = await findSymlink(nodeModules)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--build')) {
    throw new Error(`prepare-desktop: unsupported argument ${args.find(arg => arg !== '--build') ?? ''}`)
  }

  await rm(output, { recursive: true, force: true })
  await run(pnpmBin(), [
    '--filter', '@deepseek-ai/dsh-desktop', 'deploy', '--legacy', '--prod',
    '--ignore-scripts',
    '--config.node-linker=hoisted', '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true', output,
  ])
  await rm(join(output, 'frontend'), { recursive: true, force: true })
  await rm(join(output, 'src-tauri'), { recursive: true, force: true })
  await restoreDirectDependencies()
  await materializeLinks()

  const node = join(output, process.platform === 'win32' ? 'node.exe' : 'node')
  await copyFile(process.execPath, node)
  if (process.platform !== 'win32') await chmod(node, 0o755)

  const entry = join(output, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  if (!existsSync(entry)) throw new Error(`prepare-desktop: built CLI entry is missing at ${entry}`)
  console.log(`prepare-desktop: staged ${output}`)

  if (args.includes('--build')) await run(tauriBin(), ['build'], desktop)
}

await main()
