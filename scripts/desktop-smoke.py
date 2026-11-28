#!/usr/bin/env python3
"""Opt-in Linux Tauri smoke on an isolated X11 display."""

import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
RENAMED = "Native smoke API"


def eventually(description, operation):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = operation()
        if result:
            return result
        time.sleep(0.2)
    raise RuntimeError(f"Timed out: {description}")


def xdo(*args):
    return subprocess.check_output(["xdotool", *args], text=True, timeout=5).strip()


class Desktop:
    def __init__(self, port):
        self.base = f"http://127.0.0.1:{port}"
        self.session = None

    def request(self, method, path, body=None):
        req = urllib.request.Request(
            self.base + path, json.dumps(body).encode() if body is not None else None,
            {"Content-Type": "application/json"}, method=method,
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)["value"]

    def execute(self, script, *args):
        return self.request("POST", f"/session/{self.session}/execute/sync", {
            "script": script, "args": args,
        })

    def click(self, selector):
        if not self.execute("const e = document.querySelector(arguments[0]); e?.click(); return !!e;", selector):
            raise RuntimeError(f"Missing UI control: {selector}")

    def dialog(self, title, path):
        def visible_windows():
            try:
                return xdo("search", "--onlyvisible", "--name", f"^{title}$").splitlines()
            except subprocess.CalledProcessError:
                return []

        window = eventually(f"native {title} dialog", visible_windows)[-1]
        xdo("windowactivate", "--sync", window)
        xdo("key", "--clearmodifiers", "ctrl+l" if title == "Open File" else "ctrl+a")
        xdo("type", "--clearmodifiers", str(path))
        xdo("key", "--clearmodifiers", "Return")
        # GTK may first resolve the entered location without dismissing the chooser.
        time.sleep(0.5)
        if window in visible_windows():
            xdo("key", "--clearmodifiers", "Return")
        eventually(f"{title} dialog closes", lambda: window not in visible_windows())

    def run(self, binary, fixture, report):
        self.session = self.request("POST", "/session", {
            "capabilities": {"alwaysMatch": {"tauri:options": {"application": str(binary)}}},
        })["sessionId"]
        eventually("launcher mounted", lambda: self.execute(
            "return location.protocol === 'tauri:' && !!document.querySelector('[data-testid=btn-open]');"
        ))
        # A clean profile may open onboarding automatically.
        xdo("key", "--clearmodifiers", "Escape")
        self.click("[data-testid=btn-open]")
        self.dialog("Open File", fixture)
        selector = "[data-testid=node-orders-api]"
        eventually("fixture API node", lambda: self.execute(
            "return document.querySelector(arguments[0])?.textContent.includes('Orders API');", selector
        ))
        self.execute("""
            const skip = [...document.querySelectorAll('button')]
                .find(e => e.textContent.trim() === 'Skip');
            skip?.click();
        """)
        viewport_hints = self.execute("""
            const viewport = document.querySelector('.react-flow__viewport');
            const nodes = [...viewport.querySelectorAll('.react-flow__node')];
            const edges = [...viewport.querySelectorAll('.react-flow__edges > svg')];
            return {
                viewport: getComputedStyle(viewport).willChange,
                nodes: nodes.length,
                edges: viewport.querySelectorAll('.react-flow__edge').length,
                childHints: [...nodes, ...edges].filter(e => getComputedStyle(e).willChange !== 'auto').length,
            };
        """)
        if viewport_hints != {"viewport": "transform", "nodes": 2, "edges": 1, "childHints": 0}:
            raise RuntimeError(f"Unexpected Linux canvas compositing hints: {viewport_hints}")
        self.execute("""
            const title = document.querySelector(arguments[0] + ' span[title]');
            title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        """, selector)
        eventually("canvas name input", lambda: self.execute(
            "return document.activeElement.matches(arguments[0] + ' input');", selector
        ))
        xdo("key", "--clearmodifiers", "ctrl+a")
        xdo("type", "--clearmodifiers", RENAMED)
        xdo("key", "--clearmodifiers", "Return")
        eventually("renamed API node", lambda: self.execute(
            "return document.querySelector(arguments[0])?.textContent.includes(arguments[1]);",
            selector, RENAMED,
        ))
        self.click("[data-testid=btn-save]")
        eventually("native saved bytes", lambda: RENAMED in fixture.read_text())
        xdo("key", "--clearmodifiers", "ctrl+w")
        eventually("document closes", lambda: self.execute(
            "return !document.querySelector(arguments[0]);", selector
        ))
        self.click("[data-testid=btn-open]")
        self.dialog("Open File", fixture)
        eventually("reopened saved name", lambda: self.execute(
            "return document.querySelector(arguments[0])?.textContent.includes(arguments[1]);",
            selector, RENAMED,
        ))
        self.click("[data-testid=btn-export]")
        eventually("Markdown export menu item", lambda: self.execute("""
            const item = [...document.querySelectorAll('[role=menuitem]')]
                .find(e => e.textContent.trim() === 'Export as Markdown');
            item?.click();
            return !!item;
        """))
        self.dialog("Save File", report)
        eventually("Markdown review contains saved name", lambda: report.exists() and (
            "## Components" in report.read_text() and RENAMED in report.read_text()
        ))
        print("Linux desktop smoke: launch, native open, save, reopen, and Markdown export passed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=ROOT / "src-tauri/target/debug/threat-forge")
    parser.add_argument("--driver", default="tauri-driver")
    parser.add_argument("--native-driver", default="WebKitWebDriver")
    parser.add_argument("--port", type=int, default=4444)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    desktop = Desktop(args.port)
    with tempfile.TemporaryDirectory(prefix="threatforge-desktop-") as work, (
        args.artifacts / "tauri-driver.log"
    ).open("w") as log:
        work = Path(work)
        fixture = work / "orders.thf"
        shutil.copyfile(ROOT / "e2e/fixtures/mcp-orders.thf", fixture)
        env = os.environ | {f"XDG_{kind}_HOME": str(work / kind.lower()) for kind in ("DATA", "CACHE", "CONFIG")}
        with subprocess.Popen([
            args.driver, "--native-driver", shutil.which(args.native_driver) or args.native_driver,
            "--port", str(args.port), "--native-port", str(args.port + 1),
        ], env=env, stdout=log, stderr=log, start_new_session=True) as driver:
            def ready():
                if driver.poll() is not None:
                    raise RuntimeError("tauri-driver exited; see tauri-driver.log")
                try:
                    desktop.request("GET", "/status")
                    return True
                except OSError:
                    return False

            try:
                eventually("tauri-driver ready", ready)
                desktop.run(args.binary.resolve(), fixture, work / "review.md")
            except Exception:
                try:
                    if shutil.which("import"):
                        subprocess.run(
                            ["import", "-window", "root", str(args.artifacts / "desktop.png")],
                            check=True, timeout=5,
                        )
                    elif desktop.session:
                        encoded = desktop.request("GET", f"/session/{desktop.session}/screenshot")
                        (args.artifacts / "webview.png").write_bytes(base64.b64decode(encoded))
                except (OSError, subprocess.SubprocessError):
                    pass
                raise
            finally:
                if desktop.session:
                    try:
                        desktop.request("DELETE", f"/session/{desktop.session}")
                    except OSError:
                        pass
                try:
                    os.killpg(driver.pid, 15)
                except ProcessLookupError:
                    pass


if __name__ == "__main__":
    main()
