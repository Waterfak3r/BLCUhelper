"""Dependency-free consumer regressions; no external endpoints or notifications."""
import copy
import base64
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import smtplib
from email import policy
from email.parser import BytesParser
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("wechat_mp_watchdog", Path(__file__).resolve().parents[1] / "scripts/wechat-mp-watchdog.py")
w = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = w
SPEC.loader.exec_module(w)

ENV = {"WATCHDOG_EMAIL_ENABLED": "true", "WATCHDOG_SMTP_HOST": "localhost", "WATCHDOG_MAIL_FROM": "watchdog@example.test", "WATCHDOG_MAIL_TO": "operator@example.test"}


def health(**changes):
    data = {"scheduler_running": True, "in_fetch_window": True,
            "accounts": {"total": 1, "active": 1, "cooldown": 0, "invalid": 0},
            "subscriptions": [{"id": "one", "name": "private name", "enabled": True, "interval_minutes": 30,
                               "last_fetch_time": 0, "next_fetch_time": 20000, "fetching": False, "error_kind": None}]}
    data.update(changes)
    return data


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==")


def auth_health():
    return health(accounts={"total": 1, "active": 0, "cooldown": 0, "invalid": 1})


class FakeAuthorizer:
    def __init__(self, clock):
        self.clock = clock
        self.requests = 0
        self.login = {}
        self.qr = None

    def qrcode(self):
        self.requests += 1
        if self.qr is None or self.qr["expires_at"] <= self.clock():
            self.qr = {"uuid": "session_" + str(self.requests), "expires_at": self.clock() + 300,
                       "qrcode": {"qrcodebase64": base64.b64encode(PNG).decode()}}
        return copy.deepcopy(self.qr)

    def status(self):
        live = {"uuid": self.qr["uuid"] if self.qr else None,
                "expires_at": self.qr["expires_at"] if self.qr else 0,
                "status": "scanning" if self.qr else "idle", "progress": 20 if self.qr else 0}
        live.update(copy.deepcopy(self.login))
        return {"login_state": live}


def payload(data=None):
    return {"status": "ok", "version": "test", "modules": 1, "watchdog": data or health()}


class FakeRuntime:
    def __init__(self, state="running", failure=False):
        self.state = state
        self.restarts = 0
        self.failure = failure

    def get_state(self):
        return self.state

    def restart(self):
        self.restarts += 1
        if self.failure:
            raise w.WatchdogError("runtime_command_failed")


class ClassificationTests(unittest.TestCase):
    def test_auth_and_verification_are_manual_and_block_other_stall(self):
        for kind in ("auth", "verification"):
            data = health(scheduler_running=False)
            stalled = copy.deepcopy(data["subscriptions"][0])
            stalled.update(id="two", next_fetch_time=1)
            data["subscriptions"].append(stalled)
            data["subscriptions"][0]["error_kind"] = kind
            finding = w.classify(data, 10000)
            self.assertTrue(finding.manual)
            self.assertFalse(finding.recoverable)
            self.assertIn("subscription_" + kind, finding.codes)

    def test_account_auth_or_cooldown_never_restarts(self):
        for cooldown, code in ((0, "accounts_auth"), (1, "accounts_cooldown")):
            data = health(scheduler_running=False, accounts={"total": 1, "active": 0, "cooldown": cooldown, "invalid": 0})
            finding = w.classify(data, 10000)
            self.assertIn(code, finding.codes)
            self.assertFalse(finding.recoverable)

    def test_overdue_boundary_window_disabled_and_fetching(self):
        data = health()
        data["subscriptions"][0]["next_fetch_time"] = 1000
        self.assertFalse(w.classify(data, 1600).codes)
        self.assertTrue(w.classify(data, 1601).recoverable)
        for field, value in (("enabled", False), ("fetching", True)):
            changed = copy.deepcopy(data)
            changed["subscriptions"][0][field] = value
            self.assertFalse(w.classify(changed, 5000).codes)
        data["in_fetch_window"] = False
        self.assertFalse(w.classify(data, 5000).codes)

    def test_collection_warning_is_not_recoverable(self):
        data = health()
        data["subscriptions"][0].update(error_kind="collection", next_fetch_time=1)
        result = w.classify(data, 10000)
        self.assertEqual(result.codes, ("subscription_collection",))
        self.assertFalse(result.recoverable)

    def test_no_subscriptions_still_checks_scheduler(self):
        self.assertTrue(w.classify(health(subscriptions=[]), 10000).paused)
        self.assertTrue(w.classify(health(subscriptions=[], scheduler_running=False), 10000).recoverable)

    def test_malformed_schema_never_healthy(self):
        broken = [None, {}, payload()]
        broken[-1]["watchdog"]["subscriptions"][0]["fetching"] = "false"
        for item in broken:
            with self.assertRaises(w.WatchdogError):
                w.validate_health(item)
        bad = payload()
        bad["watchdog"]["accounts"]["active"] = True
        with self.assertRaises(w.WatchdogError):
            w.validate_health(bad)
        self.assertEqual(w.validate_health(payload()), health())


class WatchdogCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / "state.json"
        self.runtime = FakeRuntime()
        self.sent = []
        self.now = 10000
        self.sleeps = []
        self.authorizer = FakeAuthorizer(lambda: self.now)

    def run_check(self, probe=None, **kwargs):
        return w.run_once(self.runtime, self.state, env=ENV, probe=probe or health,
                          send=kwargs.pop("send", lambda config, event: self.sent.append(copy.deepcopy(event))),
                          clock=lambda: self.now, sleep=self.sleeps.append,
                          authorizer=kwargs.pop("authorizer", self.authorizer), **kwargs)


class LifecycleTests(WatchdogCase):
    def test_initial_healthy_quiet(self):
        result = self.run_check()
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(self.sent)
        self.assertEqual(self.runtime.restarts, 0)

    def test_auto_recovery_sends_single_result(self):
        observations = iter([health(scheduler_running=False), health()])
        result = self.run_check(lambda: next(observations))
        self.assertEqual(self.runtime.restarts, 1)
        self.assertEqual(self.sleeps, [10])
        self.assertEqual([event["kind"] for event in self.sent], ["recovery"])
        self.assertIn("auto_recovered", self.sent[0]["notes"])
        self.assertEqual(result["exit_code"], 0)

    def test_interrupted_restart_preserves_fault_and_next_check_recovery(self):
        restarted = False
        def restart_then_interrupt():
            nonlocal restarted
            self.runtime.restarts += 1
            restarted = True
            raise KeyboardInterrupt()
        self.runtime.restart = restart_then_interrupt
        def probe():
            return health(scheduler_running=restarted)
        with self.assertRaises(KeyboardInterrupt):
            self.run_check(probe)
        saved = w.load_state(self.state)
        self.assertEqual(saved["last_restart_at"], self.now)
        self.assertEqual(saved["incident_key"], "scheduler_stopped")
        self.assertEqual(len(saved["pending_notifications"]), 1)
        original = saved["pending_notifications"][0]
        self.assertEqual(original["kind"], "fault")
        self.assertFalse(self.sent)
        self.now += 600
        result = self.run_check(probe)
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(self.runtime.restarts, 1)
        self.assertEqual([event["kind"] for event in self.sent], ["fault", "recovery"])
        self.assertEqual(self.sent[0]["id"], original["id"])
        self.assertEqual(self.sent[0]["created_at"], original["created_at"])
        self.assertEqual(w.load_state(self.state)["pending_notifications"], [])

    def test_auto_recovery_coalesces_only_new_event_not_prior_pending_fault(self):
        data = health()
        data["subscriptions"][0]["error_kind"] = "auth"
        def fail(*_):
            raise w.WatchdogError("smtp_delivery_failed")
        self.run_check(lambda: data, send=fail)
        original = w.load_state(self.state)["pending_notifications"][0]
        observations = iter([health(scheduler_running=False), health()])
        result = self.run_check(lambda: next(observations))
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual([event["kind"] for event in self.sent], ["fault", "recovery"])
        self.assertEqual(self.sent[0], original)
        self.assertNotEqual(self.sent[1]["id"], original["id"])
        self.assertIn("auto_recovered", self.sent[1]["notes"])

    def test_failed_restart_persists_cooldown_before_command(self):
        def fail():
            self.assertEqual(w.load_state(self.state)["last_restart_at"], self.now)
            self.runtime.restarts += 1
            raise w.WatchdogError("runtime_command_failed")
        self.runtime.restart = fail
        result = self.run_check(lambda: health(scheduler_running=False))
        self.assertEqual(result["exit_code"], 1)
        self.now += 3599
        result = self.run_check(lambda: health(scheduler_running=False))
        self.assertEqual(self.runtime.restarts, 1)
        self.assertIn("restart_cooldown", result["notes"])
        self.now += 1
        self.run_check(lambda: health(scheduler_running=False))
        self.assertEqual(self.runtime.restarts, 2)
        self.assertEqual(len(self.sent), 1)

    def test_fault_changed_problem_and_recovery_notifications(self):
        data = health()
        data["subscriptions"][0]["error_kind"] = "auth"
        self.run_check(lambda: data)
        self.run_check(lambda: data)
        data["subscriptions"][0]["error_kind"] = "verification"
        self.run_check(lambda: data)
        self.run_check()
        self.assertEqual([event["kind"] for event in self.sent], ["fault", "fault", "recovery"])
        self.assertEqual(self.runtime.restarts, 0)
        self.assertNotIn("private name", self.state.read_text())

    def test_failed_delivery_retains_fifo_and_stable_identity_through_recovery(self):
        attempted = []
        def fail(config, event):
            attempted.append(copy.deepcopy(event))
            raise w.WatchdogError("smtp_delivery_failed")
        data = health()
        data["subscriptions"][0]["error_kind"] = "auth"
        first = self.run_check(lambda: data, send=fail)
        self.assertEqual(first["pending"], 1)
        second = self.run_check(send=fail)
        self.assertEqual(second["pending"], 2)
        self.assertEqual(attempted[0]["id"], attempted[1]["id"])
        third = self.run_check()
        self.assertEqual(third["pending"], 0)
        self.assertEqual([event["kind"] for event in self.sent], ["fault", "recovery"])
        self.assertEqual(self.sent[0]["id"], attempted[0]["id"])

    def test_stopped_neither_resolves_nor_delivers_pending(self):
        data = health()
        data["subscriptions"][0]["error_kind"] = "auth"
        self.run_check(lambda: data, send=lambda *_: (_ for _ in ()).throw(w.WatchdogError("smtp_delivery_failed")))
        before = self.state.read_bytes()
        self.runtime.state = "stopped"
        result = self.run_check(lambda: self.fail("stopped runtime must not be probed"))
        self.assertTrue(result["paused"])
        self.assertEqual(self.state.read_bytes(), before)
        self.assertFalse(self.sent)
        self.assertEqual(self.runtime.restarts, 0)

    def test_unknown_missing_notify_without_restart(self):
        for state in ("unknown", "missing"):
            self.runtime.state = state
            result = self.run_check(lambda: self.fail("runtime not running"))
            self.assertEqual(result["exit_code"], 1)
            self.assertEqual(self.runtime.restarts, 0)
        self.assertEqual(len(self.sent), 2)

    def test_probe_only_is_read_only_without_mail_configuration(self):
        self.state.write_text("invalid state intentionally")
        result = w.run_once(self.runtime, self.state, env={}, probe_only=True, probe=health, clock=lambda: self.now)
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(self.state.read_text(), "invalid state intentionally")
        self.assertEqual(self.runtime.restarts, 0)

    def test_missing_config_prevents_recovery_and_state_writes(self):
        with self.assertRaises(w.WatchdogError):
            w.run_once(self.runtime, self.state, env={}, probe=lambda: health(scheduler_running=False))
        self.assertFalse(self.state.exists())
        self.assertEqual(self.runtime.restarts, 0)

    def test_multiple_recipients_rejected_before_any_check_or_mutation(self):
        env = {**ENV, "WATCHDOG_MAIL_TO": "first@example.test,second@example.test"}
        with self.assertRaises(w.WatchdogError) as caught:
            w.run_once(self.runtime, self.state, env=env,
                       probe=lambda: self.fail("Invalid recipient configuration must prevent probing"),
                       send=lambda *_: self.fail("Invalid recipient configuration must prevent delivery"))
        self.assertEqual(str(caught.exception), "smtp_config_invalid")
        self.assertFalse(self.state.exists())
        self.assertEqual(self.runtime.restarts, 0)

    def test_single_recipient_smtp_refusal_retains_fault_for_later_delivery(self):
        data = health()
        data["subscriptions"][0]["error_kind"] = "auth"
        client = MagicMock()
        client.__enter__.return_value = client
        client.send_message.side_effect = smtplib.SMTPRecipientsRefused(
            {"operator@example.test": (550, b"private server response")})
        with patch.object(w.smtplib, "SMTP_SSL", return_value=client):
            result = self.run_check(lambda: data, send=w.send_notification)
        self.assertEqual(result["exit_code"], 1)
        self.assertEqual(result["error"], "smtp_delivery_failed")
        self.assertEqual(result["sent"], 0)
        pending = w.load_state(self.state)["pending_notifications"]
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["kind"], "fault")
        self.assertNotIn("private server response", self.state.read_text())
        self.run_check(lambda: data)
        self.assertEqual(self.sent[0]["id"], pending[0]["id"])
        self.assertEqual(w.load_state(self.state)["pending_notifications"], [])

    def test_unreachable_restarts_only_running(self):
        def offline():
            raise w.WatchdogError("health_unreachable")
        result = self.run_check(offline)
        self.assertEqual(self.runtime.restarts, 1)
        self.assertIn("health_unreachable", result["codes"])
        self.assertEqual(self.sleeps, [10])

    def test_corrupt_state_is_not_overwritten(self):
        self.state.write_text("not json")
        with self.assertRaises(w.WatchdogError):
            self.run_check()
        self.assertEqual(self.state.read_text(), "not json")

    def test_operator_stop_during_recovery_does_not_send_or_resolve(self):
        def stop():
            self.runtime.restarts += 1
            self.runtime.state = "stopped"
        self.runtime.restart = stop
        result = self.run_check(lambda: health(scheduler_running=False))
        self.assertTrue(result["paused"])
        self.assertEqual(result["runtime"], "stopped")
        self.assertFalse(self.sent)
        self.assertEqual(w.load_state(self.state)["last_restart_at"], self.now)


class AuthorizationTests(WatchdogCase):
    def test_auth_incident_requests_once_and_survives_fault_changes(self):
        self.run_check(auth_health)
        qr = next(event for event in self.sent if event["kind"] == "authorization_qr")
        self.assertEqual(w.decode_image(qr["authorization"]["image"])[0], PNG)
        self.now += 60
        data = auth_health()
        data["subscriptions"][0]["error_kind"] = "auth"
        self.run_check(lambda: data)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(sum(event["kind"] == "authorization_qr" for event in self.sent), 1)
        self.now += 600
        self.run_check(lambda: data)
        self.run_check(lambda: data)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)
        self.assertEqual(self.runtime.restarts, 0)

    def test_smtp_retry_preserves_image_and_identity_until_expiry(self):
        attempted = []
        def fail(config, event):
            attempted.append(copy.deepcopy(event))
            raise w.WatchdogError("smtp_delivery_failed")
        self.run_check(auth_health, send=fail)
        self.now += 60
        self.run_check(auth_health, send=fail)
        self.assertEqual(attempted[0], attempted[1])
        self.assertEqual(self.authorizer.requests, 1)
        self.now += 241
        self.run_check(auth_health)
        self.assertFalse(any(event["kind"] == "authorization_qr" for event in self.sent))
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)

    def test_explicit_renewal_and_resend_reuse_live_session(self):
        self.run_check(authorize=True)
        first = self.sent[0]["authorization"]
        self.now += 10
        self.run_check(authorize=True)
        self.assertEqual(first, self.sent[1]["authorization"])
        self.now += 300
        self.run_check(authorize=True)
        latest = [event for event in self.sent if event["kind"] == "authorization_qr"][-1]
        self.assertNotEqual(first["uuid"], latest["authorization"]["uuid"])
        self.assertEqual(self.runtime.restarts, 0)

    def test_manual_old_active_account_does_not_resolve_session(self):
        # When the collector still has an old active account, status reports logged_in: True.
        # An explicit --authorize session MUST require its own UUID with progress 100.
        self.run_check(authorize=True)
        marker = w.load_state(self.state)["authorization"]
        self.authorizer.login = {"uuid": marker["uuid"], "status": "scanned", "progress": 90,
                                 "expires_at": self.now + 280}
        self.run_check()
        self.assertFalse(any(event["kind"] == "authorization_restored" for event in self.sent))
        self.authorizer.login.update(status="success", progress=100)
        self.run_check()
        self.assertIsNone(w.load_state(self.state)["authorization"])
        self.assertEqual(sum(event["kind"] == "authorization_restored" for event in self.sent), 1)

    def test_recovery_prunes_unsent_qr_without_claiming_full_health(self):
        self.run_check(auth_health, send=lambda *_: (_ for _ in ()).throw(w.WatchdogError("smtp_delivery_failed")))
        data = health()
        data["subscriptions"][0]["error_kind"] = "collection"
        result = self.run_check(lambda: data)
        self.assertEqual(result["codes"], ["subscription_collection"])
        self.assertEqual(result["exit_code"], 1)
        self.assertIsNone(w.load_state(self.state)["authorization"])
        self.assertTrue(any(event["kind"] == "authorization_restored" for event in self.sent))
        self.assertFalse(any(event["kind"] == "authorization_qr" for event in self.sent))
        self.assertFalse(any(event["kind"] == "recovery" for event in self.sent))

    def test_background_generation_gates(self):
        cases = [health(), health(subscriptions=[]), auth_health(), auth_health(), auth_health(), auth_health()]
        cases[2]["accounts"]["cooldown"] = 1
        cases[3]["subscriptions"][0]["error_kind"] = "verification"
        cases[4]["subscriptions"][0]["enabled"] = False
        cases[5]["accounts"]["invalid"] = 0
        for data in cases:
            self.run_check(lambda: data)
        self.assertEqual(self.authorizer.requests, 0)
        self.runtime.state = "stopped"
        self.run_check()
        self.assertEqual(self.authorizer.requests, 0)

    def test_runtime_stop_before_post_prevents_generation(self):
        states = iter(["running", "stopped", "stopped"])
        self.runtime.get_state = lambda: next(states)
        result = self.run_check(auth_health)
        self.assertTrue(result["paused"])
        self.assertEqual(self.authorizer.requests, 0)
        self.assertFalse(self.sent)

    def test_v1_migration_preserves_cooldown_incident_and_pending(self):
        event = w.new_event("fault", ("scheduler_stopped",), [], self.now - 100)
        old = {"version": 1, "last_restart_at": self.now - 30, "incident_key": "scheduler_stopped",
               "pending_notifications": [event]}
        self.state.write_text(json.dumps(old))
        self.run_check(lambda: health(scheduler_running=False),
                       send=lambda *_: (_ for _ in ()).throw(w.WatchdogError("smtp_delivery_failed")))
        saved = json.loads(self.state.read_text())
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["last_restart_at"], old["last_restart_at"])
        self.assertEqual(saved["incident_key"], old["incident_key"])
        self.assertEqual(saved["pending_notifications"], [event])
        self.assertEqual(self.runtime.restarts, 0)

    def test_invalid_authorization_state_is_never_overwritten(self):
        self.run_check(authorize=True)
        saved = json.loads(self.state.read_text())
        saved["authorization"]["manual"] = "false"
        self.state.write_text(json.dumps(saved))
        before = self.state.read_bytes()
        with self.assertRaises(w.WatchdogError):
            self.run_check()
        self.assertEqual(before, self.state.read_bytes())

    def test_probe_only_never_requests_auth_or_reads_state(self):
        self.state.write_text("bad state")
        self.run_check(auth_health, probe_only=True)
        self.assertEqual(self.authorizer.requests, 0)
        self.assertEqual(self.state.read_text(), "bad state")

    def test_invalid_qr_marks_once_without_background_renewal(self):
        self.authorizer.qr = {"uuid": "x", "expires_at": self.now + 301,
                              "qrcode": {"qrcodebase64": base64.b64encode(PNG).decode()}}
        self.run_check(auth_health)
        self.run_check(auth_health)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)
        self.assertFalse(any(event["kind"] == "authorization_qr" for event in self.sent))

    def test_qr_validation_rejects_invalid_images_and_ttl(self):
        valid = self.authorizer.qrcode()
        for expiry in (self.now, self.now - 1, self.now + 301, True, float("nan")):
            with self.assertRaises(w.WatchdogError):
                w.validate_qr({**valid, "expires_at": expiry}, self.now)
        for encoded in ("https://example.test/image", "data:image/png;base64,abcd",
                        base64.b64encode(b"not an image").decode(), base64.b64encode(PNG).decode() + "\\n",
                        "A" * (w.MAX_RESPONSE + 4)):
            with self.assertRaises(w.WatchdogError):
                w.validate_qr({**valid, "qrcode": {"qrcodebase64": encoded}}, self.now)
        self.assertEqual(w.validate_qr(valid, self.now)["uuid"], valid["uuid"])

    def test_real_sender_mime_contains_inline_and_attachment_image(self):
        now = w.time.time()
        qr = self.authorizer.qrcode()
        qr["expires_at"] = now + 300
        event = w.new_event("authorization_qr", (), [], now)
        event["authorization"] = w.validate_qr(qr, now)
        client = MagicMock()
        client.__enter__.return_value = client
        client.send_message.return_value = {}
        with patch.object(w.smtplib, "SMTP_SSL", return_value=client):
            w.send_notification(w.MailConfig.from_env(ENV), event)
        message = BytesParser(policy=policy.default).parsebytes(client.send_message.call_args.args[0].as_bytes())
        images = [part for part in message.walk() if part.get_content_maintype() == "image"]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(part.get_content_type() == "image/png" and part.get_payload(decode=True) == PNG for part in images))
        self.assertTrue(any(part.get_content_disposition() == "attachment" for part in images))
        inline = next(part for part in images if part["Content-ID"])
        html = message.get_body(preferencelist=("html",)).get_content()
        self.assertIn("cid:" + inline["Content-ID"].strip("<>"), html)
        self.assertNotIn("http", html)
        self.assertIn("--authorize", message.get_body(preferencelist=("plain",)).get_content())
        self.assertIn(event["id"], message["Message-ID"])

    def test_manual_success_progress90_is_not_saved_authorization(self):
        self.run_check(authorize=True)
        marker = w.load_state(self.state)["authorization"]
        self.authorizer.login = {"uuid": marker["uuid"], "status": "success", "progress": 90}
        self.run_check()
        self.assertIsNotNone(w.load_state(self.state)["authorization"])
        self.assertFalse(any(event["kind"] == "authorization_restored" for event in self.sent))

    def test_post_network_failure_notifies_once_and_requires_explicit_renewal(self):
        def offline():
            self.authorizer.requests += 1
            raise w.WatchdogError("authorization_unreachable")
        self.authorizer.qrcode = offline
        self.run_check(auth_health)
        self.now += 600
        self.run_check(auth_health)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)
        self.assertEqual(w.load_state(self.state)["authorization"]["phase"], "failed")

    def test_failed_session_discards_pending_image(self):
        self.run_check(auth_health, send=lambda *_: (_ for _ in ()).throw(w.WatchdogError("smtp_delivery_failed")))
        marker = w.load_state(self.state)["authorization"]
        self.authorizer.login = {"uuid": marker["uuid"], "status": "failed", "progress": 0}
        self.run_check(auth_health)
        self.assertFalse(any(event["kind"] == "authorization_qr" for event in self.sent))
        self.assertTrue(any(event["kind"] == "authorization_expired" for event in self.sent))

    def test_v1_upgrade_on_stopped_run_does_not_send_or_reset(self):
        old = {"version": 1, "last_restart_at": 9000, "incident_key": "accounts_auth",
               "pending_notifications": [w.new_event("fault", ("accounts_auth",), [], 9000)]}
        self.state.write_text(json.dumps(old))
        self.runtime.state = "stopped"
        self.run_check()
        saved = json.loads(self.state.read_text())
        self.assertEqual(saved, {**old, "version": 2, "authorization": None})
        self.assertFalse(self.sent)

    def test_slow_qr_post_uses_response_time_for_ttl(self):
        original = self.authorizer.qrcode
        def slow():
            self.now += 25
            return original()
        self.authorizer.qrcode = slow
        self.run_check(auth_health)
        image = next(event for event in self.sent if event["kind"] == "authorization_qr")
        self.assertEqual(image["authorization"]["expires_at"], self.now + 300)
        self.assertEqual(image["created_at"], self.now)

    def test_malformed_v1_never_migrates_or_restarts(self):
        old = {"version": 1, "last_restart_at": True, "incident_key": None, "pending_notifications": []}
        self.state.write_text(json.dumps(old))
        before = self.state.read_bytes()
        with self.assertRaises(w.WatchdogError):
            self.run_check()
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(self.runtime.restarts, 0)

    def test_cli_authorize_uses_existing_service_and_sanitized_output(self):
        output = io.StringIO()
        with patch.dict(w.os.environ, ENV, clear=True), patch.object(w, "DockerRuntime", return_value=self.runtime), \
                patch.object(w, "probe_health", return_value=health(in_fetch_window=False)), \
                patch.object(w, "AuthorizationClient", return_value=self.authorizer), \
                patch.object(w.smtplib, "SMTP_SSL") as smtp, contextlib.redirect_stdout(output):
            client = smtp.return_value
            client.__enter__.return_value = client
            client.send_message.return_value = {}
            # The CLI uses real wall time, so keep the injected local server clock aligned.
            self.authorizer.clock = w.time.time
            result = w.main(["--authorize", "--state", str(self.state)])
        self.assertEqual(result, 0)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(self.runtime.restarts, 0)
        summary = json.loads(output.getvalue())
        self.assertEqual(summary["sent"], 1)
        self.assertNotIn("session_", output.getvalue())
        self.assertNotIn(base64.b64encode(PNG).decode(), output.getvalue())

    def test_cli_modes_are_mutually_exclusive(self):
        for option in ("--probe-only", "--test-email"):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
                w.main(["--authorize", option])
            self.assertEqual(caught.exception.code, 2)

    def test_jpeg_image_keeps_actual_mime(self):
        now = w.time.time()
        image = b"\xff\xd8\xff\xe0" + b"jpeg-image" + b"\xff\xd9"
        qr = {"uuid": "jpeg-session", "expires_at": now + 300,
              "qrcode": {"qrcodebase64": base64.b64encode(image).decode()}}
        event = w.new_event("authorization_qr", (), [], now)
        event["authorization"] = w.validate_qr(qr, now)
        client = MagicMock()
        client.__enter__.return_value = client
        client.send_message.return_value = {}
        with patch.object(w.smtplib, "SMTP_SSL", return_value=client):
            w.send_notification(w.MailConfig.from_env(ENV), event)
        message = BytesParser(policy=policy.default).parsebytes(client.send_message.call_args.args[0].as_bytes())
        parts = [part for part in message.walk() if part.get_content_maintype() == "image"]
        self.assertEqual(len(parts), 2)
        self.assertTrue(all(part.get_content_type() == "image/jpeg" and part.get_payload(decode=True) == image for part in parts))

    def test_explicit_post_failure_is_not_reported_as_success(self):
        def offline():
            raise w.WatchdogError("authorization_unreachable")
        self.authorizer.qrcode = offline
        result = self.run_check(authorize=True)
        self.assertEqual(result["exit_code"], 1)
        self.assertEqual(result["error"], "authorization_failed")
        self.assertTrue(any(event["kind"] == "authorization_expired" for event in self.sent))

    def test_interrupt_around_post_persists_marker_and_never_repeats_automatically(self):
        def interrupt():
            saved = w.load_state(self.state)
            self.assertEqual(saved["authorization"]["phase"], "requesting")
            self.authorizer.requests += 1
            raise KeyboardInterrupt()
        self.authorizer.qrcode = interrupt
        with self.assertRaises(KeyboardInterrupt):
            self.run_check(auth_health)
        self.run_check(auth_health)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)

    def test_completed_session_before_delivery_never_sends_stale_qr(self):
        original = self.authorizer.qrcode
        def completed():
            qr = original()
            self.authorizer.login = {"uuid": qr["uuid"], "status": "success", "progress": 100}
            return qr
        self.authorizer.qrcode = completed
        self.run_check(auth_health)
        self.assertFalse(any(event["kind"] == "authorization_qr" for event in self.sent))
        self.assertEqual(sum(event["kind"] == "authorization_restored" for event in self.sent), 1)

    def test_expiry_during_tls_handshake_never_sends_image(self):
        event = w.new_event("authorization_qr", (), [], self.now)
        event["authorization"] = w.validate_qr(self.authorizer.qrcode(), self.now)
        client = MagicMock()
        client.__enter__.return_value = client
        with patch.object(w.time, "time", side_effect=[self.now, self.now + 301]), \
                patch.object(w.smtplib, "SMTP_SSL", return_value=client):
            with self.assertRaises(w.WatchdogError):
                w.send_notification(w.MailConfig.from_env(ENV), event)
        client.send_message.assert_not_called()

    def test_sender_rejects_expired_image_before_smtp(self):
        event = w.new_event("authorization_qr", (), [], self.now)
        event["authorization"] = w.validate_qr(self.authorizer.qrcode(), self.now)
        with patch.object(w.smtplib, "SMTP_SSL") as smtp:
            with self.assertRaises(w.WatchdogError):
                w.send_notification(w.MailConfig.from_env(ENV), event)
            smtp.assert_not_called()


class NetworkSafetyTests(unittest.TestCase):
    def test_forbids_remote_and_ambiguous_urls(self):
        for url in ("http://example.com/healthz", "http://127.0.0.2/", "http://127.0.0.1@evil.test/", "http://localhost/?token=x", "http://localhost/#x", "file:///tmp/x", "http://localhost:99999/", "http://localhost/?"):
            with self.assertRaises(w.WatchdogError):
                w.validate_url(url)
        self.assertEqual(w.validate_url("http://[::1]:5200/healthz"), "http://[::1]:5200/healthz")

    def test_http_invalid_oversized_and_redirect_are_not_healthy(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://example.test/")
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                if self.path == "/large":
                    self.wfile.write(b" " * (w.MAX_RESPONSE + 1))
                elif self.path == "/bad":
                    self.wfile.write(b'{"status":"ok"}')
                else:
                    self.wfile.write(json.dumps(payload()).encode())
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = "http://127.0.0.1:" + str(server.server_port)
            self.assertEqual(w.probe_health(base + "/ok"), health())
            for path in ("/redirect", "/large", "/bad"):
                with self.assertRaises(w.WatchdogError):
                    w.probe_health(base + path)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        with self.assertRaises(w.WatchdogError):
            w.probe_health(base + "/ok")

    def test_truncated_http_response_is_recoverable_network_failure(self):
        response = MagicMock()
        response.status = 200
        response.read.side_effect = w.http.client.IncompleteRead(b"private raw data", 10)
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch.object(w.urllib.request, "build_opener", return_value=opener):
            with self.assertRaises(w.WatchdogError) as caught:
                w.probe_health("http://127.0.0.1:5200/healthz")
        self.assertEqual(str(caught.exception), "health_unreachable")

    def test_mail_requires_enabled_tls_and_paired_credentials(self):
        for changes in ({"WATCHDOG_EMAIL_ENABLED": "false"}, {"WATCHDOG_SMTP_SECURITY": "plain"},
                        {"WATCHDOG_SMTP_HOST": ""}, {"WATCHDOG_SMTP_USERNAME": "user"},
                        {"WATCHDOG_MAIL_FROM": "a@example.test\r\nBcc: x@example.test"}):
            with self.assertRaises(w.WatchdogError):
                w.MailConfig.from_env({**ENV, **changes})
        self.assertEqual(w.MailConfig.from_env(ENV).port, 465)
        self.assertEqual(w.MailConfig.from_env({**ENV, "WATCHDOG_SMTP_SECURITY": "starttls"}).port, 587)

    def test_starttls_precedes_login_and_send_and_identity_stays_stable(self):
        cfg = w.MailConfig.from_env({**ENV, "WATCHDOG_SMTP_SECURITY": "starttls", "WATCHDOG_SMTP_USERNAME": "u", "WATCHDOG_SMTP_PASSWORD": "secret"})
        event = w.new_event("fault", ("accounts_auth",), ["manual_action_required"], 1000)
        client = MagicMock()
        client.__enter__.return_value = client
        client.send_message.return_value = {}
        with patch.object(w.smtplib, "SMTP", return_value=client), patch.object(w.ssl, "create_default_context") as context:
            w.send_notification(cfg, event)
            methods = [call[0] for call in client.method_calls]
            self.assertLess(methods.index("starttls"), methods.index("login"))
            self.assertLess(methods.index("login"), methods.index("send_message"))
            context.assert_called_once_with()
            message = client.send_message.call_args.args[0]
            self.assertIn(event["id"], message["Message-ID"])
            self.assertEqual(message["Date"].datetime.timestamp(), event["created_at"])
            self.assertNotIn("secret", message.as_string())

    def test_tls_failure_is_sanitized_no_plaintext_fallback(self):
        with patch.object(w.smtplib, "SMTP_SSL", side_effect=smtplib.SMTPException("credential raw response")), patch.object(w.smtplib, "SMTP") as plain:
            with self.assertRaises(w.WatchdogError) as caught:
                w.send_notification(w.MailConfig.from_env(ENV), w.new_event("test", (), [], 1000))
            self.assertEqual(str(caught.exception), "smtp_delivery_failed")
            plain.assert_not_called()


class AuthorizationNetworkTests(unittest.TestCase):
    def test_local_post_get_no_redirect_proxy_or_remote_image_fetch(self):
        requests = []
        mode = {"value": "ok"}
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                requests.append(("POST", self.path))
                if mode["value"] == "redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://example.invalid/private")
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                if mode["value"] == "oversized":
                    self.wfile.write(b" " * (w.MAX_RESPONSE + 1))
                else:
                    self.wfile.write(json.dumps({"uuid": "local-session", "expires_at": w.time.time() + 299,
                        "qrcode": {"qrcodebase64": base64.b64encode(PNG).decode()},
                        "qrcode_url": "http://example.invalid/do-not-fetch"}).encode())

            def do_GET(self):
                requests.append(("GET", self.path))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"login_state": {"uuid": "local-session", "status": "scanning",
                                                            "progress": 20, "expires_at": w.time.time() + 299}}).encode())

            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = "http://127.0.0.1:" + str(server.server_port) + "/healthz"
            with patch.dict(w.os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1",
                                          "NO_PROXY": "", "no_proxy": ""}):
                client = w.AuthorizationClient(url)
                qr = w.validate_qr(client.qrcode(), w.time.time())
                self.assertEqual(w.decode_image(qr["image"])[0], PNG)
                self.assertEqual(client.status()["login_state"]["progress"], 20)
                for failure in ("redirect", "oversized"):
                    mode["value"] = failure
                    with self.assertRaises(w.WatchdogError):
                        client.qrcode()
            self.assertEqual(requests, [("POST", "/api/auth/qrcode"), ("GET", "/api/auth/status"),
                                        ("POST", "/api/auth/qrcode"), ("POST", "/api/auth/qrcode")])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_qr_request_timeout_allows_upstream_two_ten_second_calls(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b"{}"
        with patch.object(w.urllib.request, "build_opener", return_value=opener):
            w.AuthorizationClient("http://localhost:5200/healthz").qrcode()
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 30)

    def test_status_rejects_non_object_or_invalid_progress(self):
        for login in (None, [], {"status": "success", "progress": True}, {"status": "success", "progress": 101}):
            with patch.object(w.AuthorizationClient, "_request", return_value={"login_state": login}):
                with self.assertRaises(w.WatchdogError):
                    w.AuthorizationClient("http://localhost:5200/healthz").status()


class ExplicitAuthorizationHttpTests(WatchdogCase):
    def serve_collector(self):
        requests = []
        mode = {"health": "ok", "stop_after_qr": False}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(("GET", self.path))
                if self.path == "/healthz":
                    if mode["health"] == "down":
                        self.send_response(503)
                        self.end_headers()
                        return
                    data = payload(auth_health()) if mode["health"] == "ok" else {"status": "ok"}
                elif self.path == "/api/auth/status":
                    data = {"login_state": {"uuid": "native-session", "status": "scanning",
                                            "progress": 20, "expires_at": w.time.time() + 299}}
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_POST(self):
                requests.append(("POST", self.path))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"uuid": "native-session", "expires_at": w.time.time() + 299,
                    "qrcode": {"qrcodebase64": base64.b64encode(PNG).decode()}}).encode())
                if mode["stop_after_qr"]:
                    mode["health"] = "down"

            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def close():
            server.shutdown()
            server.server_close()
            thread.join()
        self.addCleanup(close)
        return "http://127.0.0.1:" + str(server.server_port) + "/healthz", requests, mode

    def authorize_cli(self, url):
        output = io.StringIO()
        smtp_client = MagicMock()
        smtp_client.__enter__.return_value = smtp_client
        smtp_client.send_message.return_value = {}
        with patch.dict(w.os.environ, ENV, clear=True), \
                patch.object(w, "command", side_effect=AssertionError("Explicit authorization must not run Docker/systemd")), \
                patch.object(w.smtplib, "SMTP_SSL", return_value=smtp_client), contextlib.redirect_stdout(output):
            result = w.main(["--authorize", "--url", url, "--state", str(self.state)])
        return result, json.loads(output.getvalue()), smtp_client

    def test_source_run_auth_needed_cli_delivers_qr_without_runtime_commands(self):
        url, requests, _ = self.serve_collector()
        result, summary, smtp = self.authorize_cli(url)
        self.assertEqual(result, 0)
        self.assertEqual(summary["codes"], ["accounts_auth"])
        self.assertEqual(summary["sent"], 1)
        self.assertEqual(summary["pending"], 0)
        self.assertEqual(requests.count(("POST", "/api/auth/qrcode")), 1)
        self.assertGreaterEqual(requests.count(("GET", "/healthz")), 2)
        message = BytesParser(policy=policy.default).parsebytes(smtp.send_message.call_args.args[0].as_bytes())
        images = [part for part in message.walk() if part.get_content_maintype() == "image"]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(part.get_payload(decode=True) == PNG for part in images))
        saved = w.load_state(self.state)
        self.assertIsNone(saved["incident_key"])
        self.assertTrue(saved["authorization"]["manual"])

    def test_unavailable_or_invalid_http_never_posts_or_sends(self):
        url, requests, mode = self.serve_collector()
        for health_mode, error in (("down", "health_http"), ("invalid", "health_invalid")):
            with self.subTest(health=health_mode):
                mode["health"] = health_mode
                result, summary, smtp = self.authorize_cli(url)
                self.assertEqual(result, 1)
                self.assertEqual(summary["error"], error)
                smtp.send_message.assert_not_called()
        self.assertFalse(any(method == "POST" for method, _ in requests))
        self.assertFalse(self.state.exists())

    def test_service_disappears_after_qr_does_not_mail_image(self):
        url, requests, mode = self.serve_collector()
        mode["stop_after_qr"] = True
        result, summary, smtp = self.authorize_cli(url)
        self.assertEqual(result, 1)
        self.assertEqual(summary["error"], "health_http")
        smtp.send_message.assert_not_called()
        self.assertEqual(requests.count(("POST", "/api/auth/qrcode")), 1)
        self.assertEqual(summary["pending"], 1)

    def test_session_replaced_before_smtp_invalidates_queued_image_and_notifies_once(self):
        self.run_check(auth_health, send=lambda *_: (_ for _ in ()).throw(w.WatchdogError("smtp_delivery_failed")))
        original_marker = w.load_state(self.state)["authorization"]
        # Replace the live session via external UI before the next watchdog tick.
        self.authorizer.login = {"uuid": "ui-replaced-session", "status": "scanning",
                                 "progress": 20, "expires_at": self.now + 250}
        self.run_check(auth_health)
        self.assertFalse(any(event["kind"] == "authorization_qr" for event in self.sent))
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)
        self.assertEqual(w.load_state(self.state)["authorization"]["phase"], "failed")
        # Subsequent ticks do not re-mail or request again without explicit operator command.
        self.now += 600
        self.run_check(auth_health)
        self.assertEqual(self.authorizer.requests, 1)
        self.assertEqual(sum(event["kind"] == "authorization_expired" for event in self.sent), 1)

    def test_status_unavailable_preserves_event_id_and_aborts_send(self):
        self.run_check(auth_health, send=lambda *_: (_ for _ in ()).throw(w.WatchdogError("smtp_delivery_failed")))
        saved = w.load_state(self.state)
        original_event = saved["pending_notifications"][0]
        self.assertEqual(original_event["kind"], "authorization_qr")
        # Next attempt cannot verify status (network/transient failure on status endpoint).
        def broken_status():
            raise w.WatchdogError("authorization_unreachable")
        self.authorizer.status = broken_status
        result = self.run_check(auth_health)
        self.assertEqual(result["exit_code"], 1)
        self.assertEqual(result["error"], "authorization_unreachable")
        self.assertEqual(result["sent"], 0)
        current = w.load_state(self.state)
        self.assertEqual(len(current["pending_notifications"]), len(saved["pending_notifications"]))
        self.assertEqual(current["pending_notifications"][0]["id"], original_event["id"])
        self.assertEqual(current["authorization"]["phase"], "pending")
        # Restoring healthy matching status allows normal delivery.
        del self.authorizer.status
        result = self.run_check(auth_health)
        self.assertEqual(result["exit_code"], 1)
        self.assertEqual(result["sent"], len(saved["pending_notifications"]))
        self.assertEqual(self.sent[0]["id"], original_event["id"])


class FixedRuntimeTests(unittest.TestCase):
    def test_docker_does_not_restart_stopped_or_paused(self):
        runtime = w.DockerRuntime(Path.cwd())
        for state in ({"Running": False, "Status": "exited"}, {"Running": True, "Paused": True}):
            with patch.object(w, "command", side_effect=["a" * 64, json.dumps(state)]) as command:
                with self.assertRaises(w.WatchdogError):
                    runtime.restart()
                self.assertEqual(command.call_count, 2)

    def test_docker_scope_rejects_wrong_project_service_and_ambiguous_matches(self):
        runtime = w.DockerRuntime(Path.cwd())
        project = str(runtime.root)
        cases = [
            ([("a" * 64, "wechat-mp-tools", project + "-other")], "missing"),
            ([("a" * 64, "other-service", project)], "missing"),
            ([("a" * 64, "wechat-mp-tools", project), ("b" * 64, "wechat-mp-tools", project)], "unknown"),
        ]
        for containers, expected in cases:
            with self.subTest(expected=expected, containers=containers):
                restarted = []
                def docker(args, root):
                    if args[:3] == ["docker", "ps", "-a"]:
                        filters = [args[i + 1] for i, arg in enumerate(args) if arg == "--filter"]
                        return "\n".join(cid for cid, service, directory in containers
                                         if all(f in {"label=com.docker.compose.service=" + service,
                                                      "label=com.docker.compose.project.working_dir=" + directory}
                                                for f in filters))
                    if args[:2] == ["docker", "restart"]:
                        restarted.append(args[2])
                        return ""
                    self.fail("Out-of-scope container must not be inspected or controlled")
                with patch.object(w, "command", side_effect=docker):
                    self.assertEqual(runtime.get_state(), expected)
                    with self.assertRaises(w.WatchdogError):
                        runtime.restart()
                self.assertFalse(restarted)

    def test_docker_restart_refreshes_scoped_identity_and_running_state(self):
        runtime = w.DockerRuntime(Path.cwd())
        # The originally observed container is replaced before the restart request.
        with patch.object(w, "command", side_effect=[
            "a" * 64, json.dumps({"Running": True}),
            "b" * 64, json.dumps({"Running": True}), "",
        ]) as command:
            self.assertEqual(runtime.get_state(), "running")
            runtime.restart()
            self.assertEqual(command.call_args.args[0], ["docker", "restart", "b" * 64])

    def test_systemd_stopped_missing_unknown_not_started(self):
        runtime = w.SystemdRuntime(Path.cwd())
        for output, expected in (("LoadState=not-found\nActiveState=inactive", "missing"),
                                 ("LoadState=loaded\nActiveState=inactive", "stopped"), ("garbage", "unknown")):
            with patch.object(w, "command", return_value=output):
                self.assertEqual(runtime.get_state(), expected)
                with self.assertRaises(w.WatchdogError):
                    runtime.restart()


if __name__ == "__main__":
    unittest.main()
