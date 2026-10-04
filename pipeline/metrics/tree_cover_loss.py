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

# Major typhoon years per top-level area_id: year -> (storm names, late_season). Zones
# (`<area_id>__up`, `<area_id>__down`) use their parent's years. An area_id with no entry gets
# no storm flag. The lists are a short set of major storms from public records, not a complete
# storm history. Loss in a storm year may be natural (wind throw, landslide).
# late_season is True for a storm from Nov 1 on: Hansen dates loss to the first clear
# observation, so that loss can show in the following year (flag `storm_prior_year`).
STORM_YEARS: dict[str, dict[int, tuple[str, bool]]] = {
    "pasig-marikina-tullahan": {
        2009: ("Ondoy / Ketsana", False),
        2020: ("Ulysses / Vamco", True),
    },
    "quezon-city": {
        2009: ("Ondoy / Ketsana", False),
        2020: ("Ulysses / Vamco", True),
    },
    "antipolo-rodriguez-uplands": {
        2009: ("Ondoy / Ketsana", False),
        2020: ("Ulysses / Vamco", True),
    },
    "pampanga-river-basin": {
        2009: ("Pepeng / Parma, Ondoy / Ketsana", False),
        2011: ("Pedring / Nesat", False),
        2015: ("Lando / Koppu", False),
        2020: ("Ulysses / Vamco", True),
    },
    "angat-river-basin": {
        2009: ("Pepeng / Parma, Ondoy / Ketsana", False),
        2011: ("Pedring / Nesat", False),
        2015: ("Lando / Koppu", False),
        2020: ("Ulysses / Vamco", True),
    },
    "cagayan-river-basin": {
        2010: ("Juan / Megi", False),
        2016: ("Lawin / Haima", False),
        2018: ("Ompong / Mangkhut", False),
        2020: ("Ulysses / Vamco", True),
    },
    "bicol-river-basin": {
        2006: ("Reming / Durian", True),
        2016: ("Nina / Nock-ten", True),
        2019: ("Tisoy / Kammuri", True),
        2020: ("Rolly / Goni", True),
    },
    "iloilo-river-basin": {
        2008: ("Frank / Fengshen", False),
        2013: ("Yolanda / Haiyan", True),
        2019: ("Ursula / Phanfone", True),
    },
    "jalaur-river-basin": {
        2008: ("Frank / Fengshen", False),
        2013: ("Yolanda / Haiyan", True),
        2019: ("Ursula / Phanfone", True),
    },
    "agusan-river-basin": {
        2012: ("Pablo / Bopha", True),
        2021: ("Odette / Rai", True),
    },
    "cagayan-de-oro-river-basin": {
        2011: ("Sendong / Washi", True),
        2017: ("Vinta / Tembin", True),
    },
}


def storm_flag(area_id: str, year: int) -> str:
    """`storm_year`, `storm_prior_year` (the year after a late season storm) or `ok`."""
    storms = STORM_YEARS.get(area_id.split("__")[0], {})
    if year in storms:
        return "storm_year"
    if year - 1 in storms and storms[year - 1][1]:
        return "storm_prior_year"
    return "ok"


def storm_flags(year: int) -> dict[str, str]:
    """area_id to flag for one year, for every top-level area and its zones."""
    ids = [f"{parent}{zone}" for parent in STORM_YEARS for zone in ("", "__up", "__down")]
    return {area_id: storm_flag(area_id, year) for area_id in ids}


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
    flags = ee.Dictionary(storm_flags(year))

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
                    covered.gte(MIN_VALID_FRACTION),
                    flags.get(feature.get("area_id"), "ok"),
                    "low_coverage",
                ),
            },
        )

    return reduced.map(to_row)
