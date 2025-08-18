import { MinimalTools } from '../../tools/minimalTools.js';
import type { AgentState } from '../state.js';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';

export function createMinimalFsTools(state: AgentState) {
  const tools = new MinimalTools(state.tempDir);

  const writeFileTool = tool(
    async ({
      path,
      content,
    }: {
      path: string;
      content: string;
    }): Promise<string> => {
      try {
        const res = await tools.writeFile(path, content);
        return JSON.stringify({
          ok: true,
          absPath: res.absPath,
          hash: res.hash,
          bytesWritten: res.bytesWritten,
        });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'write_file',
      description:
        'Write a UTF-8 text file relative to the working directory. Input must be a JSON string {"path": string, "content": string}. Returns JSON with {"absPath","hash","bytesWritten"}.',
      schema: z.object({ path: z.string(), content: z.string() }),
    }
  );

  const readFileTool = tool(
    async ({ path }: { path: string }): Promise<string> => {
      try {
        const content = await tools.readFile(path);
        return content;
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: 'read_file',
      schema: z.object({
        path: z.string().describe('The path to the file to read'),
      }),
      description:
        'Read a UTF-8 text file relative to the working directory. Input must be a JSON string {"path": string}. Returns the raw file contents as a string.',
    }
  );

  const runJsTool = tool(
    async ({
      entry,
      args,
      timeoutMs,
    }: {
      entry: string;
      args?: string[];
      timeoutMs?: number;
    }): Promise<string> => {
      try {
        const exec = await tools.executeJs(
          entry,
          Array.isArray(args) ? args : [],
          typeof timeoutMs === 'number' ? timeoutMs : 30000
        );
        return JSON.stringify({
          ok: true,
          code: exec.code,
          stdout: exec.stdout,
          stderr: exec.stderr,
        });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'run_js',
      schema: z.object({
        entry: z.string().describe('The path to the script to run'),
        args: z
          .array(z.string())
          .describe('The arguments to pass to the script')
          .optional()
          .nullable(),
        timeoutMs: z
          .number()
          .describe('The timeout in milliseconds for the script')
          .optional()
          .nullable()
          .default(15000),
      }),
      description:
        'Execute a Node.js script relative to the working directory. Input must be a JSON string {"entry": string, "args"?: string[], "timeoutMs"?: number}. Returns JSON with {"code","stdout","stderr"}.',
    }
  );

  const listDirTool = tool(
    async ({ path }: { path: string }): Promise<string> => {
      try {
        const files = await tools.listDirectory(path);
        return JSON.stringify(files);
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    {
      name: 'list_dir',
      schema: z.object({
        path: z.string().describe('The path to the directory to list'),
      }),
      description:
        'List the contents of a directory relative to the working directory. Input must be a JSON string {"path": string}. Returns a JSON array of filenames.',
    }
  );

  return [writeFileTool, readFileTool, runJsTool, listDirTool];
}
