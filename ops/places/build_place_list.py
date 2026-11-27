"""Build the government village list files (LGD) for the server and the phone.

spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, slice S0).

Reads the founder's village CSV (built by build_village_lists.py from the LGD mirror of 26 Nov 2026) and the
district sheet of Maharashtra_geographic_master_PARTIAL.xlsx, and writes two files whose names carry the list
version:

    <out>/lgd-mh-2026-11-26.tsv         one row per village: code, taluka code, Marathi name, English name, PIN, status
    <out>/lgd-mh-2026-11-26-areas.json  the 35 districts (English + Marathi) and 358 talukas (English only)

Rules (nothing is invented):
  * The join key is the village LGD code; it is unique.
  * Names are the list's own; only surrounding whitespace is removed and inner runs of whitespace (the list has
    trailing tabs and double spaces in some Marathi names) become one space.
  * A village with no Marathi name keeps an empty Marathi field (42 of them).
  * A village with no PIN keeps an empty PIN field (125 of them); a village with two PINs stops the build.
  * Taluka Marathi names are NOT written: founder question 8 is open, so they are left out, never guessed.
  * District Marathi names come from the partial sheet's "District master" (source mahavillages.mahabhumi.gov.in);
    a Marathi reader has not checked them.
  * Every row is a secondary source, not independently verified: the header line says so.

Usage (read-only on the inputs; stdlib only):
    python -I build_place_list.py <maharashtra_villages.csv> <Maharashtra_geographic_master_PARTIAL.xlsx> <out-dir>
"""
import csv
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

VERSION = "lgd-mh-2026-11-26"
SOURCE = "LGD mirror 2026-11-26 (villages + pincode_villages parquet)"
PROVENANCE = "Secondary source; not independently verified"
DISTRICT_MR_SOURCE = (
    "Maharashtra_geographic_master_PARTIAL.xlsx, sheet District master "
    "(mahavillages.mahabhumi.gov.in); not checked by a Marathi reader"
)
TALUKA_MR_NOTE = "not loaded: founder question 8 is open; left out, never invented"
EXPECTED = {"villages": 44930, "talukas": 358, "districts": 35}
STATUS = {"Inhabitant": "I", "Un-Inhabitant": "U", "Forest": "F"}
PIN = re.compile(r"^[1-9][0-9]{5}$")
SPACE = re.compile(r"\s+")


def clean(text):
    return SPACE.sub(" ", text or "").strip()


def district_marathi(xlsx_path):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    with zipfile.ZipFile(xlsx_path) as book:
        shared = []
        if "xl/sharedStrings.xml" in book.namelist():
            for item in ET.fromstring(book.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in item.iter("{%s}t" % ns["m"])))
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        targets = {r.get("Id"): r.get("Target").lstrip("/") for r in rels}
        sheet = next(s for s in workbook.find("m:sheets", ns) if s.get("name") == "District master")
        target = targets[sheet.get(rel_ns)]
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(book.read(target)).iter("{%s}row" % ns["m"]):
            values = {}
            for cell in row.findall("m:c", ns):
                column = re.match(r"[A-Z]+", cell.get("r")).group(0)
                value = cell.find("m:v", ns)
                if cell.get("t") == "s" and value is not None:
                    values[column] = shared[int(value.text)]
                elif cell.get("t") == "inlineStr":
                    values[column] = "".join(t.text or "" for t in cell.iter("{%s}t" % ns["m"]))
                else:
                    values[column] = value.text if value is not None else ""
            rows.append(values)
    header = rows[0]
    if header.get("D") != "District LGD" or header.get("F") != "Marathi":
        sys.exit("District master: unexpected header " + repr(header))
    return {int(r["D"]): clean(r.get("F", "")) for r in rows[1:] if (r.get("D") or "").strip()}


def main(csv_path, xlsx_path, out_dir):
    with open(csv_path, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    marathi_districts = district_marathi(xlsx_path)
    villages, talukas, districts = {}, {}, {}
    for row in rows:
        if row["state_lgd"] != "27":
            sys.exit("not a Maharashtra row: " + row["village_lgd"])
        code, taluka, district = int(row["village_lgd"]), int(row["taluka_lgd"]), int(row["district_lgd"])
        if code in villages:
            sys.exit("village code twice: %d" % code)
        pins = [p for p in (row["pin_codes"] or "").split(";") if p.strip()]
        if len(pins) > 1:
            sys.exit("village %d has more than one PIN; the list format holds one" % code)
        pin = pins[0].strip() if pins else ""
        if pin and not PIN.match(pin):
            sys.exit("village %d has a PIN that is not six digits: %r" % (code, pin))
        if row["village_status"] not in STATUS:
            sys.exit("village %d has an unknown status %r" % (code, row["village_status"]))
        name_en = clean(row["village_en"])
        if not name_en:
            sys.exit("village %d has no English name" % code)
        villages[code] = (taluka, clean(row["village_mr"]), name_en, pin, STATUS[row["village_status"]])

        taluka_en = clean(row["taluka"])
        if talukas.setdefault(taluka, (district, taluka_en)) != (district, taluka_en):
            sys.exit("taluka %d is named or placed twice" % taluka)
        district_en = clean(row["district"])
        if districts.setdefault(district, district_en) != district_en:
            sys.exit("district %d is named twice" % district)

    found = {"villages": len(villages), "talukas": len(talukas), "districts": len(districts)}
    if found != EXPECTED:
        sys.exit("counts %r differ from the expected %r" % (found, EXPECTED))
    missing = sorted(set(districts) - set(marathi_districts))
    if missing:
        sys.exit("no Marathi name in the district sheet for district codes %r" % missing)

    os.makedirs(out_dir, exist_ok=True)
    tsv_path = os.path.join(out_dir, VERSION + ".tsv")
    with open(tsv_path, "w", encoding="utf-8", newline="\n") as out:
        out.write("\t".join([
            "#" + VERSION,
            "source=" + SOURCE,
            "provenance=" + PROVENANCE,
            "villages=%d" % found["villages"],
            "talukas=%d" % found["talukas"],
            "districts=%d" % found["districts"],
        ]) + "\n")
        out.write("code\ttaluka\tmr\ten\tpin\tstatus\n")
        for code in sorted(villages):
            taluka, name_mr, name_en, pin, status = villages[code]
            out.write("%d\t%d\t%s\t%s\t%s\t%s\n" % (code, taluka, name_mr, name_en, pin, status))

    areas = {
        "version": VERSION,
        "source": SOURCE,
        "provenance": PROVENANCE,
        "districtNamesMr": DISTRICT_MR_SOURCE,
        "talukaNamesMr": TALUKA_MR_NOTE,
        "districts": [
            {"code": code, "en": districts[code], "mr": marathi_districts[code]}
            for code in sorted(districts)
        ],
        "talukas": [
            {"code": code, "district": talukas[code][0], "en": talukas[code][1]}
            for code in sorted(talukas)
        ],
    }
    areas_path = os.path.join(out_dir, VERSION + "-areas.json")
    with open(areas_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump(areas, out, ensure_ascii=False, indent=1)
        out.write("\n")

    print(VERSION, found, "->", tsv_path, areas_path)
    print("no Marathi name:", sum(1 for v in villages.values() if not v[1]),
          "| no PIN:", sum(1 for v in villages.values() if not v[3]),
          "| status:", {s: sum(1 for v in villages.values() if v[4] == s) for s in "IUF"})


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
