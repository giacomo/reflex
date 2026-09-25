import { spawn } from "node:child_process";

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  onOutput?: (chunk: string) => void;
}

export type Exec = (command: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export const defaultExec: Exec = (command, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      opts.onOutput?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      opts.onOutput?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code ?? -1, stdout, stderr }));
  });
