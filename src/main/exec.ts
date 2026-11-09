import { execFile } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  input?: string
  env?: NodeJS.ProcessEnv
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message
          reject(new Error(detail.split('\n')[0]))
          return
        }
        resolve(stdout)
      },
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
  })
}
