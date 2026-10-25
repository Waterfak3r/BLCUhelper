#!/usr/bin/env python3
"""Once-run, local-only collector watchdog. No website environment is loaded."""
from __future__ import annotations

import base64
import binascii
import argparse
import http.client
import json
import math
import os
from pathlib import Path
import re
import smtplib
import ssl
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, getaddresses
from typing import Callable, Literal, Mapping, Protocol
import urllib.error
import urllib.parse
import urllib.request

RuntimeState = Literal["running", "stopped", "missing", "unknown"]
ROOT = Path(__file__).resolve().parent.parent
MAX_RESPONSE = 1024 * 1024
CODES = frozenset({"runtime_unknown", "runtime_missing", "health_unreachable", "health_http", "health_invalid", "scheduler_stopped", "accounts_auth", "accounts_cooldown", "subscription_auth", "subscription_verification", "subscription_collection", "scheduler_stalled"})
NOTES = frozenset({"no_restart_needed", "manual_action_required", "not_recoverable", "restart_cooldown", "restart_attempted", "restart_failed", "runtime_changed", "post_restart_failed", "auto_recovered"})


class WatchdogError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class Runtime(Protocol):
    def get_state(self) -> RuntimeState: ...
    def restart(self) -> None: ...


def command(args: list[str], root: Path) -> str:
    try:
        result = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.SubprocessError):
        raise WatchdogError("runtime_command_failed") from None
    if result.returncode:
        raise WatchdogError("runtime_command_failed")
    return result.stdout.strip()


class DockerRuntime:
    def __init__(self, project_root: Path):
        self.root = Path(project_root).resolve()

    def _snapshot(self) -> tuple[RuntimeState, str | None]:
        try:
            # Query canonical Compose labels directly; never parse project YAML/.env.
            ids = command([
                "docker", "ps", "-a",
                "--filter", "label=com.docker.compose.service=wechat-mp-tools",
                "--filter", "label=com.docker.compose.project.working_dir=" + str(self.root),
                "--format", "{{.ID}}",
            ], self.root).splitlines()
            if not ids:
                return "missing", None
            if len(ids) != 1 or not re.fullmatch(r"[a-fA-F0-9]{12,64}", ids[0]):
                return "unknown", None
            container_id = ids[0]
            state = json.loads(command(["docker", "inspect", "--format", "{{json .State}}", container_id], self.root))
            if state.get("Paused") or state.get("Restarting"):
                return "stopped", container_id
            if state.get("Running") is True:
                return "running", container_id
            if state.get("Status") in ("created", "exited", "dead"):
                return "stopped", container_id
        except (WatchdogError, ValueError, AttributeError):
            pass
        return "unknown", None

    def get_state(self) -> RuntimeState:
        return self._snapshot()[0]

    def restart(self) -> None:
        state, container_id = self._snapshot()
        if state != "running" or container_id is None:
            raise WatchdogError("runtime_changed")
        command(["docker", "restart", container_id], self.root)


class SystemdRuntime:
    def __init__(self, project_root: Path):
        self.root = Path(project_root)

    def get_state(self) -> RuntimeState:
        try:
            output = command(["systemctl", "show", "blcu-wechat-mp.service", "--property=LoadState,ActiveState", "--no-pager"], self.root)
            values = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
            if values.get("LoadState") == "not-found":
                return "missing"
            if values.get("LoadState") != "loaded":
                return "unknown"
            if values.get("ActiveState") == "active":
                return "running"
            if values.get("ActiveState") in ("inactive", "failed", "deactivating", "activating"):
                return "stopped"
        except WatchdogError:
            pass
        return "unknown"

    def restart(self) -> None:
        if self.get_state() != "running":
            raise WatchdogError("runtime_changed")
        command(["systemctl", "try-restart", "blcu-wechat-mp.service"], self.root)


def validate_url(url: str) -> str:
    try:
        parts = urllib.parse.urlsplit(url)
        if (parts.scheme not in ("http", "https") or parts.hostname not in ("127.0.0.1", "localhost", "::1")
                or parts.username is not None or parts.password is not None or parts.query or parts.fragment
                or "?" in url or "#" in url or any(c.isspace() for c in url)):
            raise ValueError
        if parts.port is not None and not 1 <= parts.port <= 65535:
            raise ValueError
    except ValueError:
        raise WatchdogError("url_invalid") from None
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def validate_health(payload: object) -> dict:
    try:
        if not isinstance(payload, dict) or payload["status"] != "ok" or not isinstance(payload["version"], str) or type(payload["modules"]) is not int or payload["modules"] < 0:
            raise ValueError
        data = payload["watchdog"]
        if type(data["scheduler_running"]) is not bool or type(data["in_fetch_window"]) is not bool:
            raise ValueError
        accounts = data["accounts"]
        if any(type(accounts[k]) is not int or accounts[k] < 0 for k in ("total", "active", "cooldown", "invalid")):
            raise ValueError
        if not isinstance(data["subscriptions"], list):
            raise ValueError
        ids = set()
        for sub in data["subscriptions"]:
            if (not isinstance(sub["id"], str) or sub["id"] in ids or not isinstance(sub["name"], str)
                    or type(sub["enabled"]) is not bool or type(sub["fetching"]) is not bool
                    or type(sub["interval_minutes"]) is not int or sub["interval_minutes"] <= 0
                    or not number(sub["last_fetch_time"]) or not number(sub["next_fetch_time"])
                    or sub["error_kind"] not in (None, "auth", "verification", "collection")):
                raise ValueError
            ids.add(sub["id"])
    except (KeyError, TypeError, ValueError, OverflowError):
        raise WatchdogError("health_invalid") from None
    return data


def probe_health(url: str) -> dict:
    validate_url(url)
    # Ignore host proxy settings; this endpoint must stay local. Never follow redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(url, timeout=5) as response:
            if response.status != 200:
                raise WatchdogError("health_http")
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise WatchdogError("health_invalid")
        payload = json.loads(raw)
    except urllib.error.HTTPError as exc:
        exc.close()
        raise WatchdogError("health_http") from None
    except (urllib.error.URLError, OSError, TimeoutError, http.client.HTTPException):
        raise WatchdogError("health_unreachable") from None
    except (ValueError, UnicodeError, RecursionError):
        raise WatchdogError("health_invalid") from None
    return validate_health(payload)


def decode_image(encoded: object) -> tuple[bytes, str]:
    if not isinstance(encoded, str) or not 12 <= len(encoded) <= MAX_RESPONSE:
        raise WatchdogError("authorization_invalid")
    try:
        image = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise WatchdogError("authorization_invalid") from None
    if base64.b64encode(image).decode("ascii") != encoded:
        raise WatchdogError("authorization_invalid")
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return image, "png"
    if image.startswith(b"\xff\xd8\xff") and image.endswith(b"\xff\xd9"):
        return image, "jpeg"
    raise WatchdogError("authorization_invalid")


def validate_qr(payload: object, now: float) -> dict:
    try:
        expiry = payload["expires_at"]
        qr = payload["qrcode"]
        session = payload["uuid"]
        if (not number(expiry) or not now < expiry <= now + 300
                or not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session)):
            raise ValueError
        decode_image(qr["qrcodebase64"])
        return {"uuid": session, "expires_at": expiry, "image": qr["qrcodebase64"]}
    except (KeyError, TypeError, ValueError):
        raise WatchdogError("authorization_invalid") from None


def validate_login_status(payload: object) -> dict:
    try:
        state = payload["login_state"]
        if (not isinstance(state, dict) or state["status"] not in
                ("idle", "scanning", "scanned", "success", "failed", "expired", "cancelled")
                or not number(state["progress"]) or state["progress"] > 100
                or not number(state["expires_at"])
                or (state["uuid"] not in (None, "") and (not isinstance(state["uuid"], str)
                    or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", state["uuid"])))
                or (state["status"] in ("scanning", "scanned", "success") and not state["uuid"])):
            raise ValueError
    except (KeyError, TypeError, ValueError, OverflowError):
        raise WatchdogError("authorization_invalid") from None
    return state


class AuthorizationClient:
    """Only the existing collector owns phone polling and credential persistence."""
    def __init__(self, health_url: str):
        parts = urllib.parse.urlsplit(validate_url(health_url))
        self.origin = urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))

    def _request(self, path: str, method: str, timeout: int) -> dict:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        request = urllib.request.Request(self.origin + path, method=method)
        try:
            with opener.open(request, timeout=timeout) as response:
                if response.status != 200:
                    raise WatchdogError("authorization_http")
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise WatchdogError("authorization_invalid")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise WatchdogError("authorization_invalid")
            return payload
        except urllib.error.HTTPError as exc:
            exc.close()
            raise WatchdogError("authorization_http") from None
        except (urllib.error.URLError, OSError, TimeoutError, http.client.HTTPException):
            raise WatchdogError("authorization_unreachable") from None
        except (ValueError, UnicodeError, RecursionError):
            raise WatchdogError("authorization_invalid") from None

    def qrcode(self) -> dict:
        return self._request("/api/auth/qrcode", "POST", 30)

    def status(self) -> dict:
        payload = self._request("/api/auth/status", "GET", 5)
        validate_login_status(payload)
        return payload


@dataclass(frozen=True)
class Assessment:
    codes: tuple[str, ...] = ()
    recoverable: bool = False
    manual: bool = False
    paused: bool = False

    @property
    def key(self) -> str | None:
        return ",".join(self.codes) or None


def classify(data: dict, now: float) -> Assessment:
    enabled = [sub for sub in data["subscriptions"] if sub["enabled"]]
    codes = set()
    manual = False
    if enabled and data["accounts"]["active"] == 0:
        codes.add("accounts_cooldown" if data["accounts"]["cooldown"] > 0 else "accounts_auth")
        manual = True
    for sub in enabled:
        kind = sub["error_kind"]
        if kind:
            codes.add("subscription_" + kind)
            manual |= kind in ("auth", "verification")
    if not data["scheduler_running"]:
        codes.add("scheduler_stopped")
    if data["in_fetch_window"] and not manual:
        for sub in enabled:
            if (not sub["fetching"] and sub["next_fetch_time"] > 0 and now > sub["next_fetch_time"] + 600
                    and sub["error_kind"] is None):
                codes.add("scheduler_stalled")
    recoverable = not manual and bool(codes & {"scheduler_stopped", "scheduler_stalled"})
    return Assessment(tuple(sorted(codes)), recoverable, manual, not enabled and not codes)


def assess(runtime: Runtime, probe: Callable[[], dict], now: float) -> tuple[RuntimeState, Assessment]:
    state = runtime.get_state()
    if state == "stopped":
        return state, Assessment(paused=True)
    if state != "running":
        return state, Assessment(("runtime_missing" if state == "missing" else "runtime_unknown",))
    try:
        return state, classify(probe(), now)
    except WatchdogError as exc:
        if exc.code not in ("health_unreachable", "health_http", "health_invalid"):
            raise
        return state, Assessment((exc.code,), recoverable=True)


@dataclass(frozen=True)
class MailConfig:
    host: str
    port: int
    security: str
    username: str
    password: str
    sender: str
    recipients: tuple[str, ...]

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> MailConfig:
        if env.get("WATCHDOG_EMAIL_ENABLED") != "true":
            raise WatchdogError("email_disabled")
        security = env.get("WATCHDOG_SMTP_SECURITY", "tls")
        host = env.get("WATCHDOG_SMTP_HOST", "").strip()
        username = env.get("WATCHDOG_SMTP_USERNAME", "")
        password = env.get("WATCHDOG_SMTP_PASSWORD", "")
        sender = env.get("WATCHDOG_MAIL_FROM", "").strip()
        recipients_raw = env.get("WATCHDOG_MAIL_TO", "")
        try:
            port = int(env.get("WATCHDOG_SMTP_PORT") or ("465" if security == "tls" else "587"))
            if (security not in ("tls", "starttls") or not 1 <= port <= 65535 or not host
                    or any(c.isspace() for c in host) or bool(username) != bool(password)
                    or any(c in sender + recipients_raw + host + username for c in "\r\n")):
                raise ValueError
            addresses = getaddresses([recipients_raw])
            recipients = tuple(address for _, address in addresses)
            if (not re.fullmatch(r"[^\s<>@,;]+@[^\s<>@,;]+", sender) or len(recipients) != 1
                    or any(not re.fullmatch(r"[^\s<>@,;]+@[^\s<>@,;]+", a) for a in recipients)):
                raise ValueError
        except ValueError:
            raise WatchdogError("smtp_config_invalid") from None
        return cls(host, port, security, username, password, sender, recipients)


def send_notification(config: MailConfig, event: dict) -> None:
    message = EmailMessage()
    message["Subject"] = "BLCU collector watchdog: " + event["kind"]
    message["From"] = config.sender
    message["To"] = ", ".join(config.recipients)
    message["Message-ID"] = "<" + event["id"] + "@blcu-watchdog.local>"
    message["Date"] = formatdate(event["created_at"], usegmt=True)
    text = ("Collector watchdog event: " + event["kind"]
            + "\nEvent time: " + formatdate(event["created_at"], usegmt=True)
            + "\nFindings: " + (", ".join(event["codes"]) or "No current health findings")
            + "\nActions: " + ", ".join(event["notes"]) + "\n")
    if event["kind"] == "authorization_qr":
        qr = event["authorization"]
        if time.time() >= qr["expires_at"]:
            raise WatchdogError("authorization_expired")
        image, subtype = decode_image(qr["image"])
        instructions = ("Scan this QR image with WeChat on your phone and confirm authorization on the phone. "
                        "The collector saves the refreshed account; no password or token is emailed. "
                        "Valid for at most five minutes, until " + formatdate(qr["expires_at"], usegmt=True)
                        + ". After expiry run --authorize explicitly to renew.\n")
        message.set_content(text + instructions)
        cid = event["id"] + "@blcu-watchdog.local"
        message.add_alternative("<html><body><p>" + instructions
                                + '</p><img src="cid:' + cid + '" alt="WeChat authorization QR">'
                                + "<p>If the image is hidden, open the attached QR image.</p></body></html>", subtype="html")
        message.get_payload()[-1].add_related(image, maintype="image", subtype=subtype, cid="<" + cid + ">")
        message.add_attachment(image, maintype="image", subtype=subtype, filename="wechat-authorization." + subtype)
    else:
        if event["kind"] == "authorization_restored":
            text += "Authorization restored. Collection health is reported separately; existing warnings may remain.\n"
        elif event["kind"] == "authorization_expired":
            text += "Authorization QR expired or failed. Run --authorize explicitly to renew; phone confirmation is required.\n"
        message.set_content(text)
    context = ssl.create_default_context()
    try:
        if config.security == "tls":
            client = smtplib.SMTP_SSL(config.host, config.port, timeout=10, context=context)
        elif config.security == "starttls":
            client = smtplib.SMTP(config.host, config.port, timeout=10)
        else:
            raise WatchdogError("smtp_config_invalid")
        with client:
            client.ehlo()
            if config.security == "starttls":
                client.starttls(context=context)
                client.ehlo()
            if config.username:
                client.login(config.username, config.password)
            if event["kind"] == "authorization_qr" and time.time() >= event["authorization"]["expires_at"]:
                raise WatchdogError("authorization_expired")
            refused = client.send_message(message)
            if refused:
                raise WatchdogError("smtp_delivery_failed")
    except (smtplib.SMTPException, OSError, ValueError):
        raise WatchdogError("smtp_delivery_failed") from None


def new_event(kind: str, codes: tuple[str, ...], notes: list[str], now: float) -> dict:
    return {"id": uuid.uuid4().hex, "kind": kind, "codes": list(codes), "notes": notes[:], "created_at": now}


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"version": 2, "last_restart_at": None, "incident_key": None,
                "pending_notifications": [], "authorization": None}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        version = state["version"]
        if type(version) is not int or version not in (1, 2):
            raise ValueError
        expected = {"version", "last_restart_at", "incident_key", "pending_notifications"}
        if version == 2:
            expected.add("authorization")
        if set(state) != expected or (state["last_restart_at"] is not None and not number(state["last_restart_at"])):
            raise ValueError
        key = state["incident_key"]
        if key is not None and (not isinstance(key, str) or not key or any(code not in CODES for code in key.split(","))):
            raise ValueError
        if not isinstance(state["pending_notifications"], list):
            raise ValueError
        for event in state["pending_notifications"]:
            fields = {"id", "kind", "codes", "notes", "created_at"}
            kinds = ("fault", "recovery", "test")
            if version == 2:
                kinds += ("authorization_qr", "authorization_expired", "authorization_restored")
                if event["kind"] == "authorization_qr":
                    fields.add("authorization")
                    qr = event["authorization"]
                    if set(qr) != {"uuid", "expires_at", "image"}:
                        raise ValueError
                    validate_qr({"expires_at": qr["expires_at"], "uuid": qr["uuid"], "qrcode": {"qrcodebase64": qr["image"]}},
                                event["created_at"])
            if (set(event) != fields or not isinstance(event["id"], str)
                    or not re.fullmatch(r"[a-f0-9]{32}", event["id"]) or event["kind"] not in kinds
                    or not isinstance(event["codes"], list) or any(c not in CODES for c in event["codes"])
                    or not isinstance(event["notes"], list) or any(n not in NOTES for n in event["notes"])
                    or not number(event["created_at"])):
                raise ValueError
        if version == 2 and state["authorization"] is not None:
            marker = state["authorization"]
            if (set(marker) != {"id", "manual", "uuid", "expires_at", "phase"}
                    or not isinstance(marker["id"], str) or not re.fullmatch(r"[a-f0-9]{32}", marker["id"])
                    or type(marker["manual"]) is not bool
                    or marker["phase"] not in ("requesting", "pending", "expired", "failed")
                    or (marker["uuid"] is not None and (not isinstance(marker["uuid"], str)
                        or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", marker["uuid"])))
                    or (marker["expires_at"] is not None and not number(marker["expires_at"]))
                    or ((marker["uuid"] is None) != (marker["expires_at"] is None))
                    or (marker["phase"] == "requesting" and marker["uuid"] is not None)
                    or (marker["phase"] == "pending" and marker["uuid"] is None)):
                raise ValueError
        qr_events = [event for event in state["pending_notifications"] if event["kind"] == "authorization_qr"]
        if qr_events:
            marker = state.get("authorization")
            if (len(qr_events) != 1 or marker is None or marker["phase"] != "pending"
                    or qr_events[0]["authorization"]["uuid"] != marker["uuid"]
                    or qr_events[0]["authorization"]["expires_at"] != marker["expires_at"]):
                raise ValueError
    except (OSError, ValueError, KeyError, TypeError, WatchdogError):
        raise WatchdogError("state_invalid") from None
    if version == 1:
        state["version"] = 2
        state["authorization"] = None
    return state


def save_state(path: Path, state: dict) -> None:
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=path.name + ".", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(state, handle, sort_keys=True, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except (OSError, ValueError):
        raise WatchdogError("state_write_failed") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def needs_authorization(data: dict | None) -> bool:
    if data is None:
        return False
    enabled = [sub for sub in data["subscriptions"] if sub["enabled"]]
    accounts = data["accounts"]
    return (bool(enabled) and accounts["active"] == 0 and accounts["cooldown"] == 0
            and not any(sub["error_kind"] == "verification" for sub in enabled)
            and (accounts["invalid"] > 0 or any(sub["error_kind"] == "auth" for sub in enabled)))


def prune_qr(state: dict) -> None:
    state["pending_notifications"] = [event for event in state["pending_notifications"]
                                      if event["kind"] != "authorization_qr"]


def expire_authorization(state: dict, now: float, phase: str = "expired") -> None:
    marker = state["authorization"]
    prune_qr(state)
    if marker is not None and marker["phase"] not in ("expired", "failed"):
        marker["phase"] = phase
        state["pending_notifications"].append(new_event("authorization_expired", (), ["manual_action_required"], now))


def update_authorization(state: dict, path: Path, runtime: Runtime, client: AuthorizationClient,
                         data: dict | None, now: float, explicit: bool,
                         clock: Callable[[], float], *, require_live: bool = False) -> bool:
    """Return false if the runtime changed before creating a session."""
    marker = state["authorization"]
    restored = False
    if marker is not None:
        try:
            status = validate_login_status(client.status())
        except WatchdogError:
            if require_live:
                raise
            status = None
        queued_qr = next((e["authorization"] for e in state["pending_notifications"]
                          if e["kind"] == "authorization_qr"), None)
        target_uuid = queued_qr["uuid"] if queued_qr else marker["uuid"]
        same_session = target_uuid is not None and status is not None and status["uuid"] == target_uuid
        restored = ((same_session and status.get("status") == "success" and status.get("progress") == 100)
                    or (not marker["manual"] and data is not None and data["accounts"]["active"] > 0))
        if restored:
            prune_qr(state)
            state["pending_notifications"] = [event for event in state["pending_notifications"]
                                              if event["kind"] != "authorization_expired"]
            state["authorization"] = None
            state["pending_notifications"].append(new_event("authorization_restored", (), [], now))
        elif target_uuid is not None and status is not None and not same_session:
            # Another browser/operator replaced or cancelled this exact session.
            # Invalidate the pending QR and notify once; never adopt the new session quietly.
            expire_authorization(state, now, "failed")
        elif same_session and status["status"] in ("failed", "cancelled", "expired", "idle"):
            expire_authorization(state, now, "failed")
        elif same_session and status["expires_at"] <= now:
            expire_authorization(state, now)
        elif marker["expires_at"] is not None and now >= marker["expires_at"]:
            expire_authorization(state, now)
        elif marker["phase"] == "requesting" and not explicit:
            # A previous process stopped around POST. Never silently create another QR.
            expire_authorization(state, now, "failed")
    if not explicit and (restored or state["authorization"] is not None or not needs_authorization(data)):
        return True
    if not explicit and runtime.get_state() != "running":
        return False
    # Persist the incident before POST. The upstream endpoint itself reuses live sessions.
    marker = {"id": uuid.uuid4().hex, "manual": explicit, "uuid": None,
              "expires_at": None, "phase": "requesting"}
    state["authorization"] = marker
    prune_qr(state)
    save_state(path, state)
    try:
        payload = client.qrcode()
        qr = validate_qr(payload, clock())
    except WatchdogError:
        expire_authorization(state, now, "failed")
    else:
        marker.update(uuid=qr["uuid"], expires_at=qr["expires_at"], phase="pending")
        event = new_event("authorization_qr", (), ["manual_action_required"], clock())
        event["authorization"] = qr
        state["pending_notifications"].append(event)
    save_state(path, state)
    return True


def run_once(runtime: Runtime, state_path: Path, *, url: str = "http://127.0.0.1:5200/healthz",
             env: Mapping[str, str] | None = None, probe_only: bool = False, authorize: bool = False,
             probe: Callable[[], dict] | None = None, send: Callable[[MailConfig, dict], None] = send_notification,
             authorizer: AuthorizationClient | None = None,
             clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep) -> dict:
    """Inject Runtime, validated-watchdog-data probe, mail sender, clock and sleep for isolated use.

    Returns a JSON-safe summary including exit_code. Full runs require SMTP environment
    even with an injected sender; probe_only never reads/writes state or sends/restarts.
    """
    validate_url(url)
    if probe_only and authorize:
        raise WatchdogError("mode_invalid")
    config = None if probe_only else MailConfig.from_env(os.environ if env is None else env)
    now = clock()
    observed = None
    def observe():
        nonlocal observed
        observed = (probe or (lambda: probe_health(url)))()
        return observed
    if authorize:
        # Explicit local authorization also supports source-run collectors without
        # Docker/systemd. HTTP liveness is real; no synthetic runtime is introduced.
        try:
            initial = classify(observe(), now)
        except WatchdogError as exc:
            return {"runtime": "unknown", "codes": [exc.code], "paused": False,
                    "notes": [], "sent": 0, "pending": 0, "error": exc.code, "exit_code": 1}
        state_name = "running"
    else:
        state_name, initial = assess(runtime, observe, now)
    summary = {"runtime": state_name, "codes": list(initial.codes), "paused": initial.paused,
               "notes": [], "sent": 0, "pending": 0, "exit_code": int(bool(initial.codes))}
    if probe_only:
        return summary
    state = load_state(Path(state_path))
    # Canonical v2, including a valid v1 upgrade, is committed before side effects.
    save_state(Path(state_path), state)
    summary["pending"] = len(state["pending_notifications"])
    # An operator stop must neither send queued mail nor resolve an earlier incident.
    if state_name == "stopped":
        return summary
    if state_name == "running":
        if not update_authorization(state, Path(state_path), runtime,
                                    authorizer or AuthorizationClient(url), observed, now, authorize, clock):
            summary.update(runtime=runtime.get_state(), paused=True, exit_code=1)
            save_state(Path(state_path), state)
            return summary
    notes = summary["notes"]
    final = initial
    restart_fault = None
    if initial.recoverable and not authorize:
        last_restart = state["last_restart_at"]
        if last_restart is not None and now - last_restart < 3600:
            notes.append("restart_cooldown")
        elif (current_state := runtime.get_state()) != "running":
            notes.append("runtime_changed")
            summary["runtime"] = current_state
            if current_state == "stopped":
                summary["paused"] = True
                summary["exit_code"] = 1
                return summary
            final = Assessment(("runtime_missing" if current_state == "missing" else "runtime_unknown",))
        else:
            notes.append("restart_attempted")
            # Commit the observed fault together with the cooldown before restarting.
            # An interruption after the command must leave a deliverable incident.
            if initial.key != state["incident_key"]:
                restart_fault = new_event("fault", initial.codes, notes, now)
                state["pending_notifications"].append(restart_fault)
            state["incident_key"] = initial.key
            state["last_restart_at"] = now
            save_state(Path(state_path), state)
            summary["pending"] = len(state["pending_notifications"])
            try:
                runtime.restart()
            except (WatchdogError, OSError, subprocess.SubprocessError):
                notes.append("restart_failed")
            # Exactly one recheck, including when a command failed after taking effect.
            sleep(10)
            post_state, final = assess(runtime, observe, clock())
            summary["runtime"] = post_state
            if post_state == "stopped":
                notes.append("runtime_changed")
                summary["paused"] = True
                summary["exit_code"] = 1
                return summary
            elif final.codes:
                notes.append("post_restart_failed")
            else:
                notes.append("auto_recovered")
    else:
        notes.append("manual_action_required" if initial.manual else "not_recoverable" if initial.codes else "no_restart_needed")
    previous = state["incident_key"]
    if restart_fault is not None:
        restart_fault["notes"] = notes[:]
    if not authorize and final.key:
        if final.key != previous:
            state["pending_notifications"].append(new_event("fault", final.codes, notes, now))
        state["incident_key"] = final.key
    elif not authorize and (previous or initial.key):
        if restart_fault is not None:
            # Coalesce only this run's still-unsent event, keeping its identity/time.
            restart_fault["kind"] = "recovery"
        else:
            state["pending_notifications"].append(new_event("recovery", initial.codes if initial.key else tuple(previous.split(",")), notes, now))
        state["incident_key"] = None
    save_state(Path(state_path), state)
    summary["codes"] = list(final.codes)
    summary["exit_code"] = 0 if authorize else int(bool(final.codes) or "restart_failed" in notes or "runtime_changed" in notes)
    while state["pending_notifications"]:
        event = state["pending_notifications"][0]
        if event["kind"] == "authorization_qr":
            # Re-evaluate immediately before SMTP, not only at the beginning of a run.
            if clock() >= event["authorization"]["expires_at"]:
                expire_authorization(state, clock())
                save_state(Path(state_path), state)
                continue
            if authorize:
                try:
                    observe()
                except WatchdogError as exc:
                    summary.update(error=exc.code, exit_code=1)
                    break
            elif runtime.get_state() != "running":
                summary["paused"] = True
                summary["exit_code"] = 1
                break
            try:
                update_authorization(state, Path(state_path), runtime,
                                     authorizer or AuthorizationClient(url), None, clock(), False, clock,
                                     require_live=True)
            except WatchdogError as exc:
                summary.update(error=exc.code, exit_code=1)
                break
            save_state(Path(state_path), state)
            if not state["pending_notifications"] or state["pending_notifications"][0]["id"] != event["id"]:
                continue
        try:
            send(config, state["pending_notifications"][0])
        except WatchdogError as exc:
            if exc.code == "authorization_expired":
                expire_authorization(state, clock())
                save_state(Path(state_path), state)
                continue
            summary["error"] = "smtp_delivery_failed"
            summary["exit_code"] = 1
            break
        except (OSError, smtplib.SMTPException):
            summary["error"] = "smtp_delivery_failed"
            summary["exit_code"] = 1
            break
        state["pending_notifications"].pop(0)
        save_state(Path(state_path), state)
        summary["sent"] += 1
    if (authorize and "error" not in summary and state["authorization"] is not None
            and state["authorization"]["phase"] in ("failed", "expired")):
        summary.update(error="authorization_failed", exit_code=1)
    summary["pending"] = len(state["pending_notifications"])
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", choices=("docker", "systemd"), default="docker")
    parser.add_argument("--project-root", type=Path, default=ROOT)
    parser.add_argument("--url", default="http://127.0.0.1:5200/healthz")
    parser.add_argument("--state", type=Path)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--probe-only", action="store_true")
    modes.add_argument("--test-email", action="store_true")
    modes.add_argument("--authorize", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.test_email:
            send_notification(MailConfig.from_env(os.environ), new_event("test", (), ["no_restart_needed"], time.time()))
            result = {"sent": 1, "exit_code": 0}
        else:
            runtime = DockerRuntime(args.project_root) if args.runtime == "docker" else SystemdRuntime(args.project_root)
            result = run_once(runtime, args.state or args.project_root / ".data/wechat-mp-watchdog-state.json",
                              url=args.url, probe_only=args.probe_only, authorize=args.authorize)
    except WatchdogError as exc:
        result = {"error": exc.code, "exit_code": 1}
    except Exception:
        # No exception text: transport errors can contain credentials or raw server data.
        result = {"error": "unexpected_failure", "exit_code": 1}
    print(json.dumps(result, sort_keys=True))
    return result["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
