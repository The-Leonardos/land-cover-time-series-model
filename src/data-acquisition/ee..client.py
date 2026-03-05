import ee
from data_acquisition.config import (
    GEE_PROJECT,
    BARANGAYS_ASSET,
    BOUNDARY_ASSET,
)


def init(credentials=None) -> None:
    if credentials:
        ee.Initialize(credentials, project=GEE_PROJECT)
    else:
        ee.Initialize(project=GEE_PROJECT)


def get_barangays() -> ee.FeatureCollection:
    return ee.FeatureCollection(BARANGAYS_ASSET)


def get_boundary_fc() -> ee.FeatureCollection:
    return ee.FeatureCollection(BOUNDARY_ASSET)


def get_boundary_geom() -> ee.Geometry:
    return get_boundary_fc().geometry()


def get_dw() -> ee.ImageCollection:
    """Dynamic World V1 filtered to the study boundary, label band only."""
    return (
        ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
        .filterBounds(get_boundary_geom())
        .select("label")
    )