export * from "./ports.js";
export * from "./errors.js";
export type { SearchProvider, SearchOptions, SearchOutcome } from "./search/types.js";
export { YepApiClient, type YepApiConfig, DEFAULT_LOCATION_CODE } from "./search/yepapi.js";
export { CseClient, type CseConfig } from "./search/cse.js";
export { buildQueries, type PlannedQuery, type QueryKind } from "./queries/templates.js";
export { applyAllowlist, normalizeDomain, isSameOrSubdomain } from "./enrich/allowlist.js";
export { assertUrlIsFetchable, blockedIpReason } from "./enrich/ssrf.js";
export {
  PageFetcher,
  createStealthBudget,
  type FetcherOptions,
  type FetchManyOptions,
  type FetchManyResult,
  type StealthBudget,
} from "./enrich/fetch.js";
export { StealthScraper, type StealthConfig } from "./enrich/stealth.js";
export { htmlToText, extractTitle } from "./enrich/html.js";
export { SpiderScraper, parseSpiderResponse, type SpiderConfig } from "./enrich/spider.js";
export type { ScrapeProvider, ScrapeResult } from "./enrich/scrape.js";
export {
  GeminiClassifier,
  DEFAULT_CLASSIFIER_MODEL,
  type Classifier,
  type ClassifierResult,
} from "./classify/gemini.js";
export { verifyEvidence, isProbative } from "./classify/verify.js";
export { severityFor, priorScore, severityLabel, SEVERITY_BANDS } from "./score/index.js";
export { runScan, type RunScanOptions } from "./scan.js";
export {
  UsptoClient,
  parseTsdr,
  normalizeRegNumber,
  type RegistrationRecord,
} from "./rights/uspto.js";
export {
  RdapClient,
  RdapError,
  parseRdapDomain,
  parseRdapIp,
  registrableDomain,
  resolveIpv4,
  type RdapConfig,
  type RdapContact,
  type RdapDomainRecord,
  type RdapIpRecord,
} from "./enrich/rdap.js";
export {
  capturePage,
  sha256Of,
  artifactOf,
  jsonArtifact,
  type CaptureOptions,
  type CaptureResult,
  type EvidenceArtifact,
} from "./evidence/capture.js";
export {
  buildEvidenceBundle,
  EVIDENCE_FORMAT_VERSION,
  type BundleInput,
  type EvidenceBundle,
  type EvidenceManifest,
} from "./evidence/bundle.js";
export {
  resolveChannel,
  noticeKindFor,
  knownPlatforms,
  type ChannelDecision,
  type ChannelRoute,
  type NoticeKind,
  type ResolveChannelInput,
  type SubmissionMethod,
  type TakedownChannel,
} from "./takedown/channels.js";
export {
  renderNotice,
  prepareForSubmission,
  APPROVER_PLACEHOLDER,
  requiredStatementsFor,
  missingRequiredStatements,
  unresolvedPlaceholders,
  type EvidenceCitation,
  type NoticeContext,
  type RenderedNotice,
  type PreparedNotice,
  type RightsCitation,
  type Signatory,
} from "./takedown/templates.js";
export {
  GeminiDescriber,
  DEFAULT_DESCRIBER_MODEL,
  sanitizeDescription,
  fallbackDescription,
  type DescribeInput,
  type NoticeDescriber,
} from "./takedown/describe.js";
