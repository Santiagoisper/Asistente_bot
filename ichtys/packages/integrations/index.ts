/**
 * @ichtys/integrations — lado OS del contrato con los sistemas satélite.
 */
export {
  OS_MODULES,
  moduleSummarySchema,
  moduleCounterSchema,
  moduleAlertSchema,
  type OsModule,
  type ModuleSummary,
  type ModuleCounter,
  type ModuleAlert,
} from './summary-schema'
export {
  OS_TOKEN_ISSUER,
  OS_TOKEN_TTL_SECONDS,
  OsTokenError,
  signOsToken,
  verifyOsToken,
  type OsTokenClaims,
  type OsTokenErrorCode,
} from './token'
export { MODULE_URL_ENV, SIGNING_KEY_ENV, parseModuleBaseUrl, resolveModuleBaseUrl } from './config'
export { orgConnectors, orgModuleUrl, type OrgConnector, type OrgIntegrationRow } from './org-modules'
export {
  SUMMARY_CACHE_TTL_MS,
  SUMMARY_MAX_BYTES,
  SUMMARY_TIMEOUT_MS,
  clearSummaryCache,
  fetchModuleSummary,
  type FetchSummaryDeps,
  type ModuleStatus,
  type ModuleSummaryResult,
} from './client'
export {
  CONNECTOR_CAPABILITIES,
  NO_DESTINATION,
  describeDelivery,
  hasCapability,
  type ConnectorCapability,
  type ConnectorDescriptor,
  type DeliveryRecord,
  type DeliveryStage,
  type DeliveryView,
  type ReviewState,
} from './connector'
