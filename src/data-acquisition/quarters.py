from datetime import date
import ee
from data_acquisition.config import START_YEAR

def latest_completed_quarter_start() -> date:
    today = date.today()
    q_start_month = ((today.month - 1) // 3) * 3 + 1
    return date(today.year, q_start_month, 1)

def quarter_end_date(year: int, quarter: int) -> date:
    start_month = (quarter - 1) * 3 + 1
    if start_month + 3 > 12:
        return date(year + 1, 1, 1)
    return date(year, start_month + 3, 1)


def build_quarter_windows(start_year: int = START_YEAR) -> list[dict]:
    cutoff  = latest_completed_quarter_start()
    windows = []

    for year in range(start_year, cutoff.year + 1):
        for q in range(1, 5):
            start_month = (q - 1) * 3 + 1
            start_dt    = date(year, start_month, 1)
            end_dt      = quarter_end_date(year, q)

            if end_dt <= cutoff:
                windows.append({
                    "year":    year,
                    "quarter": q,
                    "start":   ee.Date(start_dt.isoformat()),
                    "end":     ee.Date(end_dt.isoformat()),
                })

    return windows