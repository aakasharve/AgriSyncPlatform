"""Generate the app's ONE crop list from the founder's crop master sheet.

spec: plr-d10-redesign-real-integration-2026-10-25 (I18) - "integrate all this list".

Reads the founder's workbook (sheet "MH Crop Master", table "MaharashtraCropMaster": header row with
"Internal Crop ID", one row per MHCR id) with the Python standard library only (an .xlsx is a zip of XML), and
writes `src/domain/crops/cropMasterData.ts`: every crop's id, group, canonical English and Marathi
name, every alternate name in both languages, its kind, its base crop and its visibility level. The text lives
in the app, so the crop list works offline; pictures are NOT written here (see build_crop_images.py).

Re-run it whenever the founder sends a new version of the sheet:

    python scripts/crop-master/generate_crop_master.py [--xlsx PATH] [--out PATH] [--report PATH]

Nothing is invented: a name the sheet does not give is left empty and REPORTED, an unknown visibility value is
treated as hidden (the safe side) and reported, and the run fails (exit 1) when an id is malformed or repeated,
because a picture and a stored crop are tied to that id.

Tests: python -m unittest discover -s scripts/crop-master -p "test_*.py"
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_XLSX = r"G:\APP_Image assents\ShramSafal_Maharashtra_Crop_Master_EN_MR_2026.xlsx"
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "..", "src", "domain", "crops", "cropMasterData.ts"))

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ID_RE = re.compile(r"^MHCR-\d{4}$")

# The sheet's own column headers (row "Internal Crop ID" ...). Columns are found by header, never by letter.
COL_ID = "Internal Crop ID"
COL_GROUP_EN = "Crop Category (EN)"
COL_GROUP_MR = "पीक गट (मराठी)"
COL_EN = "Canonical Crop (EN)"
COL_MR = "मुख्य पीक नाव (मराठी)"
COL_ALT_EN = "Alternate Names (EN)"
COL_ALT_MR = "इतर स्थानिक नावे (मराठी)"
COL_KIND = "Entry Classification"
COL_BASE = "Base Crop ID"
COL_VIS = "Suggested App Visibility"
COL_IMAGE = "Image File Name"
REQUIRED = [COL_ID, COL_GROUP_EN, COL_GROUP_MR, COL_EN, COL_MR, COL_ALT_EN, COL_ALT_MR, COL_KIND, COL_BASE, COL_VIS]

KIND = {
    "crop / species": "crop",
    "tree / boundary / plantation": "tree",
    "use / harvest form": "use-form",
    "fodder / green manure": "fodder",
    "cultivated fungus": "fungus",
}


def nfc(value: str | None) -> str:
    """Trimmed, NFC-normalised text with single spaces (Marathi file names and cells can differ in normal form)."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value or "")).strip()


def visibility_of(raw: str) -> str | None:
    """The sheet's "Suggested App Visibility" -> core | searchable | review | hidden; None when unknown."""
    v = nfc(raw).lower()
    if v.startswith("core candidate"):
        return "core"
    if v.startswith("searchable"):
        return "searchable"
    if v.startswith("review"):
        return "review"
    if v.startswith("hidden"):
        return "hidden"
    return None


def group_key(group_en: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", nfc(group_en).lower().replace("&", " ")).strip("-")


def split_names(raw: str) -> list[str]:
    """"Paddy; Rice (paddy)" -> ["Paddy", "Rice (paddy)"]; empties and repeats dropped, order kept."""
    out: list[str] = []
    for part in re.split(r"[;\n]", raw or ""):
        name = nfc(part)
        if name and name.lower() not in (n.lower() for n in out):
            out.append(name)
    return out


def _col_letters(ref: str) -> str:
    return re.match(r"[A-Z]+", ref).group(0)


def _sheet_path(z: zipfile.ZipFile) -> str:
    """The first worksheet's part name, via the workbook relationships (falls back to sheet1.xml)."""
    try:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheet = wb.find("x:sheets/x:sheet", NS)
        rid = sheet.get(f"{{{REL_NS}}}id")
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target").lstrip("/")
                return target if target.startswith("xl/") else f"xl/{target}"
    except (KeyError, AttributeError, ET.ParseError):
        pass
    return "xl/worksheets/sheet1.xml"


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(t.text or "" for t in si.iter(f"{{{NS['x']}}}t")) for si in root.findall("x:si", NS)]


def read_rows(xlsx_path: str) -> list[dict[str, str]]:
    """Every data row under the header row whose first cell is "Internal Crop ID", keyed by header text."""
    with zipfile.ZipFile(xlsx_path) as z:
        shared = _shared_strings(z)
        root = ET.fromstring(z.read(_sheet_path(z)))
    grid: list[dict[str, str]] = []
    for row in root.find("x:sheetData", NS):
        cells: dict[str, str] = {}
        for c in row:
            kind = c.get("t")
            v = c.find("x:v", NS)
            if kind == "inlineStr":
                text = "".join(t.text or "" for t in c.iter(f"{{{NS['x']}}}t"))
            elif v is None:
                continue
            elif kind == "s":
                text = shared[int(v.text)]
            else:
                text = v.text or ""
            cells[_col_letters(c.get("r"))] = text
        grid.append(cells)
    header_at = next((i for i, cells in enumerate(grid) if nfc(cells.get("A")) == COL_ID), None)
    if header_at is None:
        raise ValueError(f'no header row starting with "{COL_ID}" in {xlsx_path}')
    header = {letter: nfc(text) for letter, text in grid[header_at].items()}
    missing = [h for h in REQUIRED if h not in header.values()]
    if missing:
        raise ValueError(f"sheet is missing columns: {', '.join(missing)}")
    rows = []
    for cells in grid[header_at + 1:]:
        record = {name: nfc(cells.get(letter, "")) for letter, name in header.items()}
        if any(record.values()):
            rows.append(record)
    return rows


def build_master(rows: list[dict[str, str]]) -> tuple[list[dict], dict]:
    """The crops the app ships, and a report of everything that is missing, repeated or unknown."""
    report: dict[str, list] = {
        "errors": [], "missingEnglish": [], "missingMarathi": [], "unknownVisibility": [], "unknownKind": [],
        "unknownBase": [], "repeatedEnglish": [], "repeatedMarathi": [],
    }
    crops: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        cid = row.get(COL_ID, "")
        if not ID_RE.match(cid):
            report["errors"].append(f"malformed id {cid!r}")
            continue
        if cid in seen:
            report["errors"].append(f"repeated id {cid}")
            continue
        seen.add(cid)
        en, mr = row.get(COL_EN, ""), row.get(COL_MR, "")
        if not en:
            report["missingEnglish"].append(cid)
        if not mr:
            report["missingMarathi"].append(cid)
        vis = visibility_of(row.get(COL_VIS, ""))
        if vis is None:
            report["unknownVisibility"].append(f"{cid}: {row.get(COL_VIS, '')!r}")
            vis = "hidden"  # the safe side: never shown until the sheet says how
        kind = KIND.get(nfc(row.get(COL_KIND, "")).lower())
        if kind is None:
            report["unknownKind"].append(f"{cid}: {row.get(COL_KIND, '')!r}")
            kind = "crop"
        alt_en = [n for n in split_names(row.get(COL_ALT_EN, "")) if n.lower() != en.lower()]
        alt_mr = [n for n in split_names(row.get(COL_ALT_MR, "")) if n != mr]
        crops.append({
            "id": cid, "group": group_key(row.get(COL_GROUP_EN, "")), "groupEn": row.get(COL_GROUP_EN, ""),
            "groupMr": row.get(COL_GROUP_MR, ""), "en": en, "mr": mr, "altEn": alt_en, "altMr": alt_mr,
            "kind": kind, "base": row.get(COL_BASE, "") or cid, "vis": vis,
        })
    ids = {c["id"] for c in crops}
    for c in crops:
        if c["base"] not in ids:
            report["unknownBase"].append(f"{c['id']}: {c['base']}")
            c["base"] = c["id"]
    for field, key in (("en", "repeatedEnglish"), ("mr", "repeatedMarathi")):
        by_name: dict[str, list[str]] = {}
        for c in crops:
            if c[field]:
                by_name.setdefault(c[field].lower(), []).append(c["id"])
        report[key] = [f"{name}: {', '.join(cids)}" for name, cids in by_name.items() if len(cids) > 1]
    report["rows"] = len(crops)
    report["visibility"] = {v: sum(1 for c in crops if c["vis"] == v) for v in ("core", "searchable", "review", "hidden")}
    return crops, report


def _ts(value) -> str:
    """A TypeScript literal (JSON strings are valid TS strings; non-ASCII kept readable)."""
    return json.dumps(value, ensure_ascii=False)


def render_ts(crops: list[dict], source_name: str, source_sha256: str) -> str:
    groups: dict[str, tuple[str, str]] = {}
    for c in crops:
        groups.setdefault(c["group"], (c["groupEn"], c["groupMr"]))
    lines = [
        "/**",
        " * AUTO-GENERATED by scripts/crop-master/generate_crop_master.py - do not edit by hand; re-run the script.",
        " *",
        f" * Source: {source_name} (sha256 {source_sha256[:16]}...), {len(crops)} crops.",
        " * spec: plr-d10-redesign-real-integration-2026-10-25 (I18). The founder's own names: no word here is PROPOSED.",
        " */",
        "import type { CropMasterGroup, CropMasterRow } from './cropMaster.types';",
        "",
        f"export const CROP_MASTER_SOURCE = {{ file: {_ts(source_name)}, sha256: {_ts(source_sha256)}, rows: {len(crops)} }} as const;",
        "",
        "export const CROP_MASTER_GROUPS: Readonly<Record<string, CropMasterGroup>> = {",
    ]
    for key, (g_en, g_mr) in groups.items():
        lines.append(f"    {_ts(key)}: {{ en: {_ts(g_en)}, mr: {_ts(g_mr)} }},")
    lines += ["};", "", "export const CROP_MASTER_ROWS: readonly CropMasterRow[] = ["]
    for c in crops:
        lines.append(
            f"    {{ id: {_ts(c['id'])}, group: {_ts(c['group'])}, en: {_ts(c['en'])}, mr: {_ts(c['mr'])}, "
            f"altEn: {_ts(c['altEn'])}, altMr: {_ts(c['altMr'])}, kind: {_ts(c['kind'])}, base: {_ts(c['base'])}, vis: {_ts(c['vis'])} }},"
        )
    lines += ["];", ""]
    return "\n".join(lines)


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--xlsx", default=DEFAULT_XLSX)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--report", default=None, help="also write the report as JSON here")
    args = ap.parse_args(argv)

    crops, report = build_master(read_rows(args.xlsx))
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)
    if report["errors"]:
        print("NOT WRITTEN: fix the errors above in the sheet first.", file=sys.stderr)
        return 1
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(render_ts(crops, os.path.basename(args.xlsx), sha256_of(args.xlsx)))
    print(f"wrote {len(crops)} crops -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
