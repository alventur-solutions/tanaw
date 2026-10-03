"""Enable PostGIS and create the core TANAW tables.

Revision ID: 0001
Revises:
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _geom(geometry_type: str) -> Geometry:
    # spatial_index=False: the GiST indexes are created explicitly below.
    return Geometry(geometry_type, srid=4326, spatial_index=False)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "study_areas",
        sa.Column("area_id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("study_type", sa.Text, nullable=False),
        sa.Column("zone", sa.Text),
        sa.Column("area_ha", sa.Float),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("geom", _geom("MULTIPOLYGON"), nullable=False),
        sa.CheckConstraint(
            "study_type IN ('river_basin', 'rural_upland', 'urban')",
            name="ck_study_areas_study_type",
        ),
    )
    op.create_index("ix_study_areas_geom", "study_areas", ["geom"], postgresql_using="gist")

    op.create_table(
        "satellite_metrics",
        sa.Column("area_id", sa.Text, sa.ForeignKey("study_areas.area_id"), nullable=False),
        sa.Column("year", sa.Integer, nullable=False),
        sa.Column("metric", sa.Text, nullable=False),
        sa.Column("value", sa.Float),
        sa.Column("quality_flag", sa.Text, nullable=False),
        sa.Column(
            "computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("area_id", "year", "metric"),
    )
    op.create_index("ix_satellite_metrics_area_id", "satellite_metrics", ["area_id"])
    op.create_index("ix_satellite_metrics_year", "satellite_metrics", ["year"])

    op.create_table(
        "analysis_jobs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("area_id", sa.Text, sa.ForeignKey("study_areas.area_id"), nullable=False),
        sa.Column("metrics", postgresql.ARRAY(sa.Text), nullable=False),
        sa.Column("years", postgresql.ARRAY(sa.Integer), nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="queued"),
        sa.Column("error", sa.Text),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')",
            name="ck_analysis_jobs_status",
        ),
    )
    op.create_index("ix_analysis_jobs_area_id", "analysis_jobs", ["area_id"])

    op.create_table(
        "funding_projects",
        sa.Column("component_id", sa.Text, primary_key=True),
        sa.Column("project_id", sa.Text),
        sa.Column("area_id", sa.Text, sa.ForeignKey("study_areas.area_id")),
        sa.Column("year", sa.Integer),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("type_of_work", sa.Text),
        sa.Column("amount_php", sa.Numeric(18, 2)),
        sa.Column("abc_php", sa.Numeric(18, 2)),
        sa.Column("contractor", sa.Text),
        sa.Column("municipality", sa.Text),
        sa.Column("province", sa.Text),
        sa.Column("start_date", sa.Date),
        sa.Column("completion_date", sa.Date),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("geom", _geom("POINT")),
        sa.CheckConstraint(
            "category IN ('drainage', 'river_structure', 'slope_protection', 'pumping', 'other')",
            name="ck_funding_projects_category",
        ),
    )
    op.create_index("ix_funding_projects_area_id", "funding_projects", ["area_id"])
    op.create_index("ix_funding_projects_year", "funding_projects", ["year"])
    op.create_index(
        "ix_funding_projects_geom", "funding_projects", ["geom"], postgresql_using="gist"
    )

    op.create_table(
        "stations",
        sa.Column("station_id", sa.Text, primary_key=True),
        sa.Column("station_type", sa.Text, nullable=False),
        sa.Column("area_id", sa.Text, sa.ForeignKey("study_areas.area_id")),
        sa.Column("geom", _geom("POINT"), nullable=False),
        sa.Column("mount_height_cm", sa.Float),
        sa.Column("dry_baseline_cm", sa.Float),
        sa.CheckConstraint(
            "station_type IN ('river', 'street')",
            name="ck_stations_station_type",
        ),
    )
    op.create_index("ix_stations_area_id", "stations", ["area_id"])
    op.create_index("ix_stations_geom", "stations", ["geom"], postgresql_using="gist")

    op.create_table(
        "station_readings",
        sa.Column("station_id", sa.Text, sa.ForeignKey("stations.station_id"), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("temp_c", sa.Float),
        sa.Column("humidity_pct", sa.Float),
        sa.Column("water_level_cm", sa.Float),
        sa.Column("flood_depth_cm", sa.Float),
        sa.Column("battery_v", sa.Float),
        sa.PrimaryKeyConstraint("station_id", "ts"),
    )


def downgrade() -> None:
    # The postgis extension is left in place.
    op.drop_table("station_readings")
    op.drop_table("stations")
    op.drop_table("funding_projects")
    op.drop_table("analysis_jobs")
    op.drop_table("satellite_metrics")
    op.drop_table("study_areas")
