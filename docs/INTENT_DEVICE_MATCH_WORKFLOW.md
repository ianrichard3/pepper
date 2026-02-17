# Intent Device Match Workflow

This document explains the new routing-assist workflow:

1. User writes free text intent in Node View.
2. Frontend parses intent JSON with AI.
3. Frontend requests device ranking for that intent.
4. UI shows a floating match window with top candidates highlighted.
5. User selects devices to add.
6. Selected devices are added as normal graph nodes (no auto-cabling yet).

## Frontend Flow

### 1) Intent input in routing screen

In Node View (`NodeGraphMock`), the toolbar includes:

- free text input (`intentPrompt`)
- `Match devices` action

Code reference:
- `src/components/NodeGraphMock.vue`

### 2) Parse free text to intent JSON

Frontend calls:

- `POST /ai/intent`

API client:
- `api.parseIntent(payload)`
- `src/lib/api.ts`

Returned object is structured `Intent`:
- `task` (`record`, `reamp`, `insert`, `monitor`)
- `source` (`kind`, `device_hint`, `count`)
- `destination` (`kind`, `device_hint`, `count`)
- `chain` tags (`preamp`, `compressor`, `eq`)
- `constraints`
- `notes`

### 3) Rank devices for the parsed intent

Frontend then calls:

- `POST /api/recommendations/device-match`

API client:
- `api.matchDevicesFromIntent(payload)`
- `src/lib/api.ts`

Response includes:
- `matches`: ranked devices (score + breakdown + reasons + eligibility + port summary)
- `top_candidates`:
  - `source_device_ids`
  - `destination_device_ids`
  - `processor_device_ids_by_tag`

### 4) Floating window for match selection

A dedicated child window (`graph-intent-matches`) displays:

- ranked list
- highlighted top candidates
- default preselection = top candidates
- quick actions: select top / select all / clear

Component:
- `src/components/GraphIntentMatchesWindow.vue`

Window registration:
- `src/stores/windowManager.ts`
- `src/App.vue`

### 5) Add selected devices to graph

When user confirms selection:

- frontend receives selected device IDs
- duplicates are skipped
- each selected device is added through existing `addNodeFromTemplate` path

Why this matters:
- same behavior as manual add-node
- same persistence and node state behavior
- existing-chain lookup still runs

Implementation references:
- `src/components/NodeGraphMock.vue`

## Matching Criteria (Backend Scoring)

Backend service:
- `pepper-backend/app/services/recommendations.py`
- function: `rank_devices_for_intent`

Each device gets a score from weighted signals:

- `semantic_match`: embedding similarity between intent query and device text
- `use_match`: embedding similarity between intent query and `recommended_uses`
- `hint_match`: token overlap with source/destination `device_hint`
- `category_match`: category-role compatibility with intent role(s)
- `port_direction_match`: required IO availability for role(s)
- `chain_tag_match`: category matches requested chain tags (`preamp`/`compressor`/`eq`)
- `avoid_penalty`: similarity with `avoid_uses` (applied as negative penalty)

Current weighted formula:

- `0.24 * semantic_match`
- `0.16 * use_match`
- `0.18 * hint_match`
- `0.20 * category_match`
- `0.17 * port_direction_match`
- `0.05 * chain_tag_match`
- `- avoid_penalty`

Final score is clamped to `[0.0, 1.0]`.

## Role Eligibility Rules

Backend marks each device with:

- `is_source_candidate`
- `is_destination_candidate`
- `is_processor_candidate`

These are derived from:
- intent kinds (source/destination)
- device category
- available port directions

The frontend uses this plus `top_candidates` to highlight likely roles in the selection window.

## Current Scope and Non-Goals

Current feature scope:
- intent parsing
- device ranking
- assisted node insertion

Not included yet:
- auto-route generation
- auto-cable creation from selected devices

The user still wires cables manually after node insertion.
