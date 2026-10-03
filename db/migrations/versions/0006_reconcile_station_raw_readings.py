"""Ensure raw station reading columns exist after revision 0005.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Revision 0005 may have been recorded before its column additions were
    # present in the migration source. Reconcile databases safely either way.
    op.execute("ALTER TABLE station_readings ADD COLUMN IF NOT EXISTS water_raw INTEGER")
    op.execute("ALTER TABLE station_readings ADD COLUMN IF NOT EXISTS water_percent INTEGER")
    op.execute("ALTER TABLE station_readings ADD COLUMN IF NOT EXISTS sensor_status TEXT")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'ck_station_readings_water_percent'
                  AND conrelid = 'station_readings'::regclass
            ) THEN
                ALTER TABLE station_readings
                ADD CONSTRAINT ck_station_readings_water_percent
                CHECK (water_percent IS NULL OR water_percent BETWEEN 0 AND 100);
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # These columns and constraint belong to revision 0005, so keep them when
    # reverting this reconciliation revision to 0005.
    pass
