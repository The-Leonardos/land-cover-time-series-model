var START_YEAR = 2016;
var SCALE = 10;
var MAX_PIXELS_PER_REGION = 1e13;

var BARANGAYS_ASSET = "projects/thesis-478211/assets/BC_Barangays"; 
var BOUNDARY_ASSET  = "projects/thesis-478211/assets/BC_Boundary";  

var DRIVE_FOLDER = "GEE_DW_ClassPct_Flat"; 
var EXPORT_FORMAT = "JSON";             


var barangays = ee.FeatureCollection(BARANGAYS_ASSET);
var boundaryGeom = ee.FeatureCollection(BOUNDARY_ASSET).geometry();

var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .filterBounds(boundaryGeom)
  .select("label");

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

function latestCompletedQuarterEnd() {
  var now = ee.Date(Date.now());
  var m = ee.Number.parse(now.format("M"));
  var y = ee.Number.parse(now.format("Y"));
  var qIndex = m.subtract(1).divide(3).floor();
  var qStartMonth = qIndex.multiply(3).add(1);
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
  var endCutoff = latestCompletedQuarterEnd(); 
  var endYear = ee.Number.parse(endCutoff.advance(-1, "day").format("Y"));

  return ee.List.sequence(startYear, endYear).map(function(y) {
    y = ee.Number(y);
    return ee.List.sequence(1, 4).map(function(q) {
      q = ee.Number(q);
      var w = quarterWindow(y, q);
      var keep = ee.Date(w.get("end")).millis().lte(endCutoff.millis());
      return ee.Algorithms.If(keep, w, null);
    });
  }).flatten().removeAll([null]);
}


function quarterlyModeLabelImage(w) {
  var start = ee.Date(w.get("start"));
  var end = ee.Date(w.get("end"));

  var filtered = dw.filterDate(start, end);
  var count = filtered.size();

  return filtered.mode()
    .clip(boundaryGeom)
    .set({
      year: w.get("year"),
      quarter: w.get("quarter"),
      start: start.format("YYYY-MM-dd"),
      end: end.format("YYYY-MM-dd"),
      dw_count: count
    });
}


function zonalPctFlatForQuarter(labelImg) {
  var areaImg = ee.Image.pixelArea().rename("area_m2")
    .addBands(ee.Image(labelImg).rename("label"));

  var reducer = ee.Reducer.sum().group({
    groupField: 1,
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

    var total = ee.Number(groups.iterate(function(g, acc) {
      return ee.Number(acc).add(ee.Number(ee.Dictionary(g).get("sum")));
    }, 0));

    var safeTotal = ee.Number(ee.Algorithms.If(total.gt(0), total, 1));

    var pctInit = ee.Dictionary({
      pct_water: 0,
      pct_trees: 0,
      pct_grass: 0,
      pct_flooded_vegetation: 0,
      pct_crops: 0,
      pct_shrub_and_scrub: 0,
      pct_built_area: 0,
      pct_bare_ground: 0,
      pct_snow_and_ice: 0
    });

    var pctFilled = ee.Dictionary(groups.iterate(function(g, acc) {
      g = ee.Dictionary(g);
      acc = ee.Dictionary(acc);

      var clsKey = ee.Number(g.get("group")).format(); 
      var name = ee.String(CLASS_NAMES.get(clsKey));  
      var pct = ee.Number(g.get("sum")).divide(safeTotal).multiply(100);

      return acc.set(ee.String("pct_").cat(name), pct);
    }, pctInit));

    pctFilled = pctFilled
      .set("BRGY_NAME", f.get("BRGY_NAME"))
      .set("OBJECTID", f.get("OBJECTID"))
      .set("year", labelImg.get("year"))
      .set("quarter", labelImg.get("quarter"))
      .set("start", labelImg.get("start"))
      .set("end", labelImg.get("end"))
      .set("dw_count", labelImg.get("dw_count"))
      .set("total_area_m2", total);

    return ee.Feature(null, pctFilled);
  });

  return fc;
}

function toMillis(d) {
  if (d === null || d === undefined) return null;
  if (typeof d === "number") return d;
  if (typeof d === "object" && d.value !== undefined) return d.value;
  return null;
}


var windows = buildQuarterWindows(START_YEAR);


windows.evaluate(function(winList) {
  print("Total quarters (tasks to create):", winList.length);

  winList.forEach(function(wObj) {
    var year = wObj.year;
    var q = wObj.quarter;

    var startMs = toMillis(wObj.start);
    var endMs   = toMillis(wObj.end);
    if (startMs === null || endMs === null) return;

    var startEE = ee.Date(startMs);
    var endEE   = ee.Date(endMs);

    // Skip empty quarters
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

    var labelImg = quarterlyModeLabelImage(w);
    var out = zonalPctFlatForQuarter(labelImg);

    print("Preview " + year + " Q" + q, out.limit(5));

    var desc = "DW_ClassPct_Flat_" + year + "_Q" + q;

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
