-- UNAPPLIED. Offline history core only; runtime schema/version acceptance and
-- migration authorization require separate review. Existing schema is untouched.
CREATE TABLE history_repositories (
  repo TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  normalized_bytes INTEGER NOT NULL CHECK(normalized_bytes >= 0 AND normalized_bytes <= 12582912)
);
CREATE TABLE history_commits (
  repo TEXT NOT NULL REFERENCES history_repositories(repo),
  sha TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(repo,sha)
);
CREATE TABLE history_anchors (
  repo TEXT NOT NULL REFERENCES history_repositories(repo),
  anchor_key TEXT NOT NULL,
  generation TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(repo,anchor_key),
  UNIQUE(repo,generation)
);
CREATE TABLE history_frames (
  repo TEXT NOT NULL REFERENCES history_repositories(repo),
  frame_key TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  -- UTF-8-safe boundaries may shorten a chunk by three bytes; a maximum-size
  -- 512KiB frame can therefore need a ninth chunk.
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 9),
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 1 AND 524288),
  payload_hash TEXT NOT NULL,
  PRIMARY KEY(repo,frame_key)
);
CREATE TABLE history_frame_chunks (
  repo TEXT NOT NULL,
  frame_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 8),
  payload TEXT NOT NULL,
  PRIMARY KEY(repo,frame_key,ordinal),
  FOREIGN KEY(repo,frame_key) REFERENCES history_frames(repo,frame_key)
);
CREATE TABLE history_batches (
  repo TEXT NOT NULL REFERENCES history_repositories(repo),
  batch_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  anchor_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(repo,batch_id),
  UNIQUE(repo,anchor_key,action_id)
);
-- A failed comparison MUST throw inside D1Database.batch, not report changes=0
-- after unrelated facts/cursor writes have already committed.
CREATE TABLE history_append_guards (
  repo TEXT PRIMARY KEY,
  accepted INTEGER NOT NULL CHECK(accepted = 1)
);
