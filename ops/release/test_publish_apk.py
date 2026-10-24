"""Gate tests for publish_apk.py: every refusal has a failing fixture, every happy path a passing one.
Run: cd ops/release && python -m unittest -v test_publish_apk"""
import json
import os
import shutil
import tempfile
import unittest

import _fakeapk as fk
import publish_apk as pa


class MemStore:
    def __init__(self):
        self.objs = {}      # key -> (bytes, sha256-meta)
        self.puts = []
        self.invalidations = []
        self.fail_invalidate = False
        self.race_on = None

    def head(self, key):
        o = self.objs.get(key)
        return None if o is None else {"sha256": o[1], "size": len(o[0])}

    def get(self, key):
        o = self.objs.get(key)
        return None if o is None else o[0]

    def put(self, key, path, *, content_type, cache_control, sha256=None, if_none_match=False):
        if self.race_on == key:
            self.race_on = None
            self.objs[key] = (b"other", "f" * 64)
            raise pa.Exists(key)
        if if_none_match and key in self.objs:
            raise pa.Exists(key)
        with open(path, "rb") as f:
            self.objs[key] = (f.read(), sha256)
        self.puts.append(key)

    def list_objects(self):
        return [{"K": k, "S": len(v[0]), "M": "2026-01-01T00:00:00Z"} for k, v in self.objs.items() if k.endswith(".apk")]

    def download_meta(self, dest):
        for k, (b, _s) in self.objs.items():
            if k.startswith("apk/meta/"):
                with open(os.path.join(dest, k.split("/")[-1]), "wb") as f:
                    f.write(b)

    def invalidate(self, paths):
        if self.fail_invalidate:
            raise pa.Fail("denied")
        self.invalidations.append(paths)
        return "I123456789"


def render_stub(mdir, listing, out):
    body = ""
    for n in sorted(os.listdir(mdir)):
        if n != "latest.json":
            with open(os.path.join(mdir, n)) as f:
                body += json.load(f).get("key", "") + "\n"
    with open(out, "w") as f:
        f.write("<html>" + body + "</html>")


def render_empty(mdir, listing, out):
    with open(out, "w") as f:
        f.write("<html></html>")


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        p = fk.patched()
        p.start()
        self.addCleanup(p.stop)
        self.wm = fk.web_manifest(os.path.join(self.d, "web.sha256"))
        self.store = MemStore()

    def apk(self, name="a.apk", **kw):
        return fk.make_apk(os.path.join(self.d, name), **kw)

    def pub(self, apk, **over):
        a = dict(kind="test", commit=fk.COMMIT, run_id="999", promote_latest=False, approval_ref="",
                 store=self.store, render_index=render_stub, app_id=fk.APP_ID, signer_sha256=fk.SIGNER,
                 previous_version_code=20, now="2026-10-13T00:00:00Z", dry_run=False, log=lambda *_: None)
        a.update(over)
        return pa.publish(apk, self.wm, **a)

    def rec(self, key):
        return json.loads(self.store.objs[pa.meta_key_for(key)][0])

    # ---- passing fixtures
    def test_dry_run_touches_nothing(self):
        r = self.pub(self.apk(), dry_run=True, store=None)
        self.assertTrue(r["dryRun"])
        self.assertFalse(r["apkWritten"])

    def test_test_build_is_stored_permanently_and_never_moves_latest(self):
        r = self.pub(self.apk())
        self.assertTrue(r["apkWritten"])
        self.assertFalse(r["latestMoved"])
        self.assertIn(r["key"], self.store.objs)
        self.assertNotIn(pa.LATEST_KEY, self.store.objs)
        rec = self.rec(r["key"])
        self.assertEqual((rec["versionName"], rec["versionCode"], rec["kind"]), ("1.0.13", 21, "test"))
        self.assertEqual(rec["runId"], "999")
        self.assertIn(pa.INDEX_KEY, self.store.objs)
        self.assertEqual(self.store.invalidations[0], pa.INVALIDATE_PATHS)

    def test_identical_rerun_is_idempotent(self):
        a = self.apk()
        self.pub(a)
        r = self.pub(a)
        self.assertFalse(r["apkWritten"])
        self.assertEqual(self.store.puts.count(r["key"]), 1)

    def test_release_with_promote_moves_latest(self):
        r = self.pub(self.apk(), kind="release", promote_latest=True, approval_ref="founder-2026-10-13")
        self.assertTrue(r["latestMoved"])
        ptr = json.loads(self.store.objs[pa.LATEST_META_KEY][0])
        self.assertEqual((ptr["versionCode"], ptr["key"]), (21, r["key"]))
        self.assertEqual(self.store.objs[pa.LATEST_KEY][1], r["sha256"])

    def test_test_build_promoted_to_release_rewrites_record_only(self):
        a = self.apk()
        r = self.pub(a)
        self.pub(a, kind="release", approval_ref="ok", now="2026-10-20T00:00:00Z")
        rec = self.rec(r["key"])
        self.assertEqual(rec["kind"], "release")
        self.assertEqual(rec["publishedAt"], "2026-10-13T00:00:00Z")

    def test_later_rehearsal_does_not_downgrade_release_record(self):
        a = self.apk()
        r = self.pub(a, kind="release", approval_ref="ok")
        self.pub(a, kind="test")
        self.assertEqual(self.rec(r["key"])["kind"], "release")

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_real_generator_lists_the_published_build(self):
        r = self.pub(self.apk(), render_index=pa.node_render)
        html = self.store.objs[pa.INDEX_KEY][0].decode()
        for needle in (r["key"], "Test build", "v1.0.13", "build 21"):
            self.assertIn(needle, html)

    # ---- failing fixtures (the gate fires)
    def test_same_key_different_bytes_refused(self):
        a = self.apk()
        r = self.pub(a)
        self.store.objs[r["key"]] = (b"tampered", "e" * 64)
        with self.assertRaisesRegex(pa.Fail, "DIFFERENT bytes"):
            self.pub(a)

    def test_lost_race_with_different_bytes_refused(self):
        a = self.apk()
        self.store.race_on = pa.permanent_key("1.0.13", 21, fk.COMMIT, pa.sha256_file(a))
        with self.assertRaisesRegex(pa.Fail, "DIFFERENT bytes"):
            self.pub(a)

    def test_existing_object_without_provable_hash_refused(self):
        a = self.apk()
        self.store.objs[pa.permanent_key("1.0.13", 21, fk.COMMIT, pa.sha256_file(a))] = (b"x", None)
        with self.assertRaisesRegex(pa.Fail, "cannot be established"):
            self.pub(a)

    def test_test_build_cannot_be_promoted_to_latest(self):
        with self.assertRaisesRegex(pa.Fail, "only allowed for kind=release"):
            self.pub(self.apk(), kind="test", promote_latest=True)
        self.assertEqual(self.store.objs, {})

    def test_release_needs_approval_ref(self):
        with self.assertRaisesRegex(pa.Fail, "approval-ref"):
            self.pub(self.apk(), kind="release")

    def test_latest_never_goes_down_or_stays_with_other_bytes(self):
        self.pub(self.apk("n.apk", version_code=22, version_name="1.0.14"), kind="release",
                 promote_latest=True, approval_ref="r")
        with self.assertRaisesRegex(pa.Fail, "latest must rise"):
            self.pub(self.apk("o.apk", version_code=21), kind="release", promote_latest=True, approval_ref="r")
        with self.assertRaisesRegex(pa.Fail, "latest must rise"):  # equal code, different bytes
            self.pub(self.apk("p.apk", version_code=22, version_name="1.0.14", salt=b"2"), kind="release",
                     promote_latest=True, approval_ref="r")

    def test_missing_pointer_uses_previous_published_floor(self):
        with self.assertRaisesRegex(pa.Fail, "latest must rise"):
            self.pub(self.apk(version_code=20), kind="release", promote_latest=True, approval_ref="r")

    def test_wrong_signer_or_package_refused_before_any_write(self):
        for kw in ({"signer": "0" * 64}, {"pkg": "com.evil"}):
            with self.assertRaises(pa.Fail):
                self.pub(self.apk(**kw))
        self.assertEqual(self.store.objs, {})

    def test_failed_invalidation_fails_the_run_loudly(self):
        self.store.fail_invalidate = True
        with self.assertRaisesRegex(pa.Fail, "UPLOADED but CloudFront invalidation"):
            self.pub(self.apk())

    def test_page_missing_the_new_build_is_not_uploaded(self):
        with self.assertRaisesRegex(pa.Fail, "does not list the build"):
            self.pub(self.apk(), render_index=render_empty)
        self.assertNotIn(pa.INDEX_KEY, self.store.objs)

    def test_bad_version_name_cannot_forge_a_key(self):
        with self.assertRaises(pa.Fail):
            self.pub(self.apk(version_name="../../x"))


class AwsStoreTests(unittest.TestCase):
    def store(self, fn):
        self.calls = []

        def runner(args):
            self.calls.append(args)
            return fn(args)
        return pa.AwsStore("b", "EABCDEFGHIJ", runner)

    def test_clean_404_means_absent(self):
        s = self.store(lambda a: (254, b"", "An error occurred (404) when calling HeadObject: Not Found"))
        self.assertIsNone(s.head("k"))

    def test_other_errors_do_not_mean_absent(self):
        with self.assertRaises(pa.Fail):
            self.store(lambda a: (255, b"", "AccessDenied")).head("k")

    def test_put_is_conditional_and_412_maps_to_exists(self):
        s = self.store(lambda a: (1, b"", "PreconditionFailed 412"))
        with self.assertRaises(pa.Exists):
            s.put("k", "f", content_type="t", cache_control="c", sha256="a" * 64, if_none_match=True)
        self.assertIn("--if-none-match", self.calls[0])
        self.assertIn("sha256=" + "a" * 64, self.calls[0])

    def test_invalidation_waits_and_missing_id_fails(self):
        s = self.store(lambda a: (0, b"I1234ABCD\n", ""))
        self.assertEqual(s.invalidate(["/apk/"]), "I1234ABCD")
        self.assertEqual(self.calls[1][:3], ["cloudfront", "wait", "invalidation-completed"])
        with self.assertRaises(pa.Fail):
            self.store(lambda a: (0, b"None\n", "")).invalidate(["/apk/"])


class CliTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)

    def args(self, *extra):
        a = os.path.join(self.d, "a.apk")
        w = os.path.join(self.d, "w")
        fk.make_apk(a)
        fk.web_manifest(w)
        return ["x", "--apk", a, "--web-manifest", w, "--commit", fk.COMMIT, "--run-id", "1", "--kind", "test", *extra]

    def test_execute_without_distribution_is_refused_before_aws(self):
        os.environ.pop("APK_CF_DISTRIBUTION", None)
        with fk.patched():
            self.assertEqual(pa.main(self.args("--execute")), 1)

    def test_default_is_dry_run(self):
        with fk.patched():
            self.assertEqual(pa.main(self.args()), 0)


if __name__ == "__main__":
    unittest.main()
