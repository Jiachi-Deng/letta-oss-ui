import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function normalizeOptionalPath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : null;
}

export function getReleaseConfigCandidates({ workspaceRoot, cliArgPath, env = process.env, homeDir = os.homedir() }) {
  const workspaceReleaseConfigPath = path.join(workspaceRoot, "release-config.local.json");
  const userAppConfigPath = path.join(
    homeDir,
    "Library",
    "Application Support",
    "Letta",
    "config.json",
  );

  return [
    {
      label: "--config",
      path: normalizeOptionalPath(cliArgPath),
      requiredWhenSpecified: true,
    },
    {
      label: "LETTA_RELEASE_CONFIG_PATH",
      path: normalizeOptionalPath(env.LETTA_RELEASE_CONFIG_PATH),
      requiredWhenSpecified: true,
    },
    {
      label: "workspace release-config.local.json",
      path: workspaceReleaseConfigPath,
      requiredWhenSpecified: false,
    },
    {
      label: "user Application Support config",
      path: userAppConfigPath,
      requiredWhenSpecified: false,
    },
  ];
}

function buildMissingConfigMessage({ workspaceRoot, candidates }) {
  const checkedPaths = candidates
    .filter((candidate) => candidate.path)
    .map((candidate) => `- ${candidate.label}: ${candidate.path}`)
    .join("\n");

  const examplePath = path.join(workspaceRoot, "release-config.example.json");
  const localPath = path.join(workspaceRoot, "release-config.local.json");

  return [
    "Unable to resolve a release config for packaged/release evals.",
    "Checked paths:",
    checkedPaths || "- (no candidate paths available)",
    "Recommended fix:",
    `- copy ${examplePath} -> ${localPath} and fill in real credentials`,
    "- or set LETTA_RELEASE_CONFIG_PATH to an explicit JSON file",
    "- falling back to ~/Library/Application Support/Letta/config.json is supported but not recommended for handoff or CI",
  ].join("\n");
}

export function resolveReleaseConfigPath({ workspaceRoot, cliArgPath, env = process.env, homeDir = os.homedir() }) {
  const candidates = getReleaseConfigCandidates({ workspaceRoot, cliArgPath, env, homeDir });

  for (const candidate of candidates) {
    if (!candidate.path) continue;
    if (existsSync(candidate.path)) {
      return {
        configPath: candidate.path,
        sourceLabel: candidate.label,
        candidates,
      };
    }
    if (candidate.requiredWhenSpecified) {
      throw new Error(`Missing release config for ${candidate.label}: ${candidate.path}`);
    }
  }

  throw new Error(buildMissingConfigMessage({ workspaceRoot, candidates }));
}

export function loadReleaseConfig({ workspaceRoot, cliArgPath, env = process.env, homeDir = os.homedir() }) {
  const resolved = resolveReleaseConfigPath({ workspaceRoot, cliArgPath, env, homeDir });
  const parsed = JSON.parse(readFileSync(resolved.configPath, "utf8"));
  const connectionType = parsed.connectionType || "letta-server";
  const baseUrl = parsed.LETTA_BASE_URL;
  const apiKey = parsed.LETTA_API_KEY;
  const model = parsed.model;

  if (connectionType !== "letta-server" && (!baseUrl || !apiKey || !model)) {
    throw new Error(`Release config at ${resolved.configPath} is missing compatible-mode fields`);
  }

  return {
    ...resolved,
    parsed,
    connectionType,
    baseUrl,
    apiKey,
    model,
  };
}
