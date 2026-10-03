"""Async SQLAlchemy engine and session for the Neon pooled connection."""

import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api.config import get_settings

# Neon's pooler is PgBouncer in transaction mode, so a server connection is not
# kept between transactions. Both prepared statement caches must be off.
engine_options: dict[str, object] = {
    "connect_args": {"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    "pool_pre_ping": True,
}
if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    # Lambda handlers may run requests on separate event loops. Avoid reusing
    # asyncpg connections across those loops or keeping idle server connections.
    engine_options["poolclass"] = NullPool
else:
    engine_options.update(pool_size=5, max_overflow=5)

engine = create_async_engine(get_settings().database_url, **engine_options)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with SessionLocal() as session:
        yield session
