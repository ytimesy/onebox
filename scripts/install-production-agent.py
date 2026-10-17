"""Install only the ONEBOX PC-local UTC daily publisher. No external job or tunnel changes."""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

project = Path(__file__).resolve().parent.parent
node = shutil.which('node')
if not node or not (project / 'dist-production-shell/.PRODUCTION_SHELL').is_file():
    raise SystemExit('Build the production shell first')
check = subprocess.run([node, str(project / 'scripts/publish-daily.mjs'), 'status'], cwd=project, check=True, capture_output=True, text=True)
import json
if json.loads(check.stdout).get('stage') != 'daily':
    raise SystemExit('Publish and verify the first daily release before enabling the local updater')
label = 'local.onebox.daily'
target = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
if target.exists():
    old = plistlib.loads(target.read_bytes())
    if old.get('Label') != label or old.get('WorkingDirectory') != str(project):
        raise SystemExit('Refuse to replace another service')
plist = {
    'Label': label,
    'ProgramArguments': [node, str(project / 'scripts/publish-daily.mjs'), 'publish'],
    'WorkingDirectory': str(project), 'RunAtLoad': True, 'StartInterval': 60,
    'ProcessType': 'Background', 'ThrottleInterval': 10,
    'EnvironmentVariables': {'PATH': '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'},
    'StandardOutPath': str(project / 'var/local.onebox.daily.log'),
    'StandardErrorPath': str(project / 'var/local.onebox.daily.error.log'),
}
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(plistlib.dumps(plist))
target.chmod(0o600)
domain = f'gui/{os.getuid()}'
loaded = subprocess.run(['launchctl','print',f'{domain}/{label}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0
if not loaded:
    subprocess.run(['launchctl','bootstrap',domain,str(target)],check=True)
print(f'{label}: PC-local 60-second UTC-date check; published daily release required; {target}')
