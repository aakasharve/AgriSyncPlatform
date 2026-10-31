"""Tests for generate_crop_master.py. Run: python -m unittest discover -s scripts/crop-master -p "test_*.py"

The real-sheet test runs only where the founder's workbook is (it is never faked); the rest build a small workbook
in a temp folder with the same header row the founder's sheet has.
"""
import os
import re
import shutil
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape

import generate_crop_master as gcm

HEADERS = [gcm.COL_ID, gcm.COL_GROUP_EN, gcm.COL_GROUP_MR, gcm.COL_EN, gcm.COL_MR, gcm.COL_ALT_EN, gcm.COL_ALT_MR,
           gcm.COL_KIND, gcm.COL_BASE, gcm.COL_VIS]


def col(i: int) -> str:
    return chr(ord("A") + i)


def make_xlsx(path: str, rows: list[list[str]]) -> None:
    """A minimal workbook: a title row, then the header row, then the rows (inline strings)."""
    def row_xml(r: int, values: list[str]) -> str:
        cells = "".join(
            f'<c r="{col(i)}{r}" t="inlineStr"><is><t>{escape(v)}</t></is></c>' for i, v in enumerate(values) if v != ""
        )
        return f'<row r="{r}">{cells}</row>'

    body = row_xml(1, ["MAHARASHTRA | CROP MASTER"]) + row_xml(2, HEADERS)
    body += "".join(row_xml(3 + i, r) for i, r in enumerate(rows))
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rel}><sheets><sheet name="MH Crop Master" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData>{body}</sheetData></worksheet>")


ROW_RICE = ["MHCR-0001", "Cereals & millets", "धान्य व भरडधान्य", "Rice", "भात", "Paddy; Rice (paddy)", "तांदूळ; धान",
            "Crop / species", "MHCR-0001", "Core candidate — farmer test"]
ROW_GRAPES = ["MHCR-0116", "Fruits", "फळपिके", "Grapes", "द्राक्ष", "Grape; Grapevine", "द्राक्षे",
              "Crop / species", "MHCR-0116", "Searchable — verify crop vs tree"]


class SyntheticSheet(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "master.xlsx")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def build(self, rows):
        make_xlsx(self.path, rows)
        return gcm.build_master(gcm.read_rows(self.path))

    def test_reads_rows_under_the_header_and_splits_alternate_names(self):
        crops, report = self.build([ROW_RICE, ROW_GRAPES])
        self.assertEqual(report["rows"], 2)
        self.assertEqual(report["errors"], [])
        rice = crops[0]
        self.assertEqual((rice["id"], rice["en"], rice["mr"]), ("MHCR-0001", "Rice", "भात"))
        self.assertEqual(rice["altEn"], ["Paddy", "Rice (paddy)"])
        self.assertEqual(rice["altMr"], ["तांदूळ", "धान"])
        self.assertEqual((rice["vis"], crops[1]["vis"]), ("core", "searchable"))
        self.assertEqual(rice["group"], "cereals-millets")

    def test_a_missing_marathi_or_english_name_is_reported_not_invented(self):
        no_mr = list(ROW_RICE)
        no_mr[4] = ""
        no_en = list(ROW_GRAPES)
        no_en[3] = ""
        crops, report = self.build([no_mr, no_en])
        self.assertEqual(report["missingMarathi"], ["MHCR-0001"])
        self.assertEqual(report["missingEnglish"], ["MHCR-0116"])
        self.assertEqual(crops[0]["mr"], "")
        self.assertEqual(crops[1]["en"], "")

    def test_repeated_or_malformed_ids_are_errors_and_nothing_is_written(self):
        bad = list(ROW_GRAPES)
        bad[0] = "MHCR-116"
        _, report = self.build([ROW_RICE, ROW_RICE, bad])
        self.assertIn("repeated id MHCR-0001", report["errors"])
        self.assertTrue(any("malformed id" in e for e in report["errors"]))
        out = os.path.join(self.dir, "out.ts")
        self.assertEqual(gcm.main(["--xlsx", self.path, "--out", out]), 1)
        self.assertFalse(os.path.exists(out))

    def test_unknown_visibility_is_hidden_and_reported(self):
        odd = list(ROW_RICE)
        odd[9] = "Maybe later"
        crops, report = self.build([odd])
        self.assertEqual(crops[0]["vis"], "hidden")
        self.assertEqual(len(report["unknownVisibility"]), 1)

    def test_writes_one_typed_row_per_crop(self):
        make_xlsx(self.path, [ROW_RICE, ROW_GRAPES])
        out = os.path.join(self.dir, "out.ts")
        self.assertEqual(gcm.main(["--xlsx", self.path, "--out", out]), 0)
        with open(out, encoding="utf-8") as f:
            text = f.read()
        self.assertIn("export const CROP_MASTER_ROWS: readonly CropMasterRow[] = [", text)
        self.assertEqual(len(re.findall(r'^    \{ id: "MHCR-\d{4}"', text, re.M)), 2)
        self.assertIn('mr: "द्राक्ष"', text)


REAL = gcm.DEFAULT_XLSX


@unittest.skipUnless(os.path.exists(REAL), "the founder's workbook is not on this machine")
class FoundersSheet(unittest.TestCase):
    def test_310_rows_unique_ids_every_name_present_or_reported(self):
        crops, report = gcm.build_master(gcm.read_rows(REAL))
        self.assertEqual(report["rows"], 310)
        ids = [c["id"] for c in crops]
        self.assertEqual(len(set(ids)), 310)
        self.assertEqual(ids[0], "MHCR-0001")
        self.assertEqual(ids[-1], "MHCR-0310")
        self.assertEqual(report["errors"], [])
        for c in crops:
            self.assertTrue(c["en"] or c["id"] in report["missingEnglish"], c["id"])
            self.assertTrue(c["mr"] or c["id"] in report["missingMarathi"], c["id"])
        self.assertEqual(report["visibility"], {"core": 43, "searchable": 85, "review": 83, "hidden": 99})

    def test_the_committed_data_file_is_current(self):
        crops, _ = gcm.build_master(gcm.read_rows(REAL))
        with open(gcm.DEFAULT_OUT, encoding="utf-8") as f:
            committed = f.read()
        self.assertEqual(committed, gcm.render_ts(crops, os.path.basename(REAL), gcm.sha256_of(REAL)))


if __name__ == "__main__":
    unittest.main()
