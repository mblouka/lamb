import { promises as fs } from "node:fs"
import path from "node:path"

/**
 * An optional configuration file that can be inserted at
 * `/lamb.config.json`. If it doesn't exist, a default configuration
 * will be used instead.
 */
export interface LambConfig {
  /**
   * Name of project.
   */
  name?: string

  /**
   * Output directory of project. Defaults to `/out`.
   */
  outdir?: string
}

export async function createConfiguration(pathToConfig: string) {
  let config: LambConfig
  try {
    config = JSON.parse(await fs.readFile(pathToConfig, "utf-8"))
  } catch {
    throw new Error(`Invalid or missing configuration at "${pathToConfig}"`)
  }
  return config
}
