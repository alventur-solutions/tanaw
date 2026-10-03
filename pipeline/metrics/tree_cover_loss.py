"""Tree cover loss per study area per year, in hectares (Hansen Global Forest Change).

Forest is treecover2000 >= 30 percent. The value is the area of forest pixels whose first
stand-replacing loss was detected in the given year. It is tree cover loss from any cause
(clearing, fire, storm damage, landslide, plantation harvest), and it says nothing about
regrowth or about trees planted after 2000.
"""

import ee

METRIC = "tree_cover_loss"
UNIT = "ha"
DATASET = "UMD/hansen/global_forest_change_2025_v1_13"
FIRST_YEAR = 2001
LAST_YEAR = 2025
FOREST_MIN_TREECOVER = 30  # percent canopy cover in 2000
SCALE_M = 30
MIN_VALID_FRACTION = 0.95

# Years with a major typhoon over the study region (Ondoy 2009, Ulysses 2020).
# Loss in these years may be natural, so the row is flagged for the reader.
STORM_YEARS = {2009, 2020}


def loss_image(year: int) -> ee.Image:
    """Two bands: loss_ha (hectares of forest lost that year per pixel) and valid (0 or 1)."""
    hansen = ee.Image(DATASET)
    forest = hansen.select("treecover2000").gte(FOREST_MIN_TREECOVER)
    lost = hansen.select("lossyear").eq(year - 2000).And(forest)
    loss_ha = lost.multiply(ee.Image.pixelArea()).divide(1e4).rename("loss_ha")
    # datamask: 0 = no data, 1 = mapped land, 2 = permanent water. unmask so that pixels
    # outside the dataset count as not valid instead of being skipped by the mean.
    valid = hansen.select("datamask").neq(0).unmask(0).rename("valid")
    return loss_ha.addBands(valid)


def compute(year: int, areas: ee.FeatureCollection) -> ee.FeatureCollection:
    """One feature per area with area_id, year, metric, value, quality_flag."""
    in_range = FIRST_YEAR <= year <= LAST_YEAR
    flag = "storm_year" if year in STORM_YEARS else "ok"

    def no_data(feature: ee.Feature) -> ee.Feature:
        return ee.Feature(
            None,
            {
                "area_id": feature.get("area_id"),
                "year": year,
                "metric": METRIC,
                "value": None,
                "quality_flag": "no_data",
            },
        )

    if not in_range:
        return areas.map(no_data)

    # First band goes to sum (hectares lost), second band to mean (valid pixel fraction).
    reducer = ee.Reducer.sum().combine(ee.Reducer.mean(), sharedInputs=False)
    reduced = loss_image(year).reduceRegions(
        collection=areas, reducer=reducer, scale=SCALE_M, tileScale=4
    )

    def to_row(feature: ee.Feature) -> ee.Feature:
        covered = ee.Number(ee.Algorithms.If(feature.get("mean"), feature.get("mean"), 0))
        return ee.Feature(
            None,
            {
                "area_id": feature.get("area_id"),
                "year": year,
                "metric": METRIC,
                "value": feature.get("sum"),
                "quality_flag": ee.Algorithms.If(
                    covered.gte(MIN_VALID_FRACTION), flag, "low_coverage"
                ),
            },
        )

    return reduced.map(to_row)
