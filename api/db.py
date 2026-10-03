"""Async SQLAlchemy engine and session for the Neon pooled connection."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import get_settings

# Neon's pooler is PgBouncer in transaction mode, so a server connection is not
# kept between transactions. Both prepared statement caches must be off.
engine = create_async_engine(
    get_settings().database_url,
    connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with SessionLocal() as session:
        yield session
