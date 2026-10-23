import "./setup.ts";
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";
import * as taxonomyNs from "@aihot/industry/taxonomy";

// Explicit process-local campus/synthetic topic fixture (no production topics).
// Design: blcu school, test-college synthetic institutions (with Latin aliases for word-boundary retention),
// student-direction tags, academic notice genre.
// Import this module FIRST in each owned test file.

const TOPICS_JSON_PATH = path.resolve("industry/topics.json");

const FIXTURE = {
  groups: [
    { key: "company", name: "机构与部门", blurb: "按官方部门追踪公告" },
    { key: "field", name: "通知类型", blurb: "按教务、奖助、活动、服务等" },
    { key: "genre", name: "受众与形态", blurb: "按年级、留学生、指南等" }
  ],
  topics: [
    {
      slug: "blcu",
      name: "北京语言大学",
      group: "company" as const,
      entityId: "blcu",
      definition: "北京语言大学校园公告与通知",
      aliases: ["北语", "BLCU"]
    },
    {
      slug: "testcollege",
      name: "Test College",
      group: "company" as const,
      entityId: "testcollege",
      definition: "synthetic test institution for membership and lists",
      aliases: ["Test College", "TestCol", "TC"]
    },
    {
      slug: "testmeta",
      name: "TestMeta",
      group: "company" as const,
      entityId: "testmeta",
      definition: "synthetic for latin word-boundary tests (Metadata semantics)",
      aliases: ["TestMeta", "TM"]
    },
    {
      slug: "testwithdraw",
      name: "Test Withdrawal",
      group: "company" as const,
      entityId: "testwithdraw",
      definition: "synthetic institution isolated to withdrawal cases"
    },
    {
      slug: "student",
      name: "学生方向",
      group: "field" as const,
      tags: ["本科生"],
      definition: "学生方向相关通知"
    },
    {
      slug: "notice",
      name: "学术通知",
      group: "genre" as const,
      tags: ["校园资讯"],
      definition: "学术通知与校园资讯类"
    },
    {
      slug: "synthetic",
      name: "Synthetic Campus",
      group: "genre" as const,
      tags: ["留学生"],
      definition: "synthetic empty topic for cursor/empty tests"
    }
  ]
};

const fixtureEntities = {
  testcollege: { name: "Test College", displayTag: null, aliases: ["Test College", "TestCol", "TC"], orgNames: ["Test College Team", "Former Test College"], otherNames: ["Test College Assistant"] },
  testmeta: { name: "TestMeta", displayTag: null, aliases: ["TestMeta", "TM"], otherNames: ["TestMeta Assistant"] },
  testwithdraw: { name: "Test Withdrawal", displayTag: null, aliases: ["Test Withdrawal"] }
};
const entities = taxonomyNs.ENTITIES as Record<string, unknown>;
const originalEntities: Record<string, unknown> = {};
for (const [key, value] of Object.entries(fixtureEntities)) {
  originalEntities[key] = entities[key];
  entities[key] = value;
}

const originalReadFileSync = fs.readFileSync;

// Precise mock: ONLY the exact normalized path. Short lived: restored immediately after dynamic import.
const readFileSyncMock = mock.method(fs, "readFileSync", (file: string | Buffer | URL, options?: unknown) => {
  const p = String(file);
  if (p === TOPICS_JSON_PATH) {
    return JSON.stringify(FIXTURE);
  }
  return (originalReadFileSync as (file: string | Buffer | URL, options?: unknown) => string | Buffer).call(fs, file, options);
});

syncBuiltinESMExports();

let topics: Awaited<typeof import("@aihot/backend/publication/topics")>;
try {
  // Dynamic only for load boundary; restore own mock immediately in finally (no global restoreAll, no long-lived mock).
  topics = await import("@aihot/backend/publication/topics");
} finally {
  readFileSyncMock.mock.restore();
  syncBuiltinESMExports();
}




// Re-exports for the migrated tests (so they import symbols from the fixture helper, not directly).
export const {
  TOPICS,
  TOPIC_GROUPS,
  findTopic,
  topicLinks,
  topicBrowseLinks,
  topicMembership,
  listTopicSummaries,
  topicPageCounts,
  loadTopicPage,
  topicsOfStory,
  TOPIC_PAGE_SIZE
} = topics;

/** Restore only this fixture's synthetic entities; the file mock is already restored. */
export function restoreTopicFixtures() {
  for (const [key, value] of Object.entries(originalEntities)) {
    if (value === undefined) delete entities[key];
    else entities[key] = value;
  }
}
