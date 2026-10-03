"""Test setup. Placeholder URLs so no test can reach a real database."""

import os

os.environ["DATABASE_URL"] = (
    "postgresql+asyncpg://user:pass@ep-test-pooler.example.neon.tech/tanaw?ssl=require"
)
os.environ["DATABASE_URL_DIRECT"] = (
    "postgresql+asyncpg://user:pass@ep-test.example.neon.tech/tanaw?ssl=require"
)
