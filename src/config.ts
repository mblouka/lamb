import { LambPage } from "./page"
import { LambScope } from "./scope"

/**
 * Runtime data inserted into the config.
 */
interface LambConfigRuntime {
  /**
   * Map of all currently processed lamb pages.
   */
  filecache: Record<string, LambPage>

  /**
   * Map of all currently processed lamb scopes.
   */
  scopecache: Record<string, LambScope>
}

export interface LambConfig {
  /**
   * Runtime data. Errors at load time if "runtime" is
   * defined in the configuration file.
   */
  runtime: LambConfigRuntime
}
