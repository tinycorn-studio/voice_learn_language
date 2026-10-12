import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

export class InMemorySheet {
  public readonly rows: unknown[][] = [];

  public constructor(public readonly name: string) {}

  public getLastColumn(): number {
    return this.rows[0]?.length ?? 0;
  }

  public getLastRow(): number {
    return this.rows.length;
  }

  public appendRow(row: unknown[]): void {
    this.rows.push(row.map((cell) => (cell === undefined || cell === null ? '' : cell)));
  }

  public getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const self = this;
    return {
      getValues(): unknown[][] {
        const result: unknown[][] = [];
        for (let r = 0; r < numRows; r++) {
          const targetRow = self.rows[row - 1 + r] ?? [];
          const slice: unknown[] = [];
          for (let c = 0; c < numCols; c++) {
            slice.push(targetRow[col - 1 + c] ?? '');
          }
          result.push(slice);
        }
        return result;
      },
      getValue(): unknown {
        return self.rows[row - 1]?.[col - 1] ?? '';
      },
      setValue(val: unknown): void {
        while (self.rows.length < row) {
          self.rows.push([]);
        }
        const targetRow = self.rows[row - 1]!;
        while (targetRow.length < col) {
          targetRow.push('');
        }
        targetRow[col - 1] = val;
      },
    };
  }
}

export class InMemorySpreadsheet {
  private readonly sheets = new Map<string, InMemorySheet>();

  public getSheetByName(name: string): InMemorySheet | null {
    return this.sheets.get(name) ?? null;
  }

  public insertSheet(name: string): InMemorySheet {
    const sheet = new InMemorySheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

export interface GasRuntimeInstance {
  spreadsheet: InMemorySpreadsheet;
  setupSheets: () => void;
  doPost: (contents: string) => { status: number; bodyText: string };
}

/**
 * Loads `apps-script/Code.gs` into an isolated VM context with Google Apps Script
 * built-in services (`SpreadsheetApp`, `PropertiesService`, `LockService`, `Utilities`, `ContentService`).
 */
export function createGasRuntimeHarness(scriptProperties: Record<string, string>): GasRuntimeInstance {
  const codePath = path.resolve(process.cwd(), 'apps-script/Code.gs');
  const sourceCode = fs.readFileSync(codePath, 'utf8');
  const spreadsheet = new InMemorySpreadsheet();
  let uuidCounter = 1000;

  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    RegExp,
    Error,
    isFinite,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => scriptProperties[key] ?? null,
      }),
    },
    SpreadsheetApp: {
      openById: (_id: string) => spreadsheet,
      flush: () => undefined,
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: (_ms: number) => undefined,
        releaseLock: () => undefined,
      }),
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      computeHmacSha256Signature: (value: string, key: string) => {
        const buf = crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(value, 'utf8').digest();
        return Array.from(buf.values());
      },
      base64EncodeWebSafe: (bytes: number[]) => {
        return Buffer.from(Uint8Array.from(bytes))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      },
      getUuid: () => {
        uuidCounter++;
        return `00000000-0000-4000-8000-00000000${uuidCounter}`;
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({
        _text: text,
        setMimeType(_mime: string) {
          return this;
        },
        getContent() {
          return text;
        },
      }),
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(sourceCode, sandbox, { filename: 'Code.gs' });

  const setupSheetsFn = (sandbox as unknown as { setupSheets: () => void }).setupSheets;
  const doPostFn = (
    sandbox as unknown as {
      doPost: (e: { postData?: { contents?: string } }) => { getContent: () => string };
    }
  ).doPost;

  return {
    spreadsheet,
    setupSheets: () => setupSheetsFn(),
    doPost: (contents: string) => {
      const output = doPostFn({ postData: { contents } });
      return {
        status: 200,
        bodyText: output.getContent(),
      };
    },
  };
}
