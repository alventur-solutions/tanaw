"""Record the source dataset version on satellite_metrics.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The dataset ID the value was computed from, e.g. the Hansen asset ID. Rows written
    # before this column existed keep NULL until they are recomputed.
    op.add_column("satellite_metrics", sa.Column("source_version", sa.Text))


def downgrade() -> None:
    op.drop_column("satellite_metrics", "source_version")
