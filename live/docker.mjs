import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function dockerRun(image, script, input, { timeout = 35_000, args = [] } = {}) {
  const docker = process.env.AGENT_DX_DOCKER || 'docker';
  const name = 'moderato-agent-dx-' + randomUUID();
  const result = spawnSync(docker, [
    'run', '--name', name, '--rm', '-i', '--pull', 'never', '--network', 'none', '--read-only',
    '--tmpfs', '/tmp:rw,exec,size=768m,mode=1777', '--user', '1654:1654',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--memory', '2g', '--pids-limit', '128', '--cpus', '2',
    '-e', 'HOME=/tmp', '-e', 'DOTNET_CLI_HOME=/tmp', '-e', 'NUGET_PACKAGES=/tmp/nuget',
    '-e', 'AGENT_DX_NUGET_SOURCES=/feed', image, 'sh', '-c', script, 'agent-dx', ...args,
  ], { input, encoding: 'utf8', timeout, windowsHide: true });
  if (result.error) {
    spawnSync(docker, ['rm', '-f', name], { timeout: 5_000, windowsHide: true });
  }
  return result;
}
