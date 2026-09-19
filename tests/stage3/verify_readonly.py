"""Run in the disposable verification container, /source and /media mounted read-only."""
import errno
import hashlib
import json
import os
import pathlib
import shutil
import signal
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request

workspace = pathlib.Path("/workspace/Luma")
shutil.copytree("/source", workspace, ignore=shutil.ignore_patterns(".git", ".local", "bin", "obj", "node_modules", "dist", "test-results"))
subprocess.run(["dotnet", "restore", "Luma.slnx", "--locked-mode"], cwd=workspace, check=True)
subprocess.run(["dotnet", "build", "Luma.slnx", "-c", "Release", "--no-restore"], cwd=workspace, check=True)
subprocess.run(["dotnet", "test", "Luma.slnx", "-c", "Release", "--no-build"], cwd=workspace, check=True)
try:
    pathlib.Path("/media/write-probe").write_text("must fail")
except OSError as error:
    assert error.errno == errno.EROFS, error
else:
    raise AssertionError("Media mount is writable")
originals = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path("/media").rglob("*") if p.is_file()}
environment = dict(os.environ, ASPNETCORE_URLS="http://127.0.0.1:5089", Luma__DatabasePath="/workspace/data/luma.db",
                   Luma__Indexing__CachePath="/workspace/cache", Luma__Indexing__VerificationIntervalSeconds="1",
                   Luma__Indexing__Libraries__0__Id="1", Luma__Indexing__Libraries__0__Name="Read-only fixture",
                   Luma__Indexing__Libraries__0__Path="/media", Logging__LogLevel__Default="Warning")
command = ["dotnet", str(workspace / "src/Luma.Server/bin/Release/net10.0/Luma.Server.dll")]
log = open("/workspace/server.log", "w+")
process = None
peak_children = 0
peak_video_tools = 0
peak_rss = 0

def start():
    result = subprocess.Popen(command, env=environment, cwd=workspace, stdout=log, stderr=log)
    for _ in range(300):
        if result.poll() is not None:
            log.seek(0)
            raise AssertionError(log.read())
        try:
            request("/api/status")
            return result
        except (urllib.error.URLError, ConnectionError):
            time.sleep(.05)
    raise AssertionError("Server startup timed out")

def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:5089" + path, data=data,
                                headers={"Content-Type": "application/json"}), timeout=10) as response:
        return json.load(response)

def sample():
    global peak_children, peak_video_tools, peak_rss
    rows = {}
    for directory in pathlib.Path("/proc").iterdir():
        if not directory.name.isdigit():
            continue
        try:
            status = dict(line.split(":", 1) for line in (directory / "status").read_text().splitlines())
            rows[int(directory.name)] = (int(status["PPid"]), status["Name"].strip(), int(status.get("VmRSS", "0 kB").split()[0]))
        except (OSError, ValueError, KeyError):
            pass
    children = [row for row in rows.values() if row[0] == process.pid]
    peak_children = max(peak_children, len(children))
    peak_video_tools = max(peak_video_tools, sum(row[1] in ("ffmpeg", "ffprobe") for row in children))
    peak_rss = max(peak_rss, sum(row[2] for row in children) + rows.get(process.pid, (0, "", 0))[2])
    assert len(children) <= int(environment.get("Luma__Indexing__ProcessingWorkers", "2")), children
    assert sum(row[1] in ("ffmpeg", "ffprobe") for row in children) <= 1, children

def settled():
    for _ in range(2400):
        sample()
        state = request("/api/indexing")
        scan = request(f"/api/scans/{state['libraries'][0]['latestScanId']}")
        if scan["state"] == "completed" and scan["pending"] == 0 and scan["processing"] == 0:
            assert scan["ready"] == 12 and scan["failed"] == 1, scan
            return scan
        time.sleep(.05)
    log.seek(0)
    raise AssertionError(log.read())

try:
    process = start()
    first = settled()
    db = sqlite3.connect("/workspace/data/luma.db")
    identity = db.execute("SELECT Id,SourceRevision FROM Media ORDER BY Id").fetchall()
    assert len(identity) == 13
    assert db.execute("SELECT COUNT(*) FROM CacheEntries WHERE State='ready'").fetchone()[0] == 24
    # Real process restart while pending processing remains; ready results and IDs converge.
    request("/api/libraries/1/scans", {"force": True})
    process.send_signal(signal.SIGTERM)
    process.wait(timeout=10)
    environment["Luma__Indexing__ProcessingWorkers"] = "1"
    process = start()
    settled()
    assert [r[0] for r in db.execute("SELECT Id FROM Media ORDER BY Id")] == [r[0] for r in identity]
    # Remove generated cache only. Background verification must recover it without an HTTP media request.
    entries = db.execute("SELECT RelativePath FROM CacheEntries WHERE State='ready'").fetchall()
    for (relative,) in entries:
        pathlib.Path("/workspace/cache", relative).unlink(missing_ok=True)
    for _ in range(2400):
        sample()
        count = db.execute("SELECT COUNT(*) FROM CacheEntries WHERE State='ready'").fetchone()[0]
        actual = len(list(pathlib.Path("/workspace/cache").rglob("*.jpg"))) + len(list(pathlib.Path("/workspace/cache").rglob("*.webp")))
        if count == 24 and actual == 24:
            break
        time.sleep(.05)
    else:
        raise AssertionError("Cache regeneration timed out")
    assert originals == {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in originals}
    print(json.dumps({"result": "passed", "media": 13, "ready": 12, "failed": 1, "skipped": 1,
                      "cacheEntries": 24, "mount": "read-only (EROFS)", "restart": "passed", "cacheLoss": "passed",
                      "peakChildProcesses": peak_children, "peakVideoTools": peak_video_tools,
                      "peakServerAndChildrenRssKiB": peak_rss}, indent=2), flush=True)
finally:
    if process is not None and process.poll() is None:
        process.send_signal(signal.SIGTERM)
        process.wait(timeout=10)
    log.close()
