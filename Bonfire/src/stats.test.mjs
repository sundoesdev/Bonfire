// Tests for the pure helpers behind the stats page.
// Run with: node --test Bonfire/src/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { formatStudyTime, studiedCards } from "./views/stats.js";

test("study time renders as H:MM:SS", () => {
  assert.equal(formatStudyTime(0), "0:00:00");
  assert.equal(formatStudyTime(1000), "0:00:01");
  assert.equal(formatStudyTime(61_000), "0:01:01");
  assert.equal(formatStudyTime(3_600_000), "1:00:00");
});

test("minutes and seconds roll over rather than exceeding 60", () => {
  // 1h 2m 3s
  assert.equal(formatStudyTime((3600 + 120 + 3) * 1000), "1:02:03");
  // 59:59 must not become 60:00
  assert.equal(formatStudyTime(3_599_000), "0:59:59");
});

test("hours are not capped or rolled into days", () => {
  assert.equal(formatStudyTime(19 * 3_600_000 + 7 * 60_000 + 41_000), "19:07:41");
  assert.equal(formatStudyTime(100 * 3_600_000), "100:00:00");
});

test("study time is never negative and rounds to the nearest second", () => {
  assert.equal(formatStudyTime(-5000), "0:00:00");
  assert.equal(formatStudyTime(1499), "0:00:01");
  assert.equal(formatStudyTime(1500), "0:00:02");
});

const stat = (shardId, reviews, totalMs = 0) => ({ shardId, reviews, totalMs, lastTs: "" });

test("studied cards are ordered by review count, then by time", () => {
  const shards = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = studiedCards([stat("a", 3, 10), stat("b", 9, 1), stat("c", 3, 99)], shards);
  assert.deepEqual(out.map((r) => r.shard.id), ["b", "c", "a"]);
});

test("review history for a deleted card is dropped rather than crashing", () => {
  // review_log rows outlive the card they describe — a tombstoned card still has
  // its history, and joining it must not produce an undefined shard.
  const out = studiedCards([stat("gone", 5), stat("here", 1)], [{ id: "here" }]);
  assert.deepEqual(out.map((r) => r.shard.id), ["here"]);
});

test("no history yields no rows", () => {
  assert.deepEqual(studiedCards([], [{ id: "a" }]), []);
});
