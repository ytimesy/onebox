"""Install the loopback-only ONEBOX reviewer; do not change public/shared services."""
import os
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess

project = Path(__file__).resolve().parent.parent
if not (project / "var/reviewer/index.html").is_file():
    raise SystemExit("Build the checked reviewer first: npm run build:reviewer")
node = shutil.which("node")
if not node:
    raise SystemExit("Node.js is required")
label = "local.onebox.reviewer"
domain = f"gui/{os.getuid()}"
agent_dir = Path.home() / "Library/LaunchAgents"
agent_dir.mkdir(parents=True, exist_ok=True)
target = agent_dir / f"{label}.plist"
args = [node, str(project / "packages/puzzle-tools/reviewer-server.ts")]
if target.is_symlink():
    raise SystemExit("Refuse a symlinked reviewer agent")
if target.exists():
    current = plistlib.loads(target.read_bytes())
    if current.get("Label") != label or current.get("WorkingDirectory") != str(project) or current.get("ProgramArguments") != args:
        raise SystemExit("Refuse to replace a different service")
loaded = subprocess.run(["launchctl", "print", f"{domain}/{label}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
if loaded:
    print("ONEBOX reviewer already loaded; leave it running")
    raise SystemExit(0)
with socket.socket() as probe:
    try:
        probe.bind(("127.0.0.1", 4324))
    except OSError:
        raise SystemExit("Reviewer port 4324 is occupied; inspect its owner first")
plist = {
    "Label": label,
    "ProgramArguments": args,
    "WorkingDirectory": str(project),
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "EnvironmentVariables": {
        "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
        "ONEBOX_REVIEW_PORT": "4324",
        "ONEBOX_REVIEW_WORKSPACE": "main",
    },
    "StandardOutPath": str(project / "var/local.onebox.reviewer.log"),
    "StandardErrorPath": str(project / "var/local.onebox.reviewer.error.log"),
}
temp = target.with_suffix(".plist.tmp")
with temp.open("xb") as handle:
    temp.chmod(0o600)
    handle.write(plistlib.dumps(plist))
temp.replace(target)
subprocess.run(["launchctl", "bootstrap", domain, str(target)], check=True)
print("ONEBOX reviewer: http://localhost:4324/ (loopback only)")
