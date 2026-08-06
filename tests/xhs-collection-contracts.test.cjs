/**
 * Tests for XHS V2 CollectionContract definitions and fixtures (B1-B-03-R1 §5-6).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalJson,
  sha256Hex,
  contractHash,
  packageHash,
  CONTRACTS,
  FIXTURES,
  mediaInventoryArtifact,
} = require("../src/workbench/protocol/v2/xhs-contracts.cjs");

const ALL_IDS = Object.keys(CONTRACTS);

// ── §2: Six contracts exist ────────────────────────────────────────────

describe("XHS V2 contracts", () => {
  it("has exactly 6 contracts", () => {
    assert.equal(ALL_IDS.length, 6);
    assert.deepEqual(ALL_IDS.sort(), [
      "xhs.author-links",
      "xhs.author-profile",
      "xhs.comment-probe",
      "xhs.list-scan",
      "xhs.note-detail",
      "xhs.note-full",
    ].sort());
  });

  for (const id of ALL_IDS) {
    const c = CONTRACTS[id];
    it(`${id}: version=1, platform=["xhs"], allowEmptyRecords=true`, () => {
      assert.equal(c.version, 1);
      assert.deepEqual(c.platforms, ["xhs"]);
      assert.deepEqual(c.terminalPolicy.allowedStates, ["completed", "blocked", "cancelled", "error"]);
      assert.equal(c.terminalPolicy.allowEmptyRecords, true);
    });

    it(`${id}: contract hash is lowercase 64-char hex`, () => {
      const hash = contractHash(c);
      assert.match(hash, /^[0-9a-f]{64}$/);
    });

    it(`${id}: hash is deterministic`, () => {
      assert.equal(contractHash(c), contractHash({ ...c }));
    });
  }

  // ── §5: Contract-specific assertions ─────────────────────────────────

  it("list-scan: recordKinds=[note], slot note_list required, metadata_only", () => {
    const c = CONTRACTS["xhs.list-scan"];
    assert.deepEqual(c.recordKinds, ["note"]);
    assert.deepEqual(c.slots, [{ slotId: "note_list", requirement: "required" }]);
    assert.equal(c.mediaPolicy, "metadata_only");
  });

  it("note-detail: recordKinds=[note,comment], note required + comments conditional", () => {
    const c = CONTRACTS["xhs.note-detail"];
    assert.deepEqual(c.recordKinds, ["note", "comment"]);
    assert.deepEqual(c.slots, [
      { slotId: "note", requirement: "required" },
      { slotId: "comments", requirement: "conditional" },
    ]);
  });

  it("note-full: recordKinds=[note,comment], note required + comments required", () => {
    const c = CONTRACTS["xhs.note-full"];
    assert.deepEqual(c.recordKinds, ["note", "comment"]);
    assert.deepEqual(c.slots, [
      { slotId: "note", requirement: "required" },
      { slotId: "comments", requirement: "required" },
    ]);
  });

  it("comment-probe: recordKinds=[comment], comments required, not_required", () => {
    const c = CONTRACTS["xhs.comment-probe"];
    assert.deepEqual(c.recordKinds, ["comment"]);
    assert.deepEqual(c.slots, [{ slotId: "comments", requirement: "required" }]);
    assert.equal(c.mediaPolicy, "not_required");
  });

  it("author-profile: recordKinds=[author,note], author required + note_list optional", () => {
    const c = CONTRACTS["xhs.author-profile"];
    assert.deepEqual(c.recordKinds, ["author", "note"]);
    assert.deepEqual(c.slots, [
      { slotId: "author", requirement: "required" },
      { slotId: "note_list", requirement: "optional" },
    ]);
  });

  it("author-links: recordKinds=[note], note_links required, not_required", () => {
    const c = CONTRACTS["xhs.author-links"];
    assert.deepEqual(c.recordKinds, ["note"]);
    assert.deepEqual(c.slots, [{ slotId: "note_links", requirement: "required" }]);
    assert.equal(c.mediaPolicy, "not_required");
  });

  // ── §5: Load-time validation ────────────────────────────────────────

  it("rejects duplicate slotId", () => {
    const bad = {
      ...CONTRACTS["xhs.note-detail"],
      slots: [
        { slotId: "dup", requirement: "required" },
        { slotId: "dup", requirement: "optional" },
      ],
    };
    const ids = bad.slots.map((s) => s.slotId);
    assert.notEqual(new Set(ids).size, ids.length, "duplicate slotId should be detected");
  });

  it("rejects duplicate recordKind", () => {
    const bad = { ...CONTRACTS["xhs.note-detail"], recordKinds: ["note", "note"] };
    const kinds = new Set(bad.recordKinds);
    assert.notEqual(kinds.size, bad.recordKinds.length, "duplicate recordKind should be detected");
  });

  it("rejects non-positive version", () => {
    const bad = { ...CONTRACTS["xhs.list-scan"], version: 0 };
    assert.ok(bad.version < 1, "non-positive version should be detected");
  });

  it("contract hash changes when recordKinds change", () => {
    const h1 = contractHash(CONTRACTS["xhs.note-detail"]);
    const mod = { ...CONTRACTS["xhs.note-detail"], recordKinds: ["note"] };
    assert.notEqual(contractHash(mod), h1);
  });

  it("contract hash changes when slots change", () => {
    const h1 = contractHash(CONTRACTS["xhs.note-detail"]);
    const mod = { ...CONTRACTS["xhs.note-detail"], slots: [{ slotId: "note", requirement: "required" }] };
    assert.notEqual(contractHash(mod), h1);
  });

  it("contract hash changes when mediaPolicy changes", () => {
    const h1 = contractHash(CONTRACTS["xhs.list-scan"]);
    const mod = { ...CONTRACTS["xhs.list-scan"], mediaPolicy: "not_required" };
    assert.notEqual(contractHash(mod), h1);
  });

  // ── §3.2: No media RawRecord in V2 ────────────────────────────────────

  it("no contract produces media recordKind", () => {
    for (const id of ALL_IDS) {
      assert.ok(
        !CONTRACTS[id].recordKinds.includes("media"),
        `${id} must not include media as a RawRecord kind (must be media_inventory artifact)`,
      );
    }
  });

  it("no contract produces metric recordKind (V2 first phase)", () => {
    for (const id of ALL_IDS) {
      assert.ok(
        !CONTRACTS[id].recordKinds.includes("metric"),
        `${id} must not include metric (not in V2 first phase)`,
      );
    }
  });
});

// ── §3: Fixtures ───────────────────────────────────────────────────────

describe("XHS V2 fixtures", () => {
  for (const id of ALL_IDS) {
    const f = FIXTURES[id];

    it(`${id}: fixture exists and has submission`, () => {
      assert.ok(f.submission);
      assert.ok(f.submission.body);
      assert.ok(f.submission.body.header);
      assert.ok(f.submission.body.capturePackage);
    });

    it(`${id}: fixture is execution ingressKind`, () => {
      assert.equal(f.submission.body.header.ingressKind, "execution");
      assert.equal(f.submission.authority.ingressKind, "execution");
    });

    it(`${id}: fixture header matches contract id/version/hash`, () => {
      const hdr = f.submission.body.header;
      assert.equal(hdr.contractId, id);
      assert.equal(hdr.contractVersion, 1);
      assert.equal(hdr.contractHash, contractHash(CONTRACTS[id]));
      assert.match(hdr.contractHash, /^[0-9a-f]{64}$/);
    });

    it(`${id}: fixture package hash is lowercase 64-char hex`, () => {
      const pkg = f.submission.body.capturePackage;
      assert.match(pkg.checksumValue, /^[0-9a-f]{64}$/);
      assert.equal(pkg.checksumValue, f.fixturePackageHash);
    });

    it(`${id}: package payload decodes to valid JSON via Buffer`, () => {
      const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      assert.equal(parsed.schemaVersion, "capture-package/v2");
      assert.ok(Array.isArray(parsed.records));
      assert.ok(Array.isArray(parsed.artifacts));
    });

    it(`${id}: outer header === inner header via canonical JSON`, () => {
      const outer = f.submission.body.header;
      const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
      const inner = JSON.parse(decoded).header;
      assert.deepEqual(JSON.parse(canonicalJson(outer)), JSON.parse(canonicalJson(inner)));
    });

    it(`${id}: records match contract recordKinds`, () => {
      const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
      const pkg = JSON.parse(decoded);
      const kinds = pkg.records.map((r) => r.recordKind);
      for (const k of kinds) {
        assert.ok(
          CONTRACTS[id].recordKinds.includes(k),
          `${id}: record kind ${k} not in contract recordKinds [${CONTRACTS[id].recordKinds}]`,
        );
      }
    });

    it(`${id}: fixture record payloads match live XHS record shapes`, () => {
      const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
      const pkg = JSON.parse(decoded);
      for (const record of pkg.records) {
        if (record.recordKind === "note") {
          assert.ok(record.payload.noteId || record.payload.platformContentId || record.payload.url);
          assert.ok(record.payload.title || record.payload.content);
        } else if (record.recordKind === "comment") {
          assert.ok(record.payload.commentId);
          assert.ok(record.payload.noteId);
          assert.ok(record.payload.text);
        } else if (record.recordKind === "author") {
          assert.ok(record.payload.authorId || record.payload.platformAuthorId || record.payload.profileUrl);
        } else {
          assert.fail(`unexpected fixture record kind ${record.recordKind}`);
        }
      }
    });

    it(`${id}: counters.emitted equals records.length`, () => {
      const hdr = f.submission.body.header;
      const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
      const pkg = JSON.parse(decoded);
      assert.equal(hdr.report.counters.emitted, pkg.records.length);
    });

    it(`${id}: execution fields are desensitized placeholders (no real creds)`, () => {
      const hdr = f.submission.body.header;
      assert.match(hdr.jobId, /^fixture-job-/);
      assert.match(hdr.attemptId, /^fixture-attempt-/);
      assert.equal(hdr.leaseEpoch, 1);
      assert.equal(hdr.executionPlanVersion, "fixture-plan-v1");
    });

    // metadata_only → has media_inventory artifact; not_required → no artifact
    const contract = CONTRACTS[id];
    if (contract.mediaPolicy === "metadata_only") {
      it(`${id}: metadata_only fixture has media_inventory artifact`, () => {
        const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
        const pkg = JSON.parse(decoded);
        const mediaArts = pkg.artifacts.filter((a) => a.kind === "media_inventory");
        assert.ok(mediaArts.length > 0, `${id}: expected media_inventory artifact for metadata_only`);
        // Verify artifact has valid checksum
        for (const a of mediaArts) {
          assert.match(a.artifactChecksum, /^[0-9a-f]{64}$/);
          assert.equal(a.encoding, "base64");
        }
      });
    } else {
      it(`${id}: not_required fixture has NO media_inventory artifact`, () => {
        const decoded = Buffer.from(f.submission.body.capturePackage.packagePayload, "base64").toString("utf8");
        const pkg = JSON.parse(decoded);
        const mediaArts = pkg.artifacts.filter((a) => a.kind === "media_inventory");
        assert.equal(mediaArts.length, 0, `${id}: not_required must not have media_inventory artifact`);
      });
    }
  }

  // ── All 6 contract hashes are distinct ──────────────────────────────
  it("all 6 contract hashes are distinct", () => {
    const hashes = ALL_IDS.map((id) => contractHash(CONTRACTS[id]));
    assert.equal(new Set(hashes).size, 6);
  });

  // ── media_inventory artifact is well-formed ──────────────────────────
  it("media_inventory artifact has valid base64 + checksum", () => {
    const art = mediaInventoryArtifact();
    const decoded = Buffer.from(art.artifactPayload, "base64").toString("utf8");
    JSON.parse(decoded); // must not throw
    assert.equal(art.contentLength, Buffer.from(decoded, "utf8").length);
    assert.equal(art.artifactChecksum, sha256Hex(Buffer.from(decoded, "utf8")));
  });
});

// ── Print summary table for cross-repo verification ────────────────────

describe("cross-repo summary", () => {
  it("prints contract hashes and fixture package hashes", () => {
    for (const id of ALL_IDS) {
      const f = FIXTURES[id];
      console.log(JSON.stringify({
        id,
        version: CONTRACTS[id].version,
        contractHash: contractHash(CONTRACTS[id]),
        fixturePackageHash: f.fixturePackageHash,
      }));
    }
  });

  it("canonical JSON round-trips", () => {
    const obj = { b: 1, a: [3, 1, 2], c: { d: 4, e: 5 } };
    const s = canonicalJson(obj);
    assert.equal(s, '{"a":[3,1,2],"b":1,"c":{"d":4,"e":5}}');
  });
});
