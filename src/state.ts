import { LambPage } from "./page"
import { LambScope } from "./scope"
import { LambConfig } from "./config"

export interface LambState {
  /**
   * Config associated with this state.
   */
  readonly config: LambConfig

  /**
   * Map of all currently processed lamb pages.
   */
  filecache: Record<string, LambPage>

  /**
   * Map of all currently processed lamb scopes.
   */
  scopecache: Record<string, LambScope>
}
