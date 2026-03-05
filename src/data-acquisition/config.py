import yaml
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent / "configs" / "pipeline_config.yaml"

with open(_CONFIG_PATH) as f:
    _cfg = yaml.safe_load(f)

GEE_PROJECT: str = _cfg["gee"]["project"]

BARANGAYS_ASSET: str = _cfg["assets"]["barangays"]
BOUNDARY_ASSET:  str = _cfg["assets"]["boundary"]

START_YEAR:            int       = _cfg["processing"]["start_year"]
SCALE:                 int       = _cfg["processing"]["scale"]
MAX_PIXELS_PER_REGION: int       = int(_cfg["processing"]["max_pixels_per_region"])
LOOKBACK_MONTHS:       int | None = _cfg["processing"].get("lookback_months")

DRIVE_FOLDER:  str = _cfg["export"]["drive_folder"]
EXPORT_FORMAT: str = _cfg["export"]["format"]      

CLASS_NAMES: dict[str, str] = {
    "0": "water",
    "1": "trees",
    "2": "grass",
    "3": "flooded_vegetation",
    "4": "crops",
    "5": "shrub_and_scrub",
    "6": "built_area",
    "7": "bare_ground",
    "8": "snow_and_ice",
}