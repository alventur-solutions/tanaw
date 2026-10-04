# Tasks: IoT Station Ingest

Status: draft
Traces: requirements.md, design.md

Each task has a clear objective, the requirements it covers, and a demo: a
concrete outcome you can observe when the task is done. Checkboxes mark progress.

## Task 1: Ingest endpoint on the FastAPI backend

- [x] Add `POST /ingest` that validates the reading and writes to Neon.
- Covers: FR1, FR2, FR4, FR6; D1
- Files: `api/ingest.py`, `api/main.py`
- Demo: Posting a valid river reading returns 201 and the row appears in
  Neon `station_readings`.
- Status: done. Verified earlier: 201 response, row read back from Neon.

## Task 2: Auto-register unknown stations

- [x] Upsert `stations` on first contact so a new device needs no manual insert.
- Covers: FR3; data model
- Files: `api/ingest.py`
- Demo: Posting with a new `station_id` creates a row in `stations`.
- Status: done. Verified: `stations` row created with a point geometry.

## Task 3: Optional bearer-token auth

- [x] Reject requests without a matching token when `station_token` is set.
- Covers: FR5, NFR2
- Files: `api/ingest.py`, `api/config.py`
- Demo: With a token configured, a wrong token returns 401.
- Status: done. Verified: wrong token returned 401.

## Task 4: Firmware posts to the ingest endpoint

- [x] Send schema-matching JSON; select client by URL scheme; add timeouts.
- [x] Move the water sensor to GPIO34 (ADC1) so it reads while WiFi is on.
- [x] Set the upload interval to 60 s for cost efficiency.
- Covers: FR1, NFR1, NFR3, NFR4; D2, D3
- Files: `iot/firmware/src/main.cpp`, `iot/firmware/src/config.example.h`
- Demo: `pio run -d iot/firmware` builds; serial shows `POST ... -> 201`.
- Status: firmware builds and compiles. End-to-end 201 from the device pending a
  reachable public endpoint and sensor wiring/calibration.

## Task 5: Decide and wire the public endpoint (OQ1)

- [ ] Confirm whether ingest is served by the API Lambda (FastAPI container) or a
  dedicated IoT Lambda, and point the firmware `SERVER_URL` at the live HTTPS URL.
- Covers: NFR3; D1, D2; resolves OQ1
- Files: `infra/lambdas.tf`, `iot/firmware/src/config.h` (local, gitignored)
- Demo: From a device on another network, a POST to the public HTTPS URL returns
  201 and the row lands in Neon.
- Status: pending. The repo has no IoT Lambda handler; `/ingest` exists only as a
  FastAPI route. Needs an owner decision.

## Task 6: Resolve the duplicate ingest path (OQ3)

- [ ] Keep `iot/server/receiver.py` as a documented offline fallback, or remove it.
- Covers: clarity; resolves OQ3
- Files: `iot/server/receiver.py`, `iot/README.md`
- Demo: README states one primary path (FastAPI to Neon) and the role, if any, of
  the SQLite receiver.
- Status: pending owner decision.

## Task 7: Tests for the ingest endpoint

- [ ] Add tests covering 201 insert, auto-register, 401 on bad token, and the
  (station_id, ts) upsert, using the existing offline test pattern.
- Covers: AC1-AC4
- Files: `tests/test_ingest.py`
- Demo: `pytest -q` passes with the new ingest tests included.
- Status: pending.

## Task 8: Confirm no secrets are committed

- [ ] Verify `.env`, `config.h`, certs, and the local DB are gitignored.
- Covers: AC5, NFR2
- Files: `.gitignore`
- Demo: `git status` shows none of these files as tracked or staged.
- Status: partially verified; `.env` and `config.h` confirmed gitignored earlier.
