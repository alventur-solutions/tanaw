"""TANAW API entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.analyze import router as analyze_router
from api.db import engine, get_session
from api.funding import router as funding_router
from api.jobs import fail_stale_jobs


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Jobs left running by a previous server process can never finish.
    await fail_stale_jobs()
    yield
    await engine.dispose()


app = FastAPI(title="TANAW API", lifespan=lifespan)
app.include_router(analyze_router)
app.include_router(funding_router)


@app.get("/health")
async def health(session: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, str]:
    result = await session.execute(text("SELECT postgis_version()"))
    return {"status": "ok", "postgis_version": result.scalar_one()}
