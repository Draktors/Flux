import { run } from '../exec'
import { BIN } from '../paths'

// Legacy: threads opened before the move to Claude Desktop still live in cmux tabs
function onWorkspace(action: string[]): string[] {
  return [
    'on run argv',
    '  tell application "cmux"',
    '    repeat with w in windows',
    '      repeat with t in tabs of w',
    '        if (id of t as text) is (item 1 of argv) then',
    ...action,
    '          return "ok"',
    '        end if',
    '      end repeat',
    '    end repeat',
    '  end tell',
    '  return "missing"',
    'end run',
  ]
}

function osascript(lines: string[], argument: string): Promise<string> {
  const script = lines.flatMap(line => ['-e', line])
  return run(BIN.osascript, [...script, argument], { timeoutMs: 20_000 }).then(out => out.trim())
}

export async function selectWorkspace(id: string): Promise<boolean> {
  const script = onWorkspace(['select tab t', 'activate window w', 'activate'])
  return (await osascript(script, id)) === 'ok'
}

export async function closeWorkspace(id: string): Promise<boolean> {
  return (await osascript(onWorkspace(['close tab t']), id)) === 'ok'
}
