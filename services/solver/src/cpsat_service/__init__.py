"""The HTTP wrapper around ``cpsat_engine`` (F-302).

One direction of dependency, deliberately: the service imports the engine and the engine imports
nothing from here. ``cpsat_engine`` stays a transport-agnostic, side-effect-free core that a CLI, a
test, or a future queue consumer can call just as well as this FastAPI app can.

The shape, and why each piece exists:

    app.py        two routes. `GET /health` is dependency-free; `POST /jobs/{job_id}/solve`
                  validates the body against the FROZEN CONTRACT (never a Pydantic projection of
                  it), registers the job, spawns the worker and returns 202.
    runner.py     the background worker: sign in -> compare-and-set claim -> solve -> final write.
    supabase.py   an httpx client with four operations, holding no privileged key: sign in, claim,
                  the best-effort per-stage progress write, and the retried terminal write.
    registry.py   the in-process job map. Doubles as the duplicate-POST guard and holds the
                  latch plus the live solver handle a stop interrupts (S-304, S-305).
    settings.py   the container's environment, read once.

Execution model (research R5): 202 + a background thread + the database row as the ONLY status
channel. That works because CP-SAT releases the GIL during solve — measured, not assumed — so one
uvicorn process answers `/health` while a 20-minute solve runs beside it. No queue, no
multiprocessing, no Celery.
"""
