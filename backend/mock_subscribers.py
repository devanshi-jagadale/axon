"""
Mock subscriber services — run this alongside main.py to simulate
4 real downstream services receiving events from Axon.

Usage:
    python mock_subscribers.py

Ports:
    8001 — grade-service
    8002 — notify-service
    8003 — leaderboard-service
    8004 — certificate-service
"""

import threading
import random
import uvicorn
from fastapi import FastAPI, Request
from datetime import datetime


def make_service(name: str, fail_rate: float = 0.0) -> FastAPI:
    svc = FastAPI(title=name)

    @svc.post("/webhook")
    async def webhook(request: Request):
        body = await request.json()
        ts = datetime.now().strftime("%H:%M:%S")

        # Simulate occasional failures to demonstrate retry/backoff
        if random.random() < fail_rate:
            print(f"[{ts}] [{name}] ✗ simulated failure for payload: {body}")
            raise Exception("simulated failure")

        print(f"[{ts}] [{name}] ✓ received: {body}")
        return {"status": "ok", "service": name, "received": body}

    @svc.get("/health")
    def health():
        return {"service": name, "status": "ok"}

    return svc


services = [
    ("grade-service",       8001, 0.0),   # always succeeds
    ("notify-service",      8002, 0.3),   # fails 30% — demos retry
    ("leaderboard-service", 8003, 0.0),   # always succeeds
    ("certificate-service", 8004, 0.0),   # always succeeds
]


def run_service(name, port, fail_rate):
    app = make_service(name, fail_rate)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    print("Starting mock subscribers...")
    print("  grade-service       → http://localhost:8001")
    print("  notify-service      → http://localhost:8002  (30% fail rate — watch retries!)")
    print("  leaderboard-service → http://localhost:8003")
    print("  certificate-service → http://localhost:8004")
    print()

    threads = []
    for name, port, fail_rate in services:
        t = threading.Thread(
            target=run_service,
            args=(name, port, fail_rate),
            daemon=True
        )
        t.start()
        threads.append(t)

    for t in threads:
        t.join()