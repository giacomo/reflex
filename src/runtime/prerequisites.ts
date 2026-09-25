import { spawnSync } from "node:child_process";

export class PrerequisiteError extends Error {}

export interface CommandChecker {
  (command: string, args: string[]): boolean;
}

export const defaultCommandChecker: CommandChecker = (command, args) => {
  try {
    const result = spawnSync(command, args, { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
};

export interface PrerequisiteReport {
  git: boolean;
  cmake: boolean;
  compiler: boolean;
  compilerName: string | undefined;
  nvcc: boolean;
  ok: boolean;
  missingInstructions: string[];
}

const COMPILER_CANDIDATES: Array<{ name: string; args: string[] }> = [
  { name: "cc", args: ["--version"] },
  { name: "gcc", args: ["--version"] },
  { name: "clang", args: ["--version"] },
];

const INSTALL_HINTS: Record<string, string> = {
  git: "Install git: https://git-scm.com/downloads (Debian/Ubuntu: `sudo apt install git`, macOS: `xcode-select --install` or `brew install git`).",
  cmake: "Install CMake >= 3.14: https://cmake.org/download/ (Debian/Ubuntu: `sudo apt install cmake`, macOS: `brew install cmake`).",
  compiler: "Install a C++ compiler (Debian/Ubuntu: `sudo apt install build-essential`, macOS: `xcode-select --install`).",
};

export function checkPrerequisites(check: CommandChecker = defaultCommandChecker): PrerequisiteReport {
  const git = check("git", ["--version"]);
  const cmake = check("cmake", ["--version"]);
  const compilerMatch = COMPILER_CANDIDATES.find((c) => check(c.name, c.args));
  const compiler = compilerMatch !== undefined;
  const nvcc = check("nvcc", ["--version"]);

  const missingInstructions: string[] = [];
  if (!git) missingInstructions.push(INSTALL_HINTS["git"]!);
  if (!cmake) missingInstructions.push(INSTALL_HINTS["cmake"]!);
  if (!compiler) missingInstructions.push(INSTALL_HINTS["compiler"]!);

  return {
    git,
    cmake,
    compiler,
    compilerName: compilerMatch?.name,
    nvcc,
    ok: git && cmake && compiler,
    missingInstructions,
  };
}
