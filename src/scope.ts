import { promises as fs, existsSync as exists, existsSync } from "node:fs"
import path from "node:path"

import { LambConfig } from "./config.ts"
import { LambPage, createPage, renderPage } from "./page.ts"
import { LambState } from "./state.ts"

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
  state: LambState,
  scope: LambScope,
  outdir: string
) {
  // Render the pages first.
  for (const page of scope.pages) {
    const bodyContents = await renderPage(state, page, {})

    const wrappedContents =
      scope.layout !== undefined
        ? await renderPage(state, scope.layout, {}, bodyContents) //scope.layout.renderer({ page, config }, bodyContents)
        : bodyContents

    let finalContents = wrappedContents
    let currentParent = scope.parent
    while (currentParent) {
      finalContents =
        currentParent.layout !== undefined
          ? await renderPage(state, currentParent.layout, {}, finalContents) //currentParent.layout.renderer({ page, config }, finalContents)
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
    if (!existsSync(subscopeOutdir)) {
      await fs.mkdir(subscopeOutdir)
    }
    await renderScope(state, subscope, subscopeOutdir)
  }
}

interface LambScopeCreationOptions {
  path: string
  root?: LambScope
  parent?: LambScope
}

/**
 * Create (and cache) a scope. Note that this doesn't process
 * any children save for the associated `_layout`. To process
 * a scope's children, use `createScopeChildren`.
 */
export async function createScope(
  state: LambState,
  opts: LambScopeCreationOptions
) {
  const parsed = path.parse(opts.path)

  const partialScope = {
    name: parsed.name,
    path: opts.path,
    parent: opts.parent,
    children: {},
    pages: [],
  } satisfies Partial<LambScope> as Record<string, any>
  state.scopecache[opts.path] = partialScope as LambScope

  // If root isn't passed, we assume we are root.
  partialScope.root = opts.root ?? partialScope

  // Check if layout exists. Markdown layouts are not supported
  // because we assume the layout contains boilerplate html.
  const layoutNames = [
    "_layout.html",
    "_layout.js",
    "_layout.jsx",
    "_layout.ts",
    "_layout.tsx",
  ]
  for (const layoutName of layoutNames) {
    const layoutPath = path.join(opts.path, layoutName)
    if (exists(layoutPath)) {
      // TODO: Switch to createPage.
      partialScope.layout = await createPage(state, layoutPath)
    }
  }

  // Error if we are root AND there is no layout.
  if (partialScope.root === partialScope && partialScope.layout === undefined) {
    throw new Error(
      `Root layout is missing. Please create a "_layout.{html,js,jsx,ts,tsx}" file in your project root.`
    )
  }

  // Cache and return the scope.
  return partialScope as LambScope
}

export async function createScopeChildren(
  state: LambState,
  scope: LambScope,
  recursive?: boolean
) {
  // Start hammering away at contents.
  for (const subpath of await fs.readdir(scope.path)) {
    if (!subpath.startsWith("_")) {
      const fullpath = path.join(scope.path, subpath)
      const subparsed = path.parse(fullpath)
      const stats = await fs.lstat(fullpath)
      if (stats.isDirectory()) {
        scope.children[subparsed.name] = await createScope(state, {
          path: fullpath,
          root: scope.root,
          parent: scope,
        })
        if (recursive) {
          createScopeChildren(state, scope.children[subparsed.name], recursive)
        }
      } else {
        scope.pages.push(await createPage(state, fullpath, scope))
      }
    }
  }
}

export async function getScope(state: LambState, pathToScope: string) {
  const parsed = path.parse(pathToScope)
  let existingScope = state.scopecache[pathToScope]
  if (existingScope === undefined) {
    const parentScope = await getScope(state, parsed.dir)
    existingScope = await createScope(state, {
      path: pathToScope,
      parent: parentScope,
      root: parentScope.root,
    })
  }
  return existingScope
}
