
"""
VidFlow Render API — Test Suite
================================
Run this AFTER starting the backend:  python main.py

What this script does:
  1. Checks the server is up
  2. Creates the required folder structure + dummy files for the test project
  3. Tests every endpoint in the correct order
  4. Streams SSE progress live in the terminal
  5. Cleans up test files when done

Required:  pip install requests sseclient-py Pillow
"""

import json
import os
import shutil
import sys
import time
from pathlib import Path

# ─────────────────────────────────────────────────────────────────
# CONFIG — change these if needed
# ─────────────────────────────────────────────────────────────────

BASE_URL   = "http://localhost:8000"

# Must match BASE_DIR in your backend config.py
# Default is ~/Documents/VidFlow
VIDFLOW_BASE_DIR = Path.home() / "Documents" / "VidFlow"

# Dummy project ID — change to any string
PROJECT_ID = "test_project_abc123"

# ─────────────────────────────────────────────────────────────────
# COLORS
# ─────────────────────────────────────────────────────────────────

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"

def ok(msg):    print(f"  {GREEN}✓{RESET}  {msg}")
def fail(msg):  print(f"  {RED}✗{RESET}  {msg}")
def info(msg):  print(f"  {CYAN}→{RESET}  {msg}")
def warn(msg):  print(f"  {YELLOW}!{RESET}  {msg}")
def section(title):
    print(f"\n{BOLD}{'─' * 55}{RESET}")
    print(f"{BOLD}  {title}{RESET}")
    print(f"{BOLD}{'─' * 55}{RESET}")


# ─────────────────────────────────────────────────────────────────
# SETUP — create the folder structure the backend expects
# ─────────────────────────────────────────────────────────────────

def setup_test_project():
    """
    The backend derives all paths from:
        VIDFLOW_BASE_DIR / {project_id} /
            audio.mp3       ← required
            images/
                001.png     ← required (one per scene)
                002.png
    """
    section("SETUP — Creating test project files")

    project_dir = VIDFLOW_BASE_DIR / PROJECT_ID
    images_dir  = project_dir / "images"

    info(f"Project folder: {project_dir}")

    images_dir.mkdir(parents=True, exist_ok=True)
    ok("Created folder structure")

    # ── Dummy audio.mp3 ───────────────────────────────────────────
    # A real MP3 header so MoviePy doesn't crash immediately.
    # For a proper test, replace this with a real audio file.
    audio_path = project_dir / "audio.mp3"
    if not audio_path.exists():
        # Minimal valid MP3 (silence) — 44 bytes ID3 header
        mp3_bytes = (
            b"ID3\x03\x00\x00\x00\x00\x00" +      # ID3v2.3 header
            b"\x00" * 35 +                        # empty tags
            b"\xff\xfb\x90\x00" +                 # MPEG frame header
            b"\x00" * 413                         # silence frame
        )
        audio_path.write_bytes(mp3_bytes)
        ok(f"Created dummy audio.mp3 ({len(mp3_bytes)} bytes)")
        warn("This is a placeholder — replace with a real .mp3 for a full render test")
    else:
        ok(f"audio.mp3 already exists — using it as-is")

    # ── Dummy images ──────────────────────────────────────────────
    # Creates solid-colour PNG files (001.png, 002.png)
    # For a real test, drop real images into the images/ folder.
    try:
        from PIL import Image

        colours = [(70, 130, 180), (180, 100, 70)]   # steel blue, terracotta
        filenames = ["001.png", "002.png"]

        for filename, colour in zip(filenames, colours):
            img_path = images_dir / filename
            if not img_path.exists():
                img = Image.new("RGB", (1920, 1080), colour)
                img.save(img_path)
                ok(f"Created dummy image: {filename} (1920×1080, solid colour)")
            else:
                ok(f"Image already exists: {filename}")

    except ImportError:
        fail("Pillow not installed — can't create dummy images")
        fail("Run:  pip install Pillow")
        fail("Or manually put 001.png + 002.png into:")
        fail(f"  {images_dir}")
        sys.exit(1)

    print()
    info(f"Final layout:")
    for p in sorted(project_dir.rglob("*")):
        rel = p.relative_to(project_dir)
        indent = "    " * (len(rel.parts) - 1)
        size = f"({p.stat().st_size:,} bytes)" if p.is_file() else ""
        print(f"       {indent}{rel.name}  {DIM}{size}{RESET}")

    return project_dir


# ─────────────────────────────────────────────────────────────────
# SCENE MAP — the only thing the frontend sends
# ─────────────────────────────────────────────────────────────────

SCENE_MAP = {
    "scenes": [
        {
            "scene_index":    0,
            "image_filename": "001.png",
            "start_time":     0.0,
            "end_time":       3.0,
            "subtitle_text":  "Scene one — zoom in",
            "motion":         "zoom_in",
        },
        {
            "scene_index":    1,
            "image_filename": "002.png",
            "start_time":     3.0,
            "end_time":       6.0,
            "subtitle_text":  "Scene two — pan left",
            "motion":         "pan_left",
        },
    ]
}


# ─────────────────────────────────────────────────────────────────
# TESTS
# ─────────────────────────────────────────────────────────────────

def test_health(session):
    section("1 · Health Check  GET /")
    r = session.get(f"{BASE_URL}/")
    info(f"Status: {r.status_code}")
    data = r.json()
    print(f"       {json.dumps(data, indent=6)}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    ok("Server is up")


def test_start_render(session):
    section("2 · Start Render  POST /projects/{id}/render")

    body = {"scene_map": SCENE_MAP}
    info(f"project_id : {PROJECT_ID}")
    info(f"Body       : {json.dumps(body, indent=6)}")

    r = session.post(f"{BASE_URL}/projects/{PROJECT_ID}/render", json=body)
    info(f"Status: {r.status_code}")
    data = r.json()
    print(f"       {json.dumps(data, indent=6)}")

    assert r.status_code == 202, f"Expected 202, got {r.status_code}: {data}"
    ok("Render accepted (202)")
    return data


def test_duplicate_render(session):
    section("3 · Duplicate Render Test  POST /projects/{id}/render  → expect 409")

    r = session.post(
        f"{BASE_URL}/projects/{PROJECT_ID}/render",
        json={"scene_map": SCENE_MAP},
    )
    info(f"Status: {r.status_code}")
    print(f"       {json.dumps(r.json(), indent=6)}")
    assert r.status_code == 409, f"Expected 409, got {r.status_code}"
    ok("Correctly rejected duplicate (409)")


def test_poll_status(session):
    section("4 · Poll Status  GET /projects/{id}/render")

    r = session.get(f"{BASE_URL}/projects/{PROJECT_ID}/render")
    info(f"Status: {r.status_code}")
    data = r.json()
    print(f"       {json.dumps(data, indent=6)}")
    assert r.status_code == 200
    ok(f"Job status: {data['status']}  progress: {data['progress']}%")
    return data


def test_sse_stream(session):
    section("5 · SSE Stream  GET /projects/{id}/render/stream")

    try:
        import sseclient
    except ImportError:
        warn("sseclient-py not installed — skipping SSE test")
        warn("Run:  pip install sseclient-py")
        warn("Falling back to polling instead...")
        _poll_until_done(session)
        return

    url = f"{BASE_URL}/projects/{PROJECT_ID}/render/stream"
    info(f"Connecting to SSE stream: {url}")
    info("Waiting for render to complete...\n")

    r = session.get(url, stream=True, timeout=300)
    client = sseclient.SSEClient(r)

    bar_width = 30
    for event in client.events():
        if not event.data:
            continue

        data = json.loads(event.data)

        if event.event == "connected":
            ok(f"SSE connected — project: {data.get('project_id')}")
            continue

        status   = data.get("status", "")
        progress = data.get("progress", 0)
        error    = data.get("error")

        # Progress bar
        filled = int(bar_width * progress / 100)
        bar    = "█" * filled + "░" * (bar_width - filled)
        line   = f"  [{bar}] {progress:3d}%  {status}"
        print(f"\r{line}", end="", flush=True)

        if event.event == "complete":
            print()  # newline after progress bar
            if status == "done":
                ok(f"Render complete! render_secs={data.get('render_secs')}s")
            elif status == "error":
                fail(f"Render failed: {error}")
            elif status == "cancelled":
                warn("Render was cancelled")
            break


def _poll_until_done(session):
    """Fallback: poll every second until done/error/cancelled."""
    info("Polling every 1s until render finishes...")
    for _ in range(300):
        r = session.get(f"{BASE_URL}/projects/{PROJECT_ID}/render")
        data = r.json()
        status   = data["status"]
        progress = data["progress"]
        bar_width = 30
        filled = int(bar_width * progress / 100)
        bar    = "█" * filled + "░" * (bar_width - filled)
        print(f"\r  [{bar}] {progress:3d}%  {status}", end="", flush=True)
        if status in ("done", "error", "cancelled"):
            print()
            if status == "done":
                ok(f"Render complete! render_secs={data.get('render_secs')}s")
            elif status == "error":
                fail(f"Render failed: {data.get('error')}")
            elif status == "cancelled":
                warn("Render was cancelled")
            return
        time.sleep(1)
    fail("Timed out after 300s")


def test_download(session):
    section("6 · Download  GET /projects/{id}/render/download")

    # First poll to confirm we're done
    r = session.get(f"{BASE_URL}/projects/{PROJECT_ID}/render")
    status = r.json().get("status")

    if status != "done":
        warn(f"Render status is '{status}' — skipping download test")
        return

    url = f"{BASE_URL}/projects/{PROJECT_ID}/render/download"
    info(f"Streaming from: {url}")

    r = session.get(url, stream=True, timeout=60)
    info(f"Status        : {r.status_code}")
    info(f"Content-Type  : {r.headers.get('Content-Type')}")

    assert r.status_code == 200, f"Expected 200, got {r.status_code}"

    # Save to disk for inspection
    out_path = Path("test_output.mp4")
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)

    size_mb = out_path.stat().st_size / 1_048_576
    ok(f"Downloaded → {out_path}  ({size_mb:.2f} MB)")
    info("Open test_output.mp4 to verify the video looks correct")


def test_download_not_ready(session):
    """Extra guard: try downloading before render is done — expect 409."""
    pass  # Only relevant mid-render; skipping in sequential flow


def test_not_found(session):
    section("7 · 404 Tests — nonexistent project")

    fake = "nonexistent_project_xyz"

    r = session.get(f"{BASE_URL}/projects/{fake}/render")
    info(f"GET  /render    → {r.status_code}")
    assert r.status_code == 404
    ok("404 on status poll for unknown project")

    r = session.get(f"{BASE_URL}/projects/{fake}/render/download")
    info(f"GET  /download  → {r.status_code}")
    assert r.status_code == 404
    ok("404 on download for unknown project")

    r = session.delete(f"{BASE_URL}/projects/{fake}/render")
    info(f"DEL  /render    → {r.status_code}")
    assert r.status_code == 404
    ok("404 on cancel for unknown project")


def test_validation_errors(session):
    section("8 · Validation Errors  → expect 422")

    cases = [
        ("Empty scenes list",       {"scene_map": {"scenes": []}}),
        ("Missing motion field",    {"scene_map": {"scenes": [
            {"scene_index": 0, "image_filename": "001.png",
             "start_time": 0, "end_time": 5, "subtitle_text": "hi"}
        ]}}),
        ("Invalid motion value",    {"scene_map": {"scenes": [
            {"scene_index": 0, "image_filename": "001.png",
             "start_time": 0, "end_time": 5, "subtitle_text": "hi",
             "motion": "spin_around"}
        ]}}),
        ("end_time <= start_time",  {"scene_map": {"scenes": [
            {"scene_index": 0, "image_filename": "001.png",
             "start_time": 5, "end_time": 2, "subtitle_text": "hi",
             "motion": "zoom_in"}
        ]}}),
        ("Negative start_time",     {"scene_map": {"scenes": [
            {"scene_index": 0, "image_filename": "001.png",
             "start_time": -1, "end_time": 5, "subtitle_text": "hi",
             "motion": "zoom_in"}
        ]}}),
        ("Empty image_filename",    {"scene_map": {"scenes": [
            {"scene_index": 0, "image_filename": "  ",
             "start_time": 0, "end_time": 5, "subtitle_text": "hi",
             "motion": "zoom_in"}
        ]}}),
    ]

    # Use a fake project ID so we don't conflict with the real render
    fake_project = "validation_test_project"

    for label, body in cases:
        r = session.post(
            f"{BASE_URL}/projects/{fake_project}/render",
            json=body,
        )
        status = r.status_code
        if status == 422:
            ok(f"422 ✓  {label}")
        else:
            fail(f"{status} ✗  {label}  (expected 422)")
            print(f"       {r.json()}")


def test_delete_job(session):
    section("9 · Delete Job  DELETE /projects/{id}/render/job")

    r = session.delete(f"{BASE_URL}/projects/{PROJECT_ID}/render/job")
    info(f"Status: {r.status_code}")
    assert r.status_code in (204, 200), f"Expected 204, got {r.status_code}"
    ok("Job removed from server memory")

    # Confirm it's gone
    r2 = session.get(f"{BASE_URL}/projects/{PROJECT_ID}/render")
    info(f"Status after delete: {r2.status_code}")
    assert r2.status_code == 404
    ok("404 confirmed — job is gone")


# ─────────────────────────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────────────────────────

def cleanup(project_dir: Path):
    section("CLEANUP")
    answer = input(f"  Delete test project folder?\n  {project_dir}\n  [y/N]: ").strip().lower()
    if answer == "y":
        shutil.rmtree(project_dir, ignore_errors=True)
        ok("Test project folder deleted")
    else:
        info("Kept test project folder")

    if Path("test_output.mp4").exists():
        answer2 = input("  Delete test_output.mp4? [y/N]: ").strip().lower()
        if answer2 == "y":
            Path("test_output.mp4").unlink()
            ok("test_output.mp4 deleted")


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────

def main():
    print(f"""
{BOLD}╔══════════════════════════════════════════════════════╗
║        VidFlow Render API — Test Suite               ║
╚══════════════════════════════════════════════════════╝{RESET}

  {DIM}Server   : {BASE_URL}
  Project  : {PROJECT_ID}
  Base dir : {VIDFLOW_BASE_DIR}{RESET}
""")

    try:
        import requests
    except ImportError:
        fail("requests not installed.  Run:  pip install requests")
        sys.exit(1)

    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})

    # Step 1: create the files the backend needs
    project_dir = setup_test_project()

    passed = 0
    failed = 0

    tests = [
        ("Health check",        lambda: test_health(session)),
        ("Start render",        lambda: test_start_render(session)),
        ("Duplicate render",    lambda: test_duplicate_render(session)),
        ("Poll status",         lambda: test_poll_status(session)),
        ("SSE stream",          lambda: test_sse_stream(session)),
        ("Download",            lambda: test_download(session)),
        ("404 errors",          lambda: test_not_found(session)),
        ("Validation errors",   lambda: test_validation_errors(session)),
        ("Delete job",          lambda: test_delete_job(session)),
    ]

    for name, fn in tests:
        try:
            fn()
            passed += 1
        except AssertionError as e:
            fail(f"ASSERTION FAILED in [{name}]: {e}")
            failed += 1
        except Exception as e:
            fail(f"ERROR in [{name}]: {type(e).__name__}: {e}")
            failed += 1

    section("RESULTS")
    print(f"  {GREEN}{passed} passed{RESET}   {RED if failed else DIM}{failed} failed{RESET}\n")

    cleanup(project_dir)

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()