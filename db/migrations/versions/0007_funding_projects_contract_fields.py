"""Add DPWH contract-level fields after the IoT reading reconciliation.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-04

The IoT deployment branch and dashboard branch both introduced a revision named
0005. Keep the already-applied station-reading history intact, and apply these
funding fields as the next revision. The DDL is idempotent because some databases
may already have received the original funding revision 0005.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS contract_id TEXT")
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS description TEXT")
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS status TEXT")
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS progress_pct DOUBLE PRECISION")
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS program TEXT")
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS source_of_funds TEXT")
    op.execute("ALTER TABLE funding_projects ADD COLUMN IF NOT EXISTS quality_flag TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_funding_projects_contract_id "
        "ON funding_projects (contract_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_funding_projects_source "
        "ON funding_projects (source)"
    )


def downgrade() -> None:
    # These fields may predate this revision in databases with the old 0005.
    # Keep the reconciliation migration forward-only to avoid dropping data.
    pass
