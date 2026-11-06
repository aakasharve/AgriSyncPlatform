"""Tests for the smoke suite and the G5 verdict. Run: python -m unittest discover -s tests/smoke -p "test_*.py"

The smoke suite is exercised against a real local HTTP server that answers what each test says, so the tests prove
real status-code handling (a 500 on a key read route fails the run; a 200 with the wrong body fails the run)."""
import http.server
import json
import os
import threading
import unittest
from contextlib import contextmanager

import g5_verdict
import smoke


def make_handler(routes):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence
            pass

        def _answer(self):
            key = (self.command, self.path)
            status, body = routes.get(key, (404, {"error": "not found"}))
            if self.command == "GET" and "Authorization" not in self.headers and self.path.startswith(("/shramsafal", "/sync")):
                status, body = 401, {"error": "unauthorized"}
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        do_GET = _answer

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            self._answer()

    return Handler


@contextmanager
def server(routes):
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), make_handler(routes))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()


def healthy_routes():
    return {
        ("GET", "/health"): (200, {"status": "healthy"}),
        ("GET", "/health/ready"): (200, {"status": "ready"}),
        ("GET", "/version"): (200, {"buildSha": "abc1234deadbeef"}),
        ("GET", "/version/app"): (200, {"version": "1.0.18"}),
        ("POST", "/user/auth/login"): (200, {"accessToken": "t"}),
        ("GET", "/shramsafal/farms/mine"): (200, []),
        ("GET", "/sync/pull?since=0"): (200, {"farms": []}),
        ("GET", "/shramsafal/consent/me"): (200, {}),
    }


class SmokeTests(unittest.TestCase):
    def test_all_green_when_server_answers_correctly(self):
        with server(healthy_routes()) as url:
            self.assertEqual(0, smoke.run(url, "9", "p", False, "abc1234"))

    def test_a_500_on_a_key_read_route_fails_the_run(self):
        routes = healthy_routes()
        routes[("GET", "/shramsafal/farms/mine")] = (500, {"error": "boom"})
        with server(routes) as url:
            self.assertEqual(1, smoke.run(url, "9", "p", False, None))

    def test_ready_503_fails_the_run_even_though_health_is_200(self):
        routes = healthy_routes()
        routes[("GET", "/health/ready")] = (503, {"status": "not_ready"})
        with server(routes) as url:
            self.assertEqual(1, smoke.run(url, "9", "p", False, None))

    def test_a_200_with_the_wrong_body_fails(self):
        routes = healthy_routes()
        routes[("GET", "/shramsafal/farms/mine")] = (200, {"not": "a list"})
        with server(routes) as url:
            self.assertEqual(1, smoke.run(url, "9", "p", False, None))

    def test_wrong_deployed_sha_fails(self):
        with server(healthy_routes()) as url:
            self.assertEqual(1, smoke.run(url, "9", "p", False, "ffffffff"))

    def test_unknown_build_sha_fails(self):
        routes = healthy_routes()
        routes[("GET", "/version")] = (200, {"buildSha": "unknown"})
        with server(routes) as url:
            self.assertEqual(1, smoke.run(url, "9", "p", False, None))

    def test_failed_login_fails(self):
        routes = healthy_routes()
        routes[("POST", "/user/auth/login")] = (401, {})
        with server(routes) as url:
            self.assertEqual(1, smoke.run(url, "9", "bad", False, None))

    def test_unreachable_server_fails_rather_than_passing(self):
        self.assertEqual(1, smoke.run("http://127.0.0.1:9", None, None, True, None))

    def test_missing_login_without_no_login_flag_is_a_usage_error(self):
        os.environ.pop("SMOKE_PHONE", None)
        os.environ.pop("SMOKE_PASSWORD", None)
        self.assertEqual(2, smoke.main(["--base-url", "http://127.0.0.1:9"]))


class G5VerdictTests(unittest.TestCase):
    SINCE = g5_verdict.parse_time("2026-11-06T09:00:00Z")

    @staticmethod
    def fresh(n, value=0):
        return {"Datapoints": [{"Sum": value, "Timestamp": f"2026-11-06T09:{i:02d}:00Z"} for i in range(1, n + 1)]}

    def v(self, document, minimum=3):
        return g5_verdict.verdict(document, minimum, self.SINCE)

    def test_no_datapoints_is_no_data_never_green(self):
        self.assertEqual("NO_DATA", self.v({"Datapoints": []})[0])

    def test_too_few_datapoints_is_no_data(self):
        self.assertEqual("NO_DATA", self.v(self.fresh(1))[0])

    def test_heartbeat_of_zeros_is_green(self):
        self.assertEqual("GREEN", self.v(self.fresh(5))[0])

    def test_any_rejection_is_red_even_with_few_points(self):
        self.assertEqual("RED", self.v(self.fresh(1, 2))[0])

    def test_malformed_input_raises(self):
        with self.assertRaises(ValueError):
            self.v({})

    def test_points_without_a_Sum_are_not_a_heartbeat(self):
        average_only = {"Datapoints": [{"Average": 0, "Timestamp": "2026-11-06T09:30:00Z"}] * 5}
        self.assertEqual("NO_DATA", self.v(average_only)[0])

    def test_zero_min_datapoints_is_refused(self):
        with self.assertRaises(ValueError):
            self.v({"Datapoints": []}, 0)
        self.assertEqual(4, g5_verdict.main(["--min-datapoints", "0", "--since", "2026-11-06T09:00:00Z", os.devnull]))

    def test_nan_sums_are_no_data(self):
        doc = {"Datapoints": [{"Sum": float("nan"), "Timestamp": "2026-11-06T09:30:00Z"}] * 5}
        self.assertEqual("NO_DATA", self.v(doc)[0])

    def test_negative_sums_are_no_data_not_a_zero_heartbeat(self):
        self.assertEqual("NO_DATA", self.v(self.fresh(5, -1))[0])

    def test_heartbeats_from_before_the_deploy_do_not_count(self):
        old = {"Datapoints": [{"Sum": 0, "Timestamp": "2026-11-06T08:00:00Z"}] * 5}
        self.assertEqual("NO_DATA", self.v(old)[0])
        self.assertEqual("GREEN", self.v(self.fresh(4))[0])

    def test_since_is_required(self):
        with self.assertRaises(SystemExit) as stop:
            g5_verdict.main([os.devnull])
        self.assertEqual(2, stop.exception.code)  # argparse: a missing required option


if __name__ == "__main__":
    unittest.main()
