"""Keep uncalibrated raw water sensor values from ESP32 stations.

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


def upgrade() -> None:
    op.add_column("station_readings", sa.Column("water_raw", sa.Integer))
    op.add_column("station_readings", sa.Column("water_percent", sa.Integer))
    op.add_column("station_readings", sa.Column("sensor_status", sa.Text))
    op.create_check_constraint(
        "ck_station_readings_water_percent",
        "station_readings",
        "water_percent IS NULL OR water_percent BETWEEN 0 AND 100",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_station_readings_water_percent", "station_readings", type_="check"
    )
    op.drop_column("station_readings", "sensor_status")
    op.drop_column("station_readings", "water_percent")
    op.drop_column("station_readings", "water_raw")
