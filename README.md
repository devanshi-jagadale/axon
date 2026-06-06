# Axon — Event Delivery Engine

> One signal. Many receivers.

A lightweight pub-sub event delivery system built from scratch. Producers publish events to named topics; multiple subscribers receive them asynchronously with persistent queuing, priority-based scheduling, concurrent delivery workers with atomic message claiming, exponential backoff retry, and a dead letter queue for failed deliveries.

**Live Demo**
-`https://axon-iota-six.vercel.app/`

---

## The Scenario — EdTech Event Fanout

When a student submits an exam on an LMS platform, a single `exam.submitted` event needs to trigger 4 downstream services simultaneously:

```
Student submits exam
        │
        ▼
   POST /publish  { priority: "high" }
        │
        ▼
    [ AXON ]
        │
   ┌────┴─────────────────────────────────┐
   │            Fan-out                    │
   ▼            ▼            ▼            ▼
grade-      notify-     leaderboard-  certificate-
service     service      service       service
(scores     (emails      (rankings     (generates
 exam)       student)     updated)      PDF cert)
```

Each service receives the event independently. If `notify-service` is temporarily down, Axon retries it with exponential backoff — without affecting the other three. Failed deliveries after max retries land in the Dead Letter Queue for manual inspection and retry.

This pattern decouples the exam submission flow from all downstream side effects — the student's submit returns instantly regardless of what any downstream service is doing.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      AXON BACKEND                         │
│                                                           │
│   REST API (FastAPI)                                      │
│   ┌──────────┐  ┌───────────┐  ┌──────────────────────┐ │
│   │  /topics │  │ /subscribe│  │ /publish {priority}   │ │
│   └──────────┘  └───────────┘  └──────────┬───────────┘ │
│                                            │              │
│                                      SQLite DB (WAL)      │
│                                   messages table          │
│                                   priority_order column   │
│                                   claimed_at column       │
│                                            │              │
│   Concurrent Worker Pool (3 threads)       │              │
│   ┌────────────────────────────────────────┘              │
│   │  worker-1 ─┐                                          │
│   │  worker-2 ─┼─► ORDER BY priority_order, next_retry_at│
│   │  worker-3 ─┘   atomic claim via claimed_at            │
│   │                HTTP POST → subscriber URL             │
│   │                exponential backoff on failure         │
│   │                → DLQ after max retries                │
│   └───────────────────────────────────────────────────────│
└──────────────────────────────────────────────────────────┘
         │                │               │
         ▼                ▼               ▼
   grade-service   notify-service   leaderboard-service
   :8001/webhook   :8002/webhook    :8003/webhook
```

### Key Design Decisions

**Per-subscriber message rows** — Each publish creates one DB row per subscriber, not one row per event. Each subscriber has its own independent status, retry count, and delivery timeline. One slow subscriber cannot block another.

**Priority-based scheduling** — Publishers set `priority: high | normal | low`. Stored as a `priority_order` integer (0/1/2) so the worker's `ORDER BY priority_order ASC` always surfaces urgent messages first, regardless of arrival time.

**Concurrent workers with atomic claiming** — 3 worker threads deliver in parallel. To prevent double-delivery, each worker atomically sets `claimed_at = now WHERE claimed_at IS NULL` before processing. Only the thread that wins the race can deliver that row — guaranteed by SQLite's WAL-mode serialised writes.

**SQLite with WAL mode** — WAL (Write-Ahead Logging) allows concurrent readers alongside a single writer, making it safe for multiple worker threads to read the queue simultaneously while one commits a claim update.

**Exponential backoff** — Retries are scheduled at 2s → 4s → 8s intervals (`2^(retry+1)`). This avoids hammering a struggling downstream service and gives it time to recover.

**Polling over persistent connections** — A polling loop (every 3s) gives deterministic, debuggable delivery with zero connection-state management. For event-driven fanout where seconds of latency are acceptable, this is operationally simpler than maintaining persistent WebSocket connections across worker threads.

---

## Tech Stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Backend   | Python, FastAPI, SQLite (WAL mode)      |
| Workers   | Python `threading` — 3 concurrent daemons |
| Frontend  | React, Vite, TanStack Query             |
| Deploy    | Render (backend), Vercel (frontend)     |

---

## API Reference

### Topics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/topics` | Create a topic |
| `GET` | `/topics` | List all topics |
| `DELETE` | `/topics/{name}` | Delete a topic |

```json
POST /topics
{ "name": "exam.submitted" }
```

### Subscribers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/subscribe` | Register a subscriber |
| `GET` | `/subscribers/{topic}` | List subscribers for a topic |

```json
POST /subscribe
{
  "topic_name": "exam.submitted",
  "subscriber_name": "grade-service",
  "url": "https://your-service.com/webhook"
}
```

### Publishing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/publish` | Publish an event to a topic |

```json
POST /publish
{
  "topic_name": "exam.submitted",
  "priority": "high",
  "payload": {
    "student_id": "S001",
    "exam": "DSA Final",
    "score": 87
  }
}
```

`priority` is optional — defaults to `"normal"`. Returns `202 Accepted` immediately. Delivery is async.

### Messages & DLQ

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/messages/{topic}` | List messages for a topic |
| `GET` | `/messages/{topic}?status=pending` | Filter by status |
| `GET` | `/dlq` | Dead letter queue — all failed messages |
| `POST` | `/dlq/{id}/retry` | Requeue a failed message |

---

## Running Locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
# API → http://localhost:8000
# Docs → http://localhost:8000/docs
```

**Mock subscribers** (simulate 4 downstream services)
```bash
# second terminal, from backend/
python mock_subscribers.py
# grade-service       → :8001  (always succeeds)
# notify-service      → :8002  (30% fail rate — demos retry + backoff)
# leaderboard-service → :8003  (always succeeds)
# certificate-service → :8004  (always succeeds)
```

**Frontend**
```bash
cd axon-dashboard
npm install
npm run dev
# Dashboard → http://localhost:5173
```

---

## Deploying

### Backend → Render

1. New Web Service → connect repo → **Root Directory:** `backend`
2. Build: `pip install -r requirements.txt`
3. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Env var: `DB_PATH = /tmp/axon.db`

> Note: Render free tier uses ephemeral storage — DB resets on redeploy. For persistence, swap in Render's managed PostgreSQL; the worker's atomic claiming logic transfers directly to `SELECT ... FOR UPDATE SKIP LOCKED`, the standard pattern for concurrent queue workers in Postgres.

### Frontend → Vercel

1. Import repo → **Root Directory:** `axon-dashboard` → framework: Vite
2. Env var: `VITE_API_URL = https://your-axon-backend.onrender.com`
3. Deploy

---

## Message Lifecycle

```
publish { priority: high | normal | low }
  │
  ▼
PENDING (priority_order set, claimed_at = NULL)
  │
  ▼
worker-N claims row atomically (SET claimed_at = now WHERE claimed_at IS NULL)
  │
  ▼
HTTP POST → subscriber URL
  │
  ├─ success ──► status = DELIVERED ✓
  │
  └─ failure ──► retry_count++
                 next_retry_at = now + 2^(retry+1)s
                 claimed_at = NULL  (back in queue)
                      │
                 retry_count >= 3?
                 ├─ no  ──► back to PENDING after backoff
                 └─ yes ──► status = FAILED → Dead Letter Queue
                                 │
                           manual ↺ RETRY via POST /dlq/{id}/retry
                                 │
                            reset to PENDING, retry_count = 0
```

---