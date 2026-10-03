"""Add contract level fields to funding_projects.

The DPWH transparency dataset is keyed on the contract and carries the description, the
status, and the progress of each contract. quality_flag records how far a row can be trusted,
for example `category_from_description` when the source has no TypeofWork.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = [
    ("contract_id", sa.Text),
    ("description", sa.Text),
    ("status", sa.Text),
    ("progress_pct", sa.Float),
    ("program", sa.Text),
    ("source_of_funds", sa.Text),
    ("quality_flag", sa.Text),
]


def upgrade() -> None:
    for name, kind in COLUMNS:
        op.add_column("funding_projects", sa.Column(name, kind))
    op.create_index("ix_funding_projects_contract_id", "funding_projects", ["contract_id"])
    op.create_index("ix_funding_projects_source", "funding_projects", ["source"])


def downgrade() -> None:
    op.drop_index("ix_funding_projects_source", table_name="funding_projects")
    op.drop_index("ix_funding_projects_contract_id", table_name="funding_projects")
    for name, _ in reversed(COLUMNS):
        op.drop_column("funding_projects", name)
