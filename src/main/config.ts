import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { ActionKind } from "../shared/types";

const HOME = homedir();

// Everything specific to one person or one company lives in ~/.flux/config.json, never in the repo
export interface FluxConfig {
  // Name the triage prompt uses for the person Flux works for
  ownerName: string;
  github: {
    host: string;
    // Organisation or user that owns the repos; empty means every repo you are involved in
    owner: string;
    // Logins whose review comments never count as a human waiting on you
    bots: string[];
  };
  linear: {
    // Team keys recognised in PR titles and branch names (OFF, WEB…); empty means any UPPER-123 key
    teams: string[];
  };
  paths: {
    // Notes vault holding topics (flux/) and daily notes (daily/)
    vault: string;
    // Folder holding the git clones threads open in
    repos: string;
    // Prompt file the daily runs
    dailyCommand: string;
  };
  daily: {
    // Read-only MCP tools the daily may call, and servers it must not load
    allowedTools: string[];
    disallowedTools: string[];
  };
  // Prompt per action, with {url} and {ref} placeholders; overrides the built-in wording
  prompts: Partial<Record<ActionKind, string>>;
}

export const DEFAULT_CONFIG: FluxConfig = {
  ownerName: "la personne qui utilise Flux",
  github: { host: "github.com", owner: "", bots: [] },
  linear: { teams: [] },
  paths: {
    vault: join(HOME, "Documents/Flux"),
    repos: join(HOME, "code"),
    dailyCommand: join(HOME, ".claude/commands/daily.md"),
  },
  daily: { allowedTools: [], disallowedTools: [] },
  prompts: {},
};

type Overrides = {
  [Key in keyof FluxConfig]?: FluxConfig[Key] extends string[] | string
    ? FluxConfig[Key]
    : Partial<FluxConfig[Key]>;
};

function expand(path: string): string {
  if (path.startsWith("~/")) return join(HOME, path.slice(2));
  return isAbsolute(path) ? path : join(HOME, path);
}

export function mergeConfig(overrides: Overrides): FluxConfig {
  const paths = { ...DEFAULT_CONFIG.paths, ...overrides.paths };
  return {
    ownerName: overrides.ownerName ?? DEFAULT_CONFIG.ownerName,
    github: { ...DEFAULT_CONFIG.github, ...overrides.github },
    linear: { ...DEFAULT_CONFIG.linear, ...overrides.linear },
    paths: {
      vault: expand(paths.vault),
      repos: expand(paths.repos),
      dailyCommand: expand(paths.dailyCommand),
    },
    daily: { ...DEFAULT_CONFIG.daily, ...overrides.daily },
    prompts: { ...overrides.prompts },
  };
}

export const CONFIG_FILE = process.env.FLUX_CONFIG
  ? expand(process.env.FLUX_CONFIG)
  : join(HOME, ".flux/config.json");

function loadConfig(path: string): FluxConfig {
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    return mergeConfig(JSON.parse(readFileSync(path, "utf8")) as Overrides);
  } catch (error) {
    console.error(`Configuration illisible (${path}) : ${(error as Error).message}`);
    return DEFAULT_CONFIG;
  }
}

export const CONFIG = loadConfig(CONFIG_FILE);
