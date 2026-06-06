import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from database import init_db, get_connection
from models import TopicCreate, SubscribeRequest, PublishRequest
from worker import start_worker

app = FastAPI(
    title="Axon",
    description="One signal. Many receivers. A lightweight pub-sub event delivery engine.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    start_worker()


# ── Topics ────────────────────────────────────────────────────────────────────

@app.post("/topics", status_code=201)
def create_topic(body: TopicCreate):
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO topics (name) VALUES (?)",
            (body.name,)
        )
        conn.commit()
        return {"message": f"Topic '{body.name}' created."}
    except Exception:
        raise HTTPException(status_code=409, detail=f"Topic '{body.name}' already exists.")
    finally:
        conn.close()


@app.delete("/topics/{name}")
def delete_topic(name: str):
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM topics WHERE name = ?", (name,)
        )
        conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"Topic '{name}' not found.")
        return {"message": f"Topic '{name}' deleted."}
    finally:
        conn.close()


@app.get("/topics")
def list_topics():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name, created_at FROM topics ORDER BY created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


# ── Subscribers ───────────────────────────────────────────────────────────────

@app.post("/subscribe", status_code=201)
def subscribe(body: SubscribeRequest):
    conn = get_connection()
    try:
        topic = conn.execute(
            "SELECT name FROM topics WHERE name = ?", (body.topic_name,)
        ).fetchone()
        if not topic:
            raise HTTPException(status_code=404, detail=f"Topic '{body.topic_name}' not found.")

        conn.execute(
            "INSERT INTO subscribers (topic_name, name, url) VALUES (?, ?, ?)",
            (body.topic_name, body.subscriber_name, body.url)
        )
        conn.commit()
        return {"message": f"'{body.subscriber_name}' subscribed to '{body.topic_name}'."}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=409, detail="Subscriber with this URL already exists for this topic.")
    finally:
        conn.close()


@app.get("/subscribers/{topic_name}")
def list_subscribers(topic_name: str):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, name, url, created_at FROM subscribers WHERE topic_name = ?",
            (topic_name,)
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


# ── Publish ───────────────────────────────────────────────────────────────────

@app.post("/publish", status_code=202)
def publish(body: PublishRequest):
    conn = get_connection()
    try:
        topic = conn.execute(
            "SELECT name FROM topics WHERE name = ?", (body.topic_name,)
        ).fetchone()
        if not topic:
            raise HTTPException(status_code=404, detail=f"Topic '{body.topic_name}' not found.")

        subscribers = conn.execute(
            "SELECT id FROM subscribers WHERE topic_name = ?", (body.topic_name,)
        ).fetchall()

        if not subscribers:
            return {"message": "Message accepted. No subscribers yet.", "queued_for": 0}

        payload_str = json.dumps(body.payload)
        priority_order = {"high": 0, "normal": 1, "low": 2}[body.priority]

        for sub in subscribers:
            conn.execute(
                """
                INSERT INTO messages (topic_name, payload, status, priority, priority_order, subscriber_id)
                VALUES (?, ?, 'pending', ?, ?, ?)
                """,
                (body.topic_name, payload_str, body.priority, priority_order, sub["id"])
            )

        conn.commit()
        return {
            "message": "Message accepted and queued.",
            "queued_for": len(subscribers),
            "priority": body.priority
        }
    except HTTPException:
        raise
    finally:
        conn.close()


# ── Messages (for inspection) ─────────────────────────────────────────────────

@app.get("/messages/{topic_name}")
def list_messages(topic_name: str, status: str = None):
    conn = get_connection()
    try:
        if status:
            rows = conn.execute(
                """
                SELECT m.id, m.topic_name, m.payload, m.status,
                       s.name as subscriber_name, m.retry_count, m.created_at
                FROM messages m
                JOIN subscribers s ON m.subscriber_id = s.id
                WHERE m.topic_name = ? AND m.status = ?
                ORDER BY m.created_at DESC
                """,
                (topic_name, status)
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT m.id, m.topic_name, m.payload, m.status,
                       s.name as subscriber_name, m.retry_count, m.created_at
                FROM messages m
                JOIN subscribers s ON m.subscriber_id = s.id
                WHERE m.topic_name = ?
                ORDER BY m.created_at DESC
                """,
                (topic_name,)
            ).fetchall()

        return [dict(row) for row in rows]
    finally:
        conn.close()


@app.get("/dlq")
def dead_letter_queue():
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT m.id, m.topic_name, m.payload, m.retry_count,
                   s.name as subscriber_name, s.url, m.created_at, m.updated_at
            FROM messages m
            JOIN subscribers s ON m.subscriber_id = s.id
            WHERE m.status = 'failed'
            ORDER BY m.updated_at DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


@app.post("/dlq/{message_id}/retry")
def retry_failed_message(message_id: int):
    conn = get_connection()
    try:
        msg = conn.execute(
            "SELECT id FROM messages WHERE id = ? AND status = 'failed'",
            (message_id,)
        ).fetchone()
        if not msg:
            raise HTTPException(status_code=404, detail="Failed message not found.")

        conn.execute(
            """
            UPDATE messages
            SET status = 'pending', retry_count = 0,
                next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (message_id,)
        )
        conn.commit()
        return {"message": f"Message {message_id} requeued for delivery."}
    finally:
        conn.close()



    return {"status": "ok"}