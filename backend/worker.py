import json
import time
import threading
import httpx
from datetime import datetime, timezone

from database import get_connection, PRIORITY_ORDER

MAX_RETRIES = 3
POLL_INTERVAL = 3   # seconds between polls
TIMEOUT = 5         # seconds per delivery attempt
NUM_WORKERS = 3     # concurrent worker threads


def compute_backoff(retry_count: int) -> int:
    # 2^(retry_count+1): 2s, 4s, 8s
    return 2 ** (retry_count + 1)


def claim_messages(worker_id: int):
    """
    Atomically claim a batch of pending messages for this worker.
    Uses a UPDATE + WHERE to mark rows as claimed before another worker
    can pick them up — prevents double delivery across concurrent threads.
    Returns the claimed message rows.
    """
    conn = get_connection()
    try:
        now = datetime.now(timezone.utc).isoformat()

        # Step 1: find pending rows due for delivery, ordered by priority then time
        candidates = conn.execute(
            """
            SELECT m.id
            FROM messages m
            WHERE m.status = 'pending'
              AND m.next_retry_at <= ?
              AND m.claimed_at IS NULL
            ORDER BY m.priority_order ASC, m.next_retry_at ASC
            LIMIT 10
            """,
            (now,)
        ).fetchall()

        if not candidates:
            conn.close()
            return []

        ids = [row["id"] for row in candidates]
        placeholders = ",".join("?" * len(ids))

        # Step 2: atomically claim them — only rows still unclaimed will be updated
        conn.execute(
            f"""
            UPDATE messages
            SET claimed_at = ?
            WHERE id IN ({placeholders})
              AND claimed_at IS NULL
            """,
            (now, *ids)
        )
        conn.commit()

        # Step 3: fetch only the rows we actually claimed
        claimed = conn.execute(
            f"""
            SELECT m.id, m.payload, m.retry_count, m.priority, s.url
            FROM messages m
            JOIN subscribers s ON m.subscriber_id = s.id
            WHERE m.id IN ({placeholders})
              AND m.claimed_at = ?
            """,
            (*ids, now)
        ).fetchall()

        conn.close()
        return claimed

    except Exception as e:
        print(f"[worker-{worker_id}] claim error: {e}")
        conn.close()
        return []


def deliver_message(msg_id: int, url: str, payload: str, priority: str, worker_id: int):
    conn = get_connection()
    try:
        data = json.loads(payload)
        response = httpx.post(url, json=data, timeout=TIMEOUT)
        response.raise_for_status()

        conn.execute(
            """
            UPDATE messages
            SET status = 'delivered', claimed_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (datetime.now(timezone.utc).isoformat(), msg_id)
        )
        conn.commit()
        print(f"[worker-{worker_id}] ✓ [{priority}] msg {msg_id} delivered to {url}")

    except Exception as e:
        row = conn.execute(
            "SELECT retry_count FROM messages WHERE id = ?", (msg_id,)
        ).fetchone()

        retry_count = row["retry_count"]

        if retry_count >= MAX_RETRIES - 1:
            conn.execute(
                """
                UPDATE messages
                SET status = 'failed', claimed_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (datetime.now(timezone.utc).isoformat(), msg_id)
            )
            conn.commit()
            print(f"[worker-{worker_id}] ✗ [{priority}] msg {msg_id} failed permanently: {e}")
        else:
            next_retry_count = retry_count + 1
            backoff = compute_backoff(retry_count)
            next_retry_at = datetime.fromtimestamp(
                time.time() + backoff, tz=timezone.utc
            ).isoformat()

            conn.execute(
                """
                UPDATE messages
                SET retry_count = ?, next_retry_at = ?,
                    claimed_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (next_retry_count, next_retry_at,
                 datetime.now(timezone.utc).isoformat(), msg_id)
            )
            conn.commit()
            print(f"[worker-{worker_id}] ↻ [{priority}] msg {msg_id} retry {next_retry_count}/{MAX_RETRIES} in {backoff}s")

    finally:
        conn.close()


def poll_and_deliver(worker_id: int):
    print(f"[worker-{worker_id}] started")
    while True:
        try:
            claimed = claim_messages(worker_id)
            for msg in claimed:
                deliver_message(
                    msg["id"], msg["url"],
                    msg["payload"], msg["priority"],
                    worker_id
                )
        except Exception as e:
            print(f"[worker-{worker_id}] poll error: {e}")

        time.sleep(POLL_INTERVAL)


def start_worker():
    for i in range(NUM_WORKERS):
        thread = threading.Thread(
            target=poll_and_deliver,
            args=(i + 1,),
            daemon=True
        )
        thread.start()
    print(f"[worker] {NUM_WORKERS} concurrent workers started — polling every {POLL_INTERVAL}s")