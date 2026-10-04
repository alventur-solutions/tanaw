"""TANAW API entry point."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.analyze import router as analyze_router
from api.areas import router as areas_router
from api.areas import warm_cache
from api.crossings import router as crossings_router
from api.db import engine, get_session
from api.funding import router as funding_router
from api.ingest import router as ingest_router
from api.jobs import fail_stale_jobs
from api.layers import router as layers_router
from api.projects import router as projects_router
from api.stations import router as stations_router
from api.summary import router as summary_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Jobs left running by a previous server process can never finish.
    await fail_stale_jobs()
    # Read only. Runs beside startup so a slow database does not delay the first request.
    warm = asyncio.create_task(warm_cache())
    yield
    warm.cancel()
    await engine.dispose()


app = FastAPI(title="TANAW API", lifespan=lifespan)
# The map loads every project site in one response, so responses are compressed.
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.include_router(analyze_router)
# Before the areas router, so /areas/summary is never read as an area_id.
app.include_router(summary_router)
app.include_router(areas_router)
app.include_router(crossings_router)
app.include_router(funding_router)
app.include_router(ingest_router)
app.include_router(layers_router)
app.include_router(projects_router)
app.include_router(stations_router)


@app.get("/health")
async def health(session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, str]:
    result = await session.execute(text("SELECT postgis_version()"))
    return {"status": "ok", "postgis_version": result.scalar_one()}
