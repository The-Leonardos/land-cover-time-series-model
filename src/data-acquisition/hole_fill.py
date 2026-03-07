import ee 


def most_recent_label_before(
    end_date: ee.Date,
    fill_start: ee.Date,
    dw: ee.ImageCollection | None = None,
    boundary_geom: ee.Geometry | None = None
) -> ee.Image:
    dw = dw or get_dw()
    boundary_geom = boundary_geom or get_boundary_geom()

    history = dw.filterDate(fill_start, end_date)

    def _add_time(img: ee.Image) -> ee.Image:
        t = ee.Image.constant(img.date().millis()).rename("t").toInt64()
        return img.addBands(t)

    with_time = history.map(_add_time)

    return with_time.qualityMosaic("t").select("label")
