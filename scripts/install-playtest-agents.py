"""Install only ONEBOX-owned LaunchAgents; leave shared app configuration untouched."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

project = Path(__file__).resolve().parent.parent
config = json.loads((project / 'ops/playtest.json').read_text())
if not (project / 'var/current/index.html').is_file():
    raise SystemExit('Promote a checked playtest build first')
if not (project / 'ops/tunnel.yml').is_file():
    raise SystemExit('Provide a dedicated ops/tunnel.yml first')
agent_dir = Path.home() / 'Library/LaunchAgents'
agent_dir.mkdir(parents=True, exist_ok=True)
node, cloudflared = shutil.which('node'), shutil.which('cloudflared')
if not node or not cloudflared:
    raise SystemExit('node and cloudflared are required')
services = {
    'local.onebox.web': [node, str(project / 'scripts/static-server.mjs')],
    'local.onebox.tunnel': [cloudflared, 'tunnel', '--config', str(project / 'ops/tunnel.yml'), '--no-autoupdate', 'run', config['tunnel']],
}
for label, args in services.items():
    target = agent_dir / f'{label}.plist'
    if target.exists():
        current = plistlib.loads(target.read_bytes())
        if current.get('Label') != label or current.get('WorkingDirectory') != str(project):
            raise SystemExit(f'Refuse to replace a non-ONEBOX service: {target}')
    plist = {
        'Label': label, 'ProgramArguments': args, 'WorkingDirectory': str(project),
        'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
        'EnvironmentVariables': {'PATH': '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', 'ONEBOX_PORT': str(config['port']), 'PUBLIC_ORIGIN': config['public_origin']},
        'StandardOutPath': str(project / 'var' / f'{label}.log'),
        'StandardErrorPath': str(project / 'var' / f'{label}.error.log'),
    }
    target.write_bytes(plistlib.dumps(plist)); target.chmod(0o600)
    domain = f'gui/{os.getuid()}'
    exists = subprocess.run(['launchctl', 'print', f'{domain}/{label}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not exists:
        subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True)
    else:
        print(f'{label} already loaded; use bootout/bootstrap explicitly to reload its plist')
    print(f'{label}: {target}')
