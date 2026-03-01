// =====================================================
// Dynamic World Quarterly MODE (Hole-Filled) +
// AUTOMATIC ZONAL % EXPORT for ALL completed quarters
// from 2016 up to the latest completed quarter
// =====================================================

// ----------------------
// CONFIG
// ----------------------
var START_YEAR = 2016;
var SCALE = 10;cd
var MAX_PIXELS_PER_REGION = 1e13;

// Hole-fill lookback:
// - set to null to fill using ALL history since START_YEAR (strongest fill)
// - or set to e.g. 24 to fill using last 24 months before quarter start
var LOOKBACK_MONTHS = 24;

// Assets
var BARANGAYS_ASSET = "projects/thesis-478211/assets/BC_Barangays";
var BOUNDARY_ASSET  = "projects/thesis-478211/assets/BC_Boundary";

// Export
var DRIVE_FOLDER  = "GEE_DW_Filled_ClassPct_Flat";
var EXPORT_FORMAT = "CSV"; // or "JSON"

// ----------------------
// DATA
// ----------------------
var barangays   = ee.FeatureCollection(BARANGAYS_ASSET);
var boundaryFc  = ee.FeatureCollection(BOUNDARY_ASSET);
var boundaryGeom = boundaryFc.geometry();

// Map display (optional)
Map.centerObject(boundaryFc, 10);
Map.addLayer(boundaryFc.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'Boundary');

// Dynamic World labels
var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .filterBounds(boundaryGeom)
  .select("label");

// Class name mapping (for flat output fields)
var CLASS_NAMES = ee.Dictionary({
  "0": "water",
  "1": "trees",
  "2": "grass",
  "3": "flooded_vegetation",
  "4": "crops",
  "5": "shrub_and_scrub",
  "6": "built_area",
  "7": "bare_ground",
  "8": "snow_and_ice"
});

// ----------------------
// QUARTER HELPERS (auto all completed quarters)
// ----------------------
function latestCompletedQuarterStart() {
  // Start of the current quarter (not completed yet), used as cutoff
  var now = ee.Date(Date.now());
  var m = ee.Number.parse(now.format("M"));
  var y = ee.Number.parse(now.format("Y"));
  var qIndex = m.subtract(1).divide(3).floor();        // 0..3
  var qStartMonth = qIndex.multiply(3).add(1);         // 1,4,7,10
  return ee.Date.fromYMD(y, qStartMonth, 1);
}

function quarterWindow(year, quarter1to4) {
  var q = ee.Number(quarter1to4);
  var startMonth = q.subtract(1).multiply(3).add(1);
  var start = ee.Date.fromYMD(year, startMonth, 1);
  var end = start.advance(3, "month");
  return ee.Dictionary({ year: ee.Number(year), quarter: q, start: start, end: end });
}

function buildQuarterWindows(startYear) {
  var cutoff = latestCompletedQuarterStart(); // quarters must end <= cutoff
  var endYear = ee.Number.parse(cutoff.advance(-1, "day").format("Y"));

  return ee.List.sequence(startYear, endYear).map(function(y) {
    y = ee.Number(y);
    return ee.List.sequence(1, 4).map(function(q) {
      q = ee.Number(q);
      var w = quarterWindow(y, q);
      var keep = ee.Date(w.get("end")).millis().lte(cutoff.millis());
      return ee.Algorithms.If(keep, w, null);
    });
  }).flatten().removeAll([null]);
}

// ----------------------
// HOLE-FILL HELPERS (per-pixel most recent valid label)
// ----------------------
function mostRecentLabelBefore(endDate, fillStart) {
  var history = dw.filterDate(fillStart, endDate);

  var withTime = history.map(function(img) {
    var t = ee.Image.constant(img.date().millis()).rename('t').toInt64();
    return img.addBands(t);
  });

  // Most recent valid pixel per location
  return withTime.qualityMosaic('t').select('label');
}

// Build FILLED quarterly label image (MODE + fill holes)
function quarterlyFilledLabelImage(w) {
  var start = ee.Date(w.get("start"));
  var end   = ee.Date(w.get("end"));

  var quarterIC = dw.filterDate(start, end);
  var count = quarterIC.size();

  // MODE for the quarter (may have holes)
  var qMode = quarterIC.mode().clip(boundaryGeom);

  // Fill window start
  var fillStart = ee.Algorithms.If(
    LOOKBACK_MONTHS === null,
    ee.Date.fromYMD(START_YEAR, 1, 1),
    start.advance(ee.Number(LOOKBACK_MONTHS).multiply(-1), 'month')
  );
  fillStart = ee.Date(fillStart);

  // Most recent valid label up to quarter end
  var recent = mostRecentLabelBefore(end, fillStart).clip(boundaryGeom);

  // Fill ONLY masked pixels in qMode
  var filled = qMode.unmask(recent);

  return filled.set({
    year: w.get("year"),
    quarter: w.get("quarter"),
    start: start.format("YYYY-MM-dd"),
    end: end.format("YYYY-MM-dd"),
    dw_count: count
  });
}

// ----------------------
// FILL LAG STATISTICS (per quarter)
// ----------------------
function quarterlyFillLagStats(w) {
  var start = ee.Date(w.get("start"));
  var end   = ee.Date(w.get("end"));

  var quarterIC = dw.filterDate(start, end);

  // Quarterly MODE
  var qMode = quarterIC.mode().clip(boundaryGeom);

  // Fill window start
  var fillStart = ee.Algorithms.If(
      LOOKBACK_MONTHS === null,
      ee.Date.fromYMD(START_YEAR, 1, 1),
      start.advance(ee.Number(LOOKBACK_MONTHS).multiply(-1), 'month')
  );
  fillStart = ee.Date(fillStart);

  // Build history with timestamp band
  var history = dw.filterDate(fillStart, end);

  var withTime = history.map(function(img) {
    var t = ee.Image.constant(img.date().millis())
        .rename('t')
        .toInt64();
    return img.addBands(t);
  });

  // Most recent valid label + timestamp
  var recent = withTime.qualityMosaic('t');
  var recentTime = recent.select('t');

  // Mask where quarterly mode is missing
  var missingMask = qMode.mask().not();

  // Current quarter end timestamp
  var currentTime = ee.Image.constant(end.millis()).toInt64();

  // Lag in days (only for filled pixels)
  var lagDays = currentTime.subtract(recentTime)
      .divide(1000 * 60 * 60 * 24)
      .updateMask(missingMask);

  // Reduce over boundary
  var stats = lagDays.reduceRegion({
    reducer: ee.Reducer.mean()
        .combine({reducer2: ee.Reducer.min(), sharedInputs: true})
        .combine({reducer2: ee.Reducer.max(), sharedInputs: true}),
    geometry: boundaryGeom,
    scale: SCALE,
    maxPixels: MAX_PIXELS_PER_REGION
  });

  return ee.Feature(null, {
    year: w.get("year"),
    quarter: w.get("quarter"),
    mean_lag_days: stats.get("constant_mean"),
    min_lag_days: stats.get("constant_min"),
    max_lag_days: stats.get("constant_max")
  });
}

// ----------------------
// ZONAL STATS (GROUP REDUCER) on FILLED label image
// ----------------------
function zonalPctFlatForQuarter(labelImg) {
  // Pixel area + label
  var areaImg = ee.Image.pixelArea().rename("area_m2")
    .addBands(ee.Image(labelImg).rename("label"));

  var reducer = ee.Reducer.sum().group({
    groupField: 1,   // label band
    groupName: "group"
  });

  var fc = areaImg.reduceRegions({
    collection: barangays,
    reducer: reducer,
    scale: SCALE,
    tileScale: 4,
    maxPixelsPerRegion: MAX_PIXELS_PER_REGION
  });

  fc = fc.map(function(f) {
    var groups = ee.List(ee.Dictionary(f.toDictionary()).get("groups"));
    groups = ee.List(ee.Algorithms.If(groups, groups, ee.List([])));

    // Total rasterized area inside polygon
    var total = ee.Number(groups.iterate(function(g, acc) {
      return ee.Number(acc).add(ee.Number(ee.Dictionary(g).get("sum")));
    }, 0));

    var safeTotal = ee.Number(ee.Algorithms.If(total.gt(0), total, 1));

    // Initialize all fields to 0
    var pctInit = ee.Dictionary({
      BRGY_NAME: f.get("BRGY_NAME"),
      year: labelImg.get("year"),
      quarter: labelImg.get("quarter"),
      water: 0,
      trees: 0,
      grass: 0,
      flooded_vegetation: 0,
      crops: 0,
      shrub_and_scrub: 0,
      built_area: 0,
      bare_ground: 0,
      snow_and_ice: 0
    });

    
    // Fill % values for classes present
    var pctFilled = ee.Dictionary(groups.iterate(function(g, acc) {
      g = ee.Dictionary(g);
      acc = ee.Dictionary(acc);

      var clsKey = ee.Number(g.get("group")).format(); // "0".."8"
      var name = ee.String(CLASS_NAMES.get(clsKey));
      var pct = ee.Number(g.get("sum")).divide(safeTotal).multiply(100);

      return acc.set(name, pct);
    }, pctInit));

    return ee.Feature(null, pctFilled);
  });

  return fc;
}

// Helper to convert evaluate()-returned Date objects safely
function toMillis(d) {
  if (d === null || d === undefined) return null;
  if (typeof d === "number") return d;
  if (typeof d === "object" && d.value !== undefined) return d.value;
  return null;
}

// ----------------------
// AUTOMATIC EXPORT (creates one Drive export task per quarter)
// ----------------------
var windows = buildQuarterWindows(START_YEAR);

windows.evaluate(function(winList) {
  print("Total completed quarters to export:", winList.length);

  winList.forEach(function(wObj) {
    var year = wObj.year;
    var q = wObj.quarter;

    var startMs = toMillis(wObj.start);
    var endMs   = toMillis(wObj.end);
    if (startMs === null || endMs === null) return;

    var startEE = ee.Date(startMs);
    var endEE   = ee.Date(endMs);

    // Skip empty quarters (client-side check to avoid pointless tasks)
    var cnt = dw.filterDate(startEE, endEE).size().getInfo();
    if (cnt === 0) {
      print("Skipping", year, "Q" + q, "(no DW images)");
      return;
    }

    var w = ee.Dictionary({
      year: year,
      quarter: q,
      start: startEE,
      end: endEE
    });

    // ---- IMPORTANT: this is the FILLED image ----
    var filledLabelImg = quarterlyFilledLabelImage(w);

    // ----------------------
    // FILL LAG EXPORT
    // ----------------------
    var lagFeature = quarterlyFillLagStats(w);

    var lagDesc = "DW_Fill_Lag_Stats_" + year + "_Q" + q;

    Export.table.toDrive({
      collection: ee.FeatureCollection([lagFeature]),
      description: lagDesc,
      folder: DRIVE_FOLDER,
      fileNamePrefix: lagDesc,
      fileFormat: EXPORT_FORMAT
    });

    print("Created lag export task:", lagDesc);

    // Zonal stats on FILLED image
    var out = zonalPctFlatForQuarter(filledLabelImg);

    // Optional preview
    print("Preview " + year + " Q" + q, out.limit(3));

    // Export task
    var desc = "DW_Filled_ClassPct_Flat_" + year + "_Q" + q;

    Export.table.toDrive({
      collection: out,
      description: desc,
      folder: DRIVE_FOLDER,
      fileNamePrefix: desc,
      fileFormat: EXPORT_FORMAT
    });

    print("Created export task:", desc);
  });
});
