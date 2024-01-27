import { promises as fs, existsSync as exists } from "node:fs"
import path from "node:path"

import { LambConfig } from "./config.ts"
import { LambPage, makePage } from "./page.ts"

/**
 * A scope is essentially a directory. It can have a layout, and a
 * parent scope. If there is not parent scope, it is the root scope.
 */
export interface LambScope {
  /**
   * Path to the scope.
   */
  path: string

  /**
   * Name of the scope.
   */
  name: string

  /**
   * Reference to root scope.
   */
  root: LambScope

  /**
   * Parent scope. Optional.
   */
  parent?: LambScope

  /**
   * Layout page data. Optional.
   */
  layout?: LambPage

  /**
   * Children scopes. Not pages.
   */
  children: Record<string, LambScope>

  /**
   * Children pages. Not scopes.
   * Excludes the layout.
   */
  pages: LambPage[]
}

/**
 * Recursive function for rendering a scope.
 */
export async function renderScope(
  config: LambConfig,
  scope: LambScope,
  outdir: string
) {
  // Render the pages first.
  for (const page of scope.pages) {
    const bodyContents = await page.renderer({ page, config })

    const wrappedContents =
      scope.layout !== undefined
        ? await scope.layout.renderer({ page, config }, bodyContents)
        : bodyContents

    let finalContents = wrappedContents
    let currentParent = scope.parent
    while (currentParent) {
      finalContents =
        currentParent.layout !== undefined
          ? await currentParent.layout.renderer({ page, config }, finalContents)
          : finalContents
      currentParent = currentParent.parent
    }

    await fs.writeFile(
      path.join(outdir, `${page.slug}.html`),
      finalContents,
      "utf-8"
    )
  }

  // Render all children.
  for (const [subscopeName, subscope] of Object.entries(scope.children)) {
    const subscopeOutdir = path.join(outdir, subscopeName)
    await fs.mkdir(subscopeOutdir)
    await renderScope(config, subscope, subscopeOutdir)
  }
}

export async function makeScope(
  config: LambConfig,
  pathToScope: string,
  root?: LambScope,
  parent?: LambScope
) {
  const parsed = path.parse(pathToScope)

  const scope = { parent, path: pathToScope } as LambScope
  scope.root = root ?? scope

  let name = parsed.name
  let layout: LambPage | undefined = undefined
  const children: Record<string, LambScope> = {}
  const pages: LambPage[] = []

  // Check if layout exists.
  const layoutNames = [
    "_layout.html",
    "_layout.js",
    "_layout.jsx",
    "_layout.ts",
    "_layout.tsx",
  ]
  for (const layoutName of layoutNames) {
    const layoutPath = path.join(pathToScope, layoutName)
    if (exists(layoutPath)) {
      layout = await makePage(config, layoutPath)
    }
  }
  scope.layout = layout

  // Start hammering away at contents.
  for (const subpath of await fs.readdir(pathToScope)) {
    if (!subpath.startsWith("_")) {
      const fullpath = path.join(pathToScope, subpath)
      const subparsed = path.parse(fullpath)
      const stats = await fs.lstat(fullpath)
      if (stats.isDirectory()) {
        // Make scope.
        children[subparsed.name] = await makeScope(
          config,
          fullpath,
          root,
          scope
        )
      } else {
        // Make page.
        pages.push(await makePage(config, fullpath))
      }
    }
  }
  scope.children = children
  scope.pages = pages

  scope.name = name
  return scope
}
