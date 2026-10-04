"""Add OpenStreetMap waterways, bridge crossings over waterways, and urban roads.

Base data for placing monitoring stations: a river station mounts on a bridge, a street station
on a pole over a road. New tables only. The rows are replaced as a whole by
`python -m pipeline.osm load`. osm_meta holds one row with the fetch date and the attribution
that must appear wherever the data is shown (ODbL).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-04

The IoT deployment branch already uses revisions 0006 and 0007 for station
reading and funding reconciliation. Append OSM tables after that applied history.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE osm_waterways ("
        "osm_id bigint PRIMARY KEY, "
        "waterway text NOT NULL, "
        "name text, "
        "geom geometry(LineString, 4326) NOT NULL)"
    )
    op.execute("CREATE INDEX ix_osm_waterways_geom ON osm_waterways USING gist (geom)")
    op.execute(
        "CREATE TABLE osm_crossings ("
        "bridge_osm_id bigint NOT NULL, "
        "waterway_osm_id bigint NOT NULL, "
        "road_name text, "
        "highway text, "
        "waterway text, "
        "waterway_name text, "
        "geom geometry(Point, 4326) NOT NULL, "
        "PRIMARY KEY (bridge_osm_id, waterway_osm_id))"
    )
    op.execute("CREATE INDEX ix_osm_crossings_geom ON osm_crossings USING gist (geom)")
    op.execute(
        "CREATE TABLE osm_roads ("
        "osm_id bigint PRIMARY KEY, "
        "highway text NOT NULL, "
        "name text, "
        "geom geometry(LineString, 4326) NOT NULL)"
    )
    op.execute("CREATE INDEX ix_osm_roads_geom ON osm_roads USING gist (geom)")
    op.execute(
        "CREATE TABLE osm_meta ("
        "id integer PRIMARY KEY CHECK (id = 1), "
        "fetched_on date NOT NULL, "
        "attribution text NOT NULL, "
        "waterways integer NOT NULL, "
        "crossings integer NOT NULL, "
        "roads integer NOT NULL, "
        "loaded_at timestamptz NOT NULL DEFAULT now())"
    )


def downgrade() -> None:
    op.execute("DROP TABLE osm_meta")
    op.execute("DROP TABLE osm_roads")
    op.execute("DROP TABLE osm_crossings")
    op.execute("DROP TABLE osm_waterways")
