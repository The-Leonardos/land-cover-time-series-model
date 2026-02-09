// ======================
// CONFIG
// ======================
var START_YEAR = 2016;

// AOI
var boundary = ee.FeatureCollection("projects/thesis-478211/assets/BC_Boundary");
var aoi = boundary.geometry();

Map.centerObject(boundary, 10);
Map.addLayer(boundary.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'Boundary');

// Dynamic World
var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .filterBounds(aoi)
  .select("label");

// Dynamic World palette (0..8)
var VIS = {
  min: 0, max: 8,
  palette: [
    '419bdf','397d49','88b053','7a87c6','e49635',
    'dfc35a','c4281b','a59b8f','b39fe1'
  ]
};

// Optional: how far back to look when filling holes.
// Use null for "since START_YEAR" (strongest fill).
var LOOKBACK_MONTHS = 24;

// ======================
// HELPERS
// ======================

// Per-pixel most-recent label in [fillStart, end)
function mostRecentLabelBefore(endDate, fillStart) {
  var history = dw.filterDate(fillStart, endDate);

  var withTime = history.map(function(img) {
    var t = ee.Image.constant(img.date().millis()).rename('t').toInt64();
    return img.addBands(t);
  });

  // Per pixel: pick label from most recent image where pixel is valid
  return withTime.qualityMosaic('t').select('label');
}

// Quarter MODE + hole fill with most-recent valid label
function quarterlyModeFilled(year, qIndex) {
  year = ee.Number(year);
  qIndex = ee.Number(qIndex);

  var startMonth = qIndex.multiply(3).add(1);
  var start = ee.Date.fromYMD(year, startMonth, 1);
  var end = start.advance(3, 'month');

  var quarterIC = dw.filterDate(start, end);
  var qMode = quarterIC.mode().clip(aoi);

  var fillStart = ee.Algorithms.If(
    LOOKBACK_MONTHS === null,
    ee.Date.fromYMD(START_YEAR, 1, 1),
    start.advance(ee.Number(LOOKBACK_MONTHS).multiply(-1), 'month')
  );
  fillStart = ee.Date(fillStart);

  var recent = mostRecentLabelBefore(end, fillStart).clip(aoi);

  // Fill ONLY masked pixels in qMode
  var qFilled = qMode.unmask(recent);

  return {
    filled: qFilled.set({
      year: year,
      quarter: qIndex.add(1),
      start: start.format('YYYY-MM-dd'),
      end: end.format('YYYY-MM-dd'),
      n_images: quarterIC.size()
    }),
    mode: qMode,
    n: quarterIC.size()
  };
}

// ======================
// UI
// ======================
var panel = ui.Panel({style: {width: '320px'}});
panel.add(ui.Label('Dynamic World Quarterly MODE (Hole-Filled)', {fontWeight: 'bold', fontSize: '14px'}));
panel.add(ui.Label('Holes are filled per-pixel with the most recent valid label up to quarter end.'));

// Year choices
var now = new Date();
var endYear = now.getFullYear();
var yearList = [];
for (var y = START_YEAR; y <= endYear; y++) yearList.push(String(y));

var yearSelect = ui.Select({
  items: yearList,
  value: String(endYear),
  style: {stretch: 'horizontal'}
});

var quarterSelect = ui.Select({
  items: ['Q1', 'Q2', 'Q3', 'Q4'],
  value: 'Q1',
  style: {stretch: 'horizontal'}
});

var showHoles = ui.Checkbox({label: 'Show holes mask (original quarter MODE)', value: false});
var infoLabel = ui.Label('Pick a year/quarter, then click Render.', {whiteSpace: 'pre-wrap'});

var renderBtn = ui.Button({
  label: 'Render',
  style: {stretch: 'horizontal'},
  onClick: function() {
    Map.layers().reset();
    Map.addLayer(boundary.style({color: 'red', fillColor: '00000000', width: 2}), {}, 'Boundary');

    var year = parseInt(yearSelect.getValue(), 10);
    var qIndex = ['Q1','Q2','Q3','Q4'].indexOf(quarterSelect.getValue());

    var out = quarterlyModeFilled(year, qIndex);

    // If no images in quarter, show message
    out.n.evaluate(function(n) {
      if (n === 0) {
        infoLabel.setValue('No Dynamic World images found for ' + year + ' ' + quarterSelect.getValue());
        return;
      }

      // Add filled visualization
      Map.addLayer(out.filled, VIS, 'Filled MODE ' + year + ' ' + quarterSelect.getValue(), true);

      // Optional holes mask: where original qMode is masked (holes)
      if (showHoles.getValue()) {
        var holes = out.mode.mask().not(); // 1 where holes exist
        var holesVis = holes.selfMask().visualize({palette: ['ff0000']});
        Map.addLayer(holesVis, {}, 'Holes (original MODE mask)', true);
      }

      // Info text
      out.filled.get('start').evaluate(function(s) {
        out.filled.get('end').evaluate(function(e) {
          out.filled.get('n_images').evaluate(function(k) {
            infoLabel.setValue(
              'Rendered: ' + year + ' ' + quarterSelect.getValue() + '\n' +
              'Date range: ' + s + ' to ' + e + '\n' +
              'Images in quarter: ' + k + '\n' +
              'Lookback months for fill: ' + (LOOKBACK_MONTHS === null ? 'since ' + START_YEAR : LOOKBACK_MONTHS)
            );
          });
        });
      });
    });
  }
});

panel.add(ui.Label('Year')); panel.add(yearSelect);
panel.add(ui.Label('Quarter')); panel.add(quarterSelect);
panel.add(showHoles);
panel.add(renderBtn);
panel.add(infoLabel);

ui.root.insert(0, panel);
