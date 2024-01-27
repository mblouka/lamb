#!/usr/bin/env node

import { promises as fs, existsSync } from "node:fs"
import path from "node:path"

import { LambConfig, createConfiguration } from "./config"
import { createScope, createScopeChildren, renderScope } from "./scope"
import { LambState } from "./state"

async function main() {
  const args = process.argv
  args.shift() // Remove binary.
  args.shift() // Remove file.

  if (args[0] === "dev") {
    // TODO: Dev server.
  } else {
    // Did we pass a specific working directory?
    const cwd =
      args[0] !== undefined ? await fs.realpath(args[0]) : process.cwd()

    let configuration = {
      outdir: path.join(cwd, "out"),
    } as LambConfig

    // See if we have a configuration file.
    const confLocation = path.join(cwd, "lamb.config.json")
    if (existsSync(confLocation)) {
      configuration = await createConfiguration(confLocation)
    }

    // Create initial state.
    const initialState = {
      config: configuration,
      filecache: {},
      scopecache: {},
    } as LambState

    // Create the root scope.
    const rootScope = await createScope(initialState, { path: cwd })

    // Recursively create root scope children.
    await createScopeChildren(initialState, rootScope, true)

    // Render the root scope into outdir. Create outdir if it doesn't exist.
    if (!existsSync(configuration.outdir!)) {
      await fs.mkdir(configuration.outdir!)
    }
    await renderScope(initialState, rootScope, configuration.outdir!)

    // We're done!
  }
}

main().catch(console.error)
