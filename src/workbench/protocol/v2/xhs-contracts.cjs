/**
 * XHS V2 CollectionContract canonical definitions.
 *
 * B1-B-03-R1: plugin is the source of truth.  Workbench mirrors these same
 * definitions into the CollectionContractRegistry.  Any cross-repo difference
 * in canonical JSON, contract hash, or fixture hash is a hard failure.
 *
 * Source audit (08-xhs-collection-contracts.md §1):
 *   taskLeaseClient.js:345-350  → capability → contract mapping
 *   taskPoller.js:799-837       → record types actually produced
 *   MESSAGE_PROTOCOL.md:252-285  → terminal states
 */

const crypto = require("node:crypto");

// ── Canonical JSON ─────────────────────────────────────────────────────────

/**
 * Recursively sort object keys. Returns a new value; does not mutate input.
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical JSON string: object keys sorted, arrays preserved, no whitespace.
 * Mirrors workbench src/lib/evidence/ingress/canonical-json.ts canonicalJsonString().
 */
function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

// ── SHA-256 ────────────────────────────────────────────────────────────────

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

// ── Strict Base64 ──────────────────────────────────────────────────────────

function encodeBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

// ── Contract hash ──────────────────────────────────────────────────────────

/**
 * Contract hash = sha256(UTF-8(canonicalJson(definition))).
 * Lowercase 64-char hex.  Mirrors workbench computeContractHash().
 */
function contractHash(definition) {
  return sha256Hex(canonicalJson(definition));
}

// ── Package hash ───────────────────────────────────────────────────────────

/**
 * Package hash = sha256(raw canonical JSON bytes).
 * Lowercase 64-char hex.
 */
function packageHash(canonicalPayloadJson) {
  return sha256Hex(canonicalPayloadJson);
}

// ── Base64 fixture package ─────────────────────────────────────────────────

function buildPackageSubmission(header, records, artifacts) {
  const payload = {
    schemaVersion: "capture-package/v2",
    header,
    records,
    artifacts,
  };
  const json = canonicalJson(payload);
  const bytes = Buffer.from(json, "utf8");
  return {
    encoding: "base64",
    packagePayload: encodeBase64(bytes),
    checksumAlgorithm: "sha256",
    checksumValue: packageHash(json),
    contentLength: bytes.length,
    restricted: false,
  };
}

// ── Common header fields ───────────────────────────────────────────────────

function commonHeader(contract) {
  return {
    protocolVersion: "capture-submission/v2",
    captureId: `v2-fixture-${contract.id}`,
    platform: "xhs",
    target: {
      expectedTargetKey: `xhs:fixture/${contract.id}`,
      observedTargetKey: `xhs:fixture/${contract.id}`,
    },
    observedAt: "2026-08-05T12:00:00Z",
    collectorVersion: "v2-fixture-1.0.0",
    contractId: contract.id,
    contractVersion: contract.version,
    contractHash: contractHash(contract),
    ingressKind: "execution",
    // Desensitized execution fields — no real credentials
    jobId: `fixture-job-${contract.id}`,
    attemptId: `fixture-attempt-${contract.id}`,
    leaseEpoch: 1,
    executionPlanVersion: "fixture-plan-v1",
  };
}

/**
 * Build report slots from contract slot definitions.
 * All slots are "observed" for a successful fixture.
 */
function reportSlots(contract) {
  return contract.map((slotId) => ({
    slotId,
    status: "observed",
    reason: null,
  }));
}

// ── Media inventory artifact (for metadata_only contracts) ─────────────────

function mediaInventoryArtifact() {
  const payload = {
    candidates: [
      { kind: "image", url: "https://sns-webpic-qc.xhscdn.com/fixture-cover", width: 1080, height: 1440 },
      { kind: "image", url: "https://sns-webpic-qc.xhscdn.com/fixture-img-1", width: 1080, height: 1440 },
    ],
  };
  const json = canonicalJson(payload);
  const bytes = Buffer.from(json, "utf8");
  return {
    kind: "media_inventory",
    encoding: "base64",
    artifactPayload: encodeBase64(bytes),
    artifactChecksum: sha256Hex(bytes),
    contentLength: bytes.length,
    restricted: false,
  };
}

/**
 * Fixture payloads use the same stable identity/body fields that the live
 * taskPoller sanitizers and recordPayloadValidator accept.  These are
 * desensitized values, but they must still be source-shaped rather than a
 * made-up `{ title, content }` payload for every record kind.
 */
function fixtureRecordPayload(kind, contractId) {
  const suffix = contractId.replace(/[^a-z0-9-]/gi, "-");
  if (kind === "note") {
    return {
      platform: "xhs",
      noteId: `fixture-note-${suffix}`,
      platformContentId: `fixture-note-${suffix}`,
      title: `Fixture note for ${contractId}`,
      content: `Desensitized note body for V2 contract ${contractId}`,
      url: `https://www.xiaohongshu.com/explore/fixture-${suffix}`,
    };
  }
  if (kind === "comment") {
    return {
      platform: "xhs",
      commentId: `fixture-comment-${suffix}`,
      noteId: `fixture-note-${suffix}`,
      text: `Desensitized comment for V2 contract ${contractId}`,
    };
  }
  if (kind === "author") {
    return {
      platform: "xhs",
      authorId: `fixture-author-${suffix}`,
      platformAuthorId: `fixture-author-${suffix}`,
      name: `Fixture author for ${contractId}`,
      profileUrl: `https://www.xiaohongshu.com/user/profile/fixture-${suffix}`,
    };
  }
  throw new Error(`Unsupported fixture record kind: ${kind}`);
}

// ── 6 CONTRACT DEFINITIONS (08 §2) ─────────────────────────────────────────

const CONTRACTS = {
  "xhs.list-scan": {
    id: "xhs.list-scan",
    version: 1,
    platforms: ["xhs"],
    recordKinds: ["note"],
    slots: [{ slotId: "note_list", requirement: "required" }],
    terminalPolicy: {
      allowedStates: ["completed", "blocked", "cancelled", "error"],
      allowEmptyRecords: true,
    },
    mediaPolicy: "metadata_only",
  },

  "xhs.note-detail": {
    id: "xhs.note-detail",
    version: 1,
    platforms: ["xhs"],
    recordKinds: ["note", "comment"],
    slots: [
      { slotId: "note", requirement: "required" },
      { slotId: "comments", requirement: "conditional" },
    ],
    terminalPolicy: {
      allowedStates: ["completed", "blocked", "cancelled", "error"],
      allowEmptyRecords: true,
    },
    mediaPolicy: "metadata_only",
  },

  "xhs.note-full": {
    id: "xhs.note-full",
    version: 1,
    platforms: ["xhs"],
    recordKinds: ["note", "comment"],
    slots: [
      { slotId: "note", requirement: "required" },
      { slotId: "comments", requirement: "required" },
    ],
    terminalPolicy: {
      allowedStates: ["completed", "blocked", "cancelled", "error"],
      allowEmptyRecords: true,
    },
    mediaPolicy: "metadata_only",
  },

  "xhs.comment-probe": {
    id: "xhs.comment-probe",
    version: 1,
    platforms: ["xhs"],
    recordKinds: ["comment"],
    slots: [{ slotId: "comments", requirement: "required" }],
    terminalPolicy: {
      allowedStates: ["completed", "blocked", "cancelled", "error"],
      allowEmptyRecords: true,
    },
    mediaPolicy: "not_required",
  },

  "xhs.author-profile": {
    id: "xhs.author-profile",
    version: 1,
    platforms: ["xhs"],
    recordKinds: ["author", "note"],
    slots: [
      { slotId: "author", requirement: "required" },
      { slotId: "note_list", requirement: "optional" },
    ],
    terminalPolicy: {
      allowedStates: ["completed", "blocked", "cancelled", "error"],
      allowEmptyRecords: true,
    },
    mediaPolicy: "metadata_only",
  },

  "xhs.author-links": {
    id: "xhs.author-links",
    version: 1,
    platforms: ["xhs"],
    recordKinds: ["note"],
    slots: [{ slotId: "note_links", requirement: "required" }],
    terminalPolicy: {
      allowedStates: ["completed", "blocked", "cancelled", "error"],
      allowEmptyRecords: true,
    },
    mediaPolicy: "not_required",
  },
};

// These fixture blueprints are deliberately independent from CONTRACTS. They
// are the six desensitized shapes audited against the live XHS taskPoller;
// changing a contract cannot silently regenerate a matching fixture.
const FIXTURE_BLUEPRINTS = {
  "xhs.list-scan": { recordKinds: ["note"], slotIds: ["note_list"], mediaPolicy: "metadata_only" },
  "xhs.note-detail": { recordKinds: ["note", "comment"], slotIds: ["note", "comments"], mediaPolicy: "metadata_only" },
  "xhs.note-full": { recordKinds: ["note", "comment"], slotIds: ["note", "comments"], mediaPolicy: "metadata_only" },
  "xhs.comment-probe": { recordKinds: ["comment"], slotIds: ["comments"], mediaPolicy: "not_required" },
  "xhs.author-profile": { recordKinds: ["author", "note"], slotIds: ["author", "note_list"], mediaPolicy: "metadata_only" },
  "xhs.author-links": { recordKinds: ["note"], slotIds: ["note_links"], mediaPolicy: "not_required" },
};

// Contract hashes are fixed audit anchors. A contract edit must update the
// audited fixture explicitly; it may not silently move both sides together.
const EXPECTED_CONTRACT_HASHES = {
  "xhs.list-scan": "49c2054e6a441799cc07f2dfd4166b46eb4c44b2a19156c14f33f68dd10da002",
  "xhs.note-detail": "0814001c0b93ea01ff522dbc7d2a9956bfa2f8d998191c2734aad4b59c4c32c1",
  "xhs.note-full": "24d762bdd62b0a0fc188c62230cd64ee4918c9faee128fe69e8c10562abb6e51",
  "xhs.comment-probe": "448a3c36ed74be64d633e967fc15c785c1bde274ccdf464ba1e7b766c9fbc557",
  "xhs.author-profile": "cf8e0d1e5b3a4fda9fef5d290abb150e0f06973857338bced8fefa3efc367f44",
  "xhs.author-links": "bd2f28b29bc8d23877a3079962018392c1f24e055c81072e114be32e2fdb3f7a",
};

// ── 6 fixture CapturePayloadV2's ───────────────────────────────────────────

function buildFixture(contractId) {
  const contract = CONTRACTS[contractId];
  if (!contract) throw new Error(`Unknown contract: ${contractId}`);
  const blueprint = FIXTURE_BLUEPRINTS[contractId];
  if (!blueprint) throw new Error(`Missing fixture blueprint: ${contractId}`);
  const fixtureContractHash = contractHash(contract);
  if (fixtureContractHash !== EXPECTED_CONTRACT_HASHES[contractId]) {
    throw new Error(`Fixture audit anchor mismatch: ${contractId}`);
  }

  const header = commonHeader(contract);
  header.report = {
    startedAt: "2026-08-05T11:55:00Z",
    completedAt: "2026-08-05T12:00:00Z",
    terminal: { state: "completed", reason: "limit_reached", retryable: false },
    slots: reportSlots(blueprint.slotIds),
    counters: { requested: 10, discovered: 5, emitted: 3, deduplicated: 2, failed: 0 },
    diagnostics: {},
  };

  const records = [];
  let seq = 0;

  for (const kind of blueprint.recordKinds) {
    records.push({
      idempotencyKey: `fixture-${contractId}-${kind}-001`,
      recordKind: kind,
      platform: "xhs",
      targetKey: `xhs:fixture/${contractId}`,
      externalRecordId: `ext-fixture-${contractId}-${kind}`,
      sequence: seq++,
      payload: fixtureRecordPayload(kind, contractId),
      observedAt: "2026-08-05T11:58:00Z",
    });
  }
  header.report.counters.emitted = records.length;

  // Artifacts: metadata_only contracts get media_inventory; not_required get none
  const artifacts = blueprint.mediaPolicy === "metadata_only"
    ? [mediaInventoryArtifact()]
    : [];

  const body = {
    header,
    capturePackage: buildPackageSubmission(header, records, artifacts),
  };

  const authority = {
    ingressKind: "execution",
    workspaceId: "ws-fixture",
    receivedAt: new Date("2026-08-05T12:00:01Z"),
    sourcePrincipal: "fixture-agent@b1-b03-r1",
    stationId: "station-fixture",
    leaseToken: "lease-token-fixture",
  };

  const submission = { body, authority };

  return {
    contractId,
    contract,
    contractHash: contractHash(contract),
    fixtureHeader: header,
    fixturePackageHash: body.capturePackage.checksumValue,
    submission,
  };
}

const FIXTURES = {};
for (const id of Object.keys(CONTRACTS)) {
  FIXTURES[id] = buildFixture(id);
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  canonicalJson,
  sha256Hex,
  encodeBase64,
  contractHash,
  packageHash,
  buildPackageSubmission,
  mediaInventoryArtifact,
  CONTRACTS,
  FIXTURES,
};
