import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const lettaUiRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(lettaUiRoot, "../..");
const sourceRepoCandidates = [
  path.join(workspaceRoot, "vendor", "letta-monorepo"),
  path.resolve(lettaUiRoot, ".."),
];
const runtimeVenvCandidates = [
  path.join(workspaceRoot, "runtime", "python", "venv"),
  path.join(workspaceRoot, "vendor", "letta-monorepo", "venv"),
  path.resolve(lettaUiRoot, "..", "venv"),
];
const repoRoot = sourceRepoCandidates.find((candidate) => existsSync(candidate)) ?? sourceRepoCandidates[0];
const sourceVenvRoot = runtimeVenvCandidates.find((candidate) => existsSync(candidate)) ?? runtimeVenvCandidates[0];
const stageRoot = path.join(lettaUiRoot, "build-resources", "LettaServer");
const stageAppRoot = path.join(stageRoot, "app");
const stageManifestPath = path.join(stageRoot, "manifest.json");
const stageVenvPath = path.join(stageRoot, "venv");
const stagePythonPath = path.join(stageVenvPath, "bin", "python3");
const stagePythonBaseRoot = path.join(stageRoot, "python-base");
const stageNltkDataRoot = path.join(stageRoot, "nltk_data");
const LAYOUT_VERSION = 11;
const DEFAULT_PACKAGING_PROFILE = "telegram-lite";
const DIST_INFO_METADATA_FILES = new Set(["INSTALLER", "RECORD", "REQUESTED", "direct_url.json"]);
const TRANSIENT_DIR_NAMES = new Set(["__pycache__", ".pytest_cache", "tests", "test", "testing"]);
const TRANSIENT_ROOT_PREFIXES = ["server-home", "logs"];
const BASE_REMOVABLE_SITE_PACKAGES = [
  "pip",
  "setuptools",
  "wheel",
  "pytest",
  "_pytest",
  "pytest_locust",
];
const TELEGRAM_LITE_OPTIONAL_SITE_PACKAGES = [
  "temporalio",
  "matplotlib",
  "matplotlib_inline",
  "grpc_tools",
  "babel",
  "faker",
  "jedi",
  "box",
  "IPython",
  "locust",
  "ddtrace",
  "sympy",
  "langchain_community",
  "langchain_classic",
  "langchain_core",
];
const BASE_REMOVABLE_STAGE_FILES = [
  path.join("app", "letta", "personas", "examples", "sqldb", "test.db"),
];
const BASE_REMOVABLE_PYTHON_BASE_PATHS = [
  path.join("lib", "python3.11", "site-packages"),
  path.join("lib", "python3.11", "ensurepip"),
  path.join("lib", "python3.11", "idlelib"),
  path.join("lib", "python3.11", "distutils"),
  path.join("lib", "python3.11", "pydoc_data"),
  path.join("lib", "python3.11", "lib2to3"),
  path.join("lib", "python3.11", "tkinter"),
];

const PACKAGING_PROFILES = {
  "telegram-lite": {
    description: "Default slim desktop bundle tuned for the current Telegram-first release path.",
    optionalPrunedSitePackages: TELEGRAM_LITE_OPTIONAL_SITE_PACKAGES,
    removableStageFiles: BASE_REMOVABLE_STAGE_FILES,
    removablePythonBasePaths: BASE_REMOVABLE_PYTHON_BASE_PATHS,
    maxServerSizeMb: 475,
  },
  full: {
    description: "Diagnostic bundle that keeps optional Python dependencies for local debugging.",
    optionalPrunedSitePackages: [],
    removableStageFiles: BASE_REMOVABLE_STAGE_FILES,
    removablePythonBasePaths: BASE_REMOVABLE_PYTHON_BASE_PATHS,
    maxServerSizeMb: null,
  },
};

export function resolveBundledServerPackagingProfile(profileName = process.env.LETTA_SERVER_PROFILE ?? DEFAULT_PACKAGING_PROFILE) {
  const normalized = String(profileName || DEFAULT_PACKAGING_PROFILE).trim().toLowerCase();
  const profile = PACKAGING_PROFILES[normalized];
  if (!profile) {
    throw new Error(
      `[letta-server-build] Unsupported LETTA_SERVER_PROFILE=${JSON.stringify(profileName)}. ` +
      `Expected one of: ${Object.keys(PACKAGING_PROFILES).join(", ")}`,
    );
  }

  return {
    name: normalized,
    ...profile,
  };
}

export function getBundledServerPrunePlan(profileName = process.env.LETTA_SERVER_PROFILE ?? DEFAULT_PACKAGING_PROFILE) {
  const profile = resolveBundledServerPackagingProfile(profileName);
  return {
    profileName: profile.name,
    removableSitePackages: [...BASE_REMOVABLE_SITE_PACKAGES, ...profile.optionalPrunedSitePackages],
    removableStageFiles: [...profile.removableStageFiles],
    removablePythonBasePaths: [...profile.removablePythonBasePaths],
    transientDirNames: [...TRANSIENT_DIR_NAMES],
    transientRootPrefixes: [...TRANSIENT_ROOT_PREFIXES],
    distInfoMetadataFiles: [...DIST_INFO_METADATA_FILES],
    maxServerSizeMb: profile.maxServerSizeMb,
  };
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readManifest() {
  if (!existsSync(stageManifestPath)) return null;

  try {
    return JSON.parse(readFileSync(stageManifestPath, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(manifest) {
  mkdirSync(stageRoot, { recursive: true });
  writeFileSync(stageManifestPath, JSON.stringify(manifest, null, 2));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function removePath(targetPath) {
  rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

function resetSymlink(linkPath, target) {
  removePath(linkPath);
  symlinkSync(target, linkPath);
}

function removeMatchingChildren(parentDir, matcher) {
  if (!existsSync(parentDir)) return 0;

  let removed = 0;
  for (const name of readdirSync(parentDir)) {
    if (!matcher(name)) continue;
    removePath(path.join(parentDir, name));
    removed += 1;
  }
  return removed;
}

function walkAndPrune(rootPath, onPrune) {
  if (!existsSync(rootPath)) return;

  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current)) {
      const entryPath = path.join(current, entry);
      const stats = lstatSync(entryPath);

      if (stats.isDirectory()) {
        if (TRANSIENT_DIR_NAMES.has(entry)) {
          removePath(entryPath);
          onPrune(entryPath);
          continue;
        }
        stack.push(entryPath);
        continue;
      }

      if (entry.endsWith(".pyc") || entry.endsWith(".pyo")) {
        removePath(entryPath);
        onPrune(entryPath);
        continue;
      }

      if (DIST_INFO_METADATA_FILES.has(entry) && current.endsWith(".dist-info")) {
        removePath(entryPath);
        onPrune(entryPath);
      }
    }
  }
}

function pruneBundledServerRuntime() {
  const pruned = [];
  const prunePlan = getBundledServerPrunePlan();
  const sitePackagesRoot = path.join(
    stageVenvPath,
    "lib",
    `python${getPythonAbiTag(getBuildPython().version)}`,
    "site-packages",
  );
  const binRoot = path.join(stageVenvPath, "bin");

  removeMatchingChildren(stageRoot, (name) => TRANSIENT_ROOT_PREFIXES.some((prefix) => name.startsWith(prefix)));

  for (const relativeFilePath of prunePlan.removableStageFiles) {
    const absoluteFilePath = path.join(stageRoot, relativeFilePath);
    if (existsSync(absoluteFilePath)) {
      removePath(absoluteFilePath);
      pruned.push(absoluteFilePath);
    }
  }

  for (const relativePythonBasePath of prunePlan.removablePythonBasePaths) {
    const absolutePythonBasePath = path.join(
      stagePythonBaseRoot,
      "Python.framework",
      "Versions",
      getPythonAbiTag(getBuildPython().version),
      relativePythonBasePath,
    );
    if (existsSync(absolutePythonBasePath)) {
      removePath(absolutePythonBasePath);
      pruned.push(absolutePythonBasePath);
    }
  }

  if (existsSync(sitePackagesRoot)) {
    removeMatchingChildren(sitePackagesRoot, (name) => {
      if (prunePlan.removableSitePackages.includes(name)) return true;
      return prunePlan.removableSitePackages.some(
        (base) => name.startsWith(`${base}-`) && name.endsWith(".dist-info"),
      );
    });
  }

  if (existsSync(binRoot)) {
    removeMatchingChildren(binRoot, (name) =>
      name === "pip" ||
      name === "pip3" ||
      name.startsWith("pip3.") ||
      name === "wheel",
    );
  }

  walkAndPrune(stageRoot, (targetPath) => {
    pruned.push(targetPath);
  });

  return pruned;
}

function verifyBundledServerLayout() {
  const violations = [];

  if (!existsSync(stagePythonPath)) {
    violations.push(`Missing staged python runtime at ${stagePythonPath}`);
  }

  const forbiddenRootEntries = existsSync(stageRoot)
    ? readdirSync(stageRoot).filter((name) => TRANSIENT_ROOT_PREFIXES.some((prefix) => name.startsWith(prefix)))
    : [];
  for (const name of forbiddenRootEntries) {
    violations.push(`Forbidden mutable root entry staged: ${name}`);
  }

  if (existsSync(stageRoot)) {
    const stack = [stageRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of readdirSync(current)) {
        const entryPath = path.join(current, entry);
        const stats = lstatSync(entryPath);
        if (stats.isDirectory()) {
          if (TRANSIENT_DIR_NAMES.has(entry)) {
            violations.push(`Forbidden transient directory staged: ${entryPath}`);
            continue;
          }
          stack.push(entryPath);
          continue;
        }

        if (entry.endsWith(".pyc") || entry.endsWith(".pyo")) {
          violations.push(`Forbidden bytecode file staged: ${entryPath}`);
          continue;
        }

        if (DIST_INFO_METADATA_FILES.has(entry) && current.endsWith(".dist-info")) {
          violations.push(`Forbidden dist-info metadata staged: ${entryPath}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("[letta-server-build] Bundled runtime verification failed:");
    for (const violation of violations.slice(0, 50)) {
      console.error(`  - ${violation}`);
    }
    if (violations.length > 50) {
      console.error(`  ...and ${violations.length - 50} more`);
    }
    process.exit(1);
  }
}

function resolveBundledNltkSource() {
  const candidateRoots = [
    path.join(process.env.HOME ?? "", "nltk_data"),
    path.join(sourceVenvRoot, "nltk_data"),
    path.join(sourceVenvRoot, "share", "nltk_data"),
    path.join(sourceVenvRoot, "lib", "nltk_data"),
  ];

  for (const candidateRoot of candidateRoots) {
    const punktTabPath = path.join(candidateRoot, "tokenizers", "punkt_tab");
    if (existsSync(punktTabPath)) {
      return punktTabPath;
    }
  }

  return null;
}

function copyBundledNltkData() {
  const sourcePath = resolveBundledNltkSource();
  if (!sourcePath) {
    console.warn("[letta-server-build] No local nltk punkt_tab data found; continuing without bundled NLTK data.");
    return;
  }

  const targetPath = path.join(stageNltkDataRoot, "tokenizers", "punkt_tab");
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: true,
  });
}

function tryCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status === 0) {
    return result.stdout.trim() || result.stderr.trim();
  }

  return null;
}

function resolveBuildPython() {
  const candidates = [
    process.env.LETTA_BUNDLED_PYTHON,
    path.join(sourceVenvRoot, "bin", "python3"),
    "python3.11",
    "python3",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const version = tryCommand(candidate, ["--version"]);
    if (version) {
      const detailsRaw = tryCommand(
        candidate,
        [
          "-c",
          [
            "import json, os, sys",
            "base_prefix = os.path.realpath(sys.base_prefix)",
            "framework_root = os.path.dirname(os.path.dirname(base_prefix))",
            "print(json.dumps({'base_prefix': base_prefix, 'framework_root': framework_root}))",
          ].join("; "),
        ],
      );

      if (!detailsRaw) {
        continue;
      }

      const details = JSON.parse(detailsRaw);
      return {
        command: candidate,
        version,
        basePrefix: details.base_prefix,
        frameworkRoot: realpathSync(details.framework_root),
      };
    }
  }

  console.error(
    "[letta-server-build] Could not find a Python 3.11+ interpreter. Set LETTA_BUNDLED_PYTHON or install python3.11.",
  );
  process.exit(1);
}

let cachedBuildPython = null;

function getBuildPython() {
  if (!cachedBuildPython) {
    cachedBuildPython = resolveBuildPython();
  }
  return cachedBuildPython;
}

function resolveInputFingerprint(pythonVersion) {
  const prunePlan = getBundledServerPrunePlan();
  return {
    layoutVersion: LAYOUT_VERSION,
    packagingProfile: prunePlan.profileName,
    arch: process.arch,
    pythonVersion,
    pyprojectHash: sha256File(path.join(repoRoot, "pyproject.toml")),
    uvLockHash: sha256File(path.join(repoRoot, "uv.lock")),
    pythonFrameworkRoot: getBuildPython().frameworkRoot,
    removedSitePackages: prunePlan.removableSitePackages,
    transientDirNames: prunePlan.transientDirNames,
    transientRootPrefixes: prunePlan.transientRootPrefixes,
    distInfoMetadataFiles: prunePlan.distInfoMetadataFiles,
    removedPythonBasePaths: prunePlan.removablePythonBasePaths,
  };
}

function getPythonAbiTag(pythonVersion) {
  const match = pythonVersion.match(/Python\s+(\d+\.\d+)/);
  return match?.[1] ?? "3.11";
}

function getFullPythonVersion(pythonVersion) {
  const match = pythonVersion.match(/Python\s+(\d+\.\d+\.\d+)/);
  return match?.[1] ?? "3.11.0";
}

function resolveSourceSitePackages(pythonAbiTag) {
  const candidate = path.join(
    sourceVenvRoot,
    "lib",
    `python${pythonAbiTag}`,
    "site-packages",
  );

  return existsSync(candidate) ? candidate : null;
}

function stageFromLocalVenv(sourceSitePackages) {
  const destinationSitePackages = path.join(
    stageVenvPath,
    "lib",
    `python${getPythonAbiTag(getBuildPython().version)}`,
    "site-packages",
  );
  const editablePathFile = path.join(destinationSitePackages, "_letta.pth");

  rmSync(destinationSitePackages, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  cpSync(sourceSitePackages, destinationSitePackages, {
    recursive: true,
    force: true,
    dereference: false,
  });

  mkdirSync(stageAppRoot, { recursive: true });
  cpSync(path.join(repoRoot, "letta"), path.join(stageAppRoot, "letta"), {
    recursive: true,
    force: true,
  });
  cpSync(path.join(repoRoot, "alembic"), path.join(stageRoot, "alembic"), {
    recursive: true,
    force: true,
  });
  cpSync(path.join(repoRoot, "alembic.ini"), path.join(stageRoot, "alembic.ini"), {
    force: true,
  });
  cpSync(path.join(repoRoot, "certs"), path.join(stageRoot, "certs"), {
    recursive: true,
    force: true,
  });
  copyBundledNltkData();

  const stageFrameworkRoot = path.join(stagePythonBaseRoot, "Python.framework");
  const stageFrameworkVersionRoot = path.join(
    stageFrameworkRoot,
    "Versions",
    getPythonAbiTag(getBuildPython().version),
  );

  cpSync(getBuildPython().frameworkRoot, stageFrameworkRoot, {
    recursive: true,
    force: true,
    dereference: false,
  });

  // Homebrew's cellar layout is not a complete standalone macOS framework bundle.
  // Rebuild the canonical symlink structure so downstream codesign sees a valid framework.
  resetSymlink(path.join(stageFrameworkRoot, "Versions", "Current"), getPythonAbiTag(getBuildPython().version));
  resetSymlink(path.join(stageFrameworkRoot, "Python"), path.join("Versions", "Current", "Python"));
  resetSymlink(path.join(stageFrameworkRoot, "Resources"), path.join("Versions", "Current", "Resources"));
  resetSymlink(path.join(stageFrameworkRoot, "Headers"), path.join("Versions", "Current", "Headers"));
  resetSymlink(
    path.join(stageFrameworkVersionRoot, "Headers"),
    path.join("include", `python${getPythonAbiTag(getBuildPython().version)}`),
  );
  resetSymlink(path.join(stageFrameworkVersionRoot, "lib", `libpython${getPythonAbiTag(getBuildPython().version)}.dylib`), "../Python");
  resetSymlink(
    path.join(
      stageFrameworkVersionRoot,
      "lib",
      `python${getPythonAbiTag(getBuildPython().version)}`,
      `config-${getPythonAbiTag(getBuildPython().version)}-darwin`,
      `libpython${getPythonAbiTag(getBuildPython().version)}.dylib`,
    ),
    "../../../Python",
  );
  resetSymlink(
    path.join(
      stageFrameworkVersionRoot,
      "lib",
      `python${getPythonAbiTag(getBuildPython().version)}`,
      `config-${getPythonAbiTag(getBuildPython().version)}-darwin`,
      `libpython${getPythonAbiTag(getBuildPython().version)}.a`,
    ),
    "../../../Python",
  );

  writeFileSync(
    editablePathFile,
    'import os, site, sys; site.addsitedir(os.path.normpath(os.path.join(sys.prefix, "..", "app")))\n',
  );

  const bundledFrameworkPython = path.join(
    stagePythonBaseRoot,
    "Python.framework",
    "Versions",
    getPythonAbiTag(getBuildPython().version),
    "Python",
  );
  const pythonRelativeDylibPath = `@executable_path/../../python-base/Python.framework/Versions/${getPythonAbiTag(getBuildPython().version)}/Python`;

  run("install_name_tool", [
    "-change",
    path.join(getBuildPython().basePrefix, "Python"),
    pythonRelativeDylibPath,
    path.join(stageVenvPath, "bin", "python3"),
  ]);
  run("install_name_tool", [
    "-change",
    path.join(getBuildPython().basePrefix, "Python"),
    pythonRelativeDylibPath,
    path.join(stageVenvPath, "bin", "python"),
  ]);

  const stageFrameworkBinRoot = path.join(
    stagePythonBaseRoot,
    "Python.framework",
    "Versions",
    getPythonAbiTag(getBuildPython().version),
    "bin",
  );
  writeFileSync(
    path.join(stageVenvPath, "pyvenv.cfg"),
    [
      "home = BUNDLED_PYTHON_HOME",
      "include-system-site-packages = false",
      `version = ${getFullPythonVersion(getBuildPython().version)}`,
      "executable = BUNDLED_PYTHON_EXECUTABLE",
      "command = bundled-runtime",
      "",
    ].join("\n"),
  );

  for (const signTarget of [
    bundledFrameworkPython,
    path.join(
      stagePythonBaseRoot,
      "Python.framework",
      "Versions",
      getPythonAbiTag(getBuildPython().version),
      "Resources",
      "Python.app",
      "Contents",
      "MacOS",
      "Python",
    ),
    path.join(stageVenvPath, "bin", "python3"),
    path.join(stageVenvPath, "bin", "python"),
  ]) {
    if (existsSync(signTarget)) {
      run("codesign", ["-f", "-s", "-", signTarget]);
    }
  }
}

function isDirectExecution(metaUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(process.argv[1]);
}

function estimateDirectorySizeMb(rootPath) {
  return Math.round(
    Array.from((function walk(root) {
      const files = [];
      const stack = [root];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const entry of readdirSync(current)) {
          const entryPath = path.join(current, entry);
          const stats = lstatSync(entryPath);
          if (stats.isDirectory()) stack.push(entryPath);
          else files.push(stats.size);
        }
      }
      return files;
    })(rootPath)).reduce((total, size) => total + size, 0) / 1024 / 1024,
  );
}

export function getDefaultBundledServerProfileName() {
  return DEFAULT_PACKAGING_PROFILE;
}

export function getBundledServerPackagingProfiles() {
  return Object.fromEntries(
    Object.entries(PACKAGING_PROFILES).map(([name, profile]) => [name, {
      description: profile.description,
      maxServerSizeMb: profile.maxServerSizeMb,
    }]),
  );
}

export function buildBundledServerManifestVersionInfo(pythonVersion) {
  const sourceSitePackages = resolveSourceSitePackages(getPythonAbiTag(pythonVersion));
  return {
    mode: sourceSitePackages ? "copied-site-packages" : "pip-install",
  };
}

function main() {
  const selectedProfile = resolveBundledServerPackagingProfile();
  const buildPython = getBuildPython();
  const fingerprint = resolveInputFingerprint(buildPython.version);
  const previousManifest = readManifest();
  const shouldReuse =
    previousManifest &&
    JSON.stringify(previousManifest.fingerprint) === JSON.stringify(fingerprint) &&
    existsSync(stagePythonPath);

  console.log(
    `[letta-server-build] Packaging profile ${selectedProfile.name}: ${selectedProfile.description}`,
  );

  if (shouldReuse) {
    console.log(
      `[letta-server-build] Reusing staged Letta server runtime at ${stageRoot}`,
    );
  } else {
    console.log(
      `[letta-server-build] Building bundled Letta server runtime with ${buildPython.command} (${buildPython.version})`,
    );

    rmSync(stageRoot, { recursive: true, force: true });
    mkdirSync(stageRoot, { recursive: true });

    run(buildPython.command, ["-m", "venv", "--copies", stageVenvPath], {
      cwd: repoRoot,
    });

    const sourceSitePackages = resolveSourceSitePackages(getPythonAbiTag(buildPython.version));

    if (sourceSitePackages) {
      console.log(
        `[letta-server-build] Reusing local site-packages from ${sourceSitePackages}`,
      );
      stageFromLocalVenv(sourceSitePackages);
    } else {
      console.log("[letta-server-build] Local source venv not found; falling back to pip install.");

      run(stagePythonPath, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], {
        cwd: repoRoot,
      });

      run(
        stagePythonPath,
        ["-m", "pip", "install", "--no-cache-dir", `${repoRoot}[desktop]`],
        { cwd: repoRoot },
      );
    }
  }

  const pruned = pruneBundledServerRuntime();
  verifyBundledServerLayout();

  const importCheck = spawnSync(
    stagePythonPath,
    ["-c", "import letta; print(letta.__version__); print(letta.__file__)"],
    {
      cwd: stageRoot,
      stdio: "pipe",
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONHOME: path.join(
          stagePythonBaseRoot,
          "Python.framework",
          "Versions",
          getPythonAbiTag(buildPython.version),
        ),
        NLTK_DATA: stageNltkDataRoot,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );

  if (importCheck.status !== 0) {
    console.error("[letta-server-build] Bundled runtime failed import check.");
    process.stderr.write(importCheck.stderr || "");
    process.stdout.write(importCheck.stdout || "");
    process.exit(importCheck.status ?? 1);
  }

  const postImportPruned = pruneBundledServerRuntime();
  verifyBundledServerLayout();

  const finalSizeMb = estimateDirectorySizeMb(stageRoot);
  writeManifest({
    fingerprint,
    builtAt: new Date().toISOString(),
    version: importCheck.stdout.trim().split("\n")[0],
    mode: buildBundledServerManifestVersionInfo(buildPython.version).mode,
    packagingProfile: selectedProfile.name,
    sizeMb: finalSizeMb,
    prunedEntries: pruned.length + postImportPruned.length,
  });

  console.log(
    `[letta-server-build] Staged bundled Letta server runtime at ${stageRoot} (profile ${selectedProfile.name}, pruned ${pruned.length + postImportPruned.length} entries, approx ${finalSizeMb}MB)`,
  );
}

if (isDirectExecution(import.meta.url)) {
  main();
}
