"""Link funding projects to every study area they fall in.

Study areas overlap (a city inside a basin, zones inside a basin), so one project site can
belong to several areas. funding_projects.area_id could hold only one, so it is replaced
by the link table funding_project_areas.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "funding_project_areas",
        sa.Column(
            "component_id",
            sa.Text,
            sa.ForeignKey("funding_projects.component_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("area_id", sa.Text, sa.ForeignKey("study_areas.area_id"), nullable=False),
        sa.PrimaryKeyConstraint("component_id", "area_id"),
    )
    op.create_index("ix_funding_project_areas_area_id", "funding_project_areas", ["area_id"])

    # Carry over any single-area assignments before the column goes.
    op.execute(
        "INSERT INTO funding_project_areas (component_id, area_id) "
        "SELECT component_id, area_id FROM funding_projects WHERE area_id IS NOT NULL"
    )
    op.drop_index("ix_funding_projects_area_id", table_name="funding_projects")
    op.drop_column("funding_projects", "area_id")


def downgrade() -> None:
    # A project in several areas cannot go back into one column. The column returns empty.
    op.add_column(
        "funding_projects",
        sa.Column("area_id", sa.Text, sa.ForeignKey("study_areas.area_id")),
    )
    op.create_index("ix_funding_projects_area_id", "funding_projects", ["area_id"])
    op.drop_table("funding_project_areas")
