// src/lib/spreadsheet.ts
//
// Leitura de planilhas (.xlsx/.xls/.csv) e mapeamento de colunas POR POSIÇÃO (A, B, H...),
// sem precisar apagar nem renomear nada na planilha original.
//
// Funciona no navegador (a planilha é lida na própria máquina do usuário; só as colunas escolhidas
// são enviadas ao servidor) e também no Node (testes).

export type Grid = string[][];

export type Mapping = {
  /** letras das colunas, ex.: "A" */
  sku: string;
  name: string;
  /** coluna da QUANTIDADE (gravada no campo `unit` do produto). "" = não usar (grava "0") */
  unit: string;
};

export type ImportRow = { line: number; sku: string; name: string; unit: string };
export type RowError = { line: number; error: string };

/** Mapeamento padrão do cadastro de produtos do ERP do grupo. */
export const DEFAULT_MAPPING: Mapping = { sku: "A", name: "B", unit: "H" };

/* ---------------- letras de coluna ---------------- */

/** 0 -> "A", 7 -> "H", 26 -> "AA" */
export function colLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** "A" -> 0, "h" -> 7, "AA" -> 26; inválido -> -1 */
export function letterToIndex(letter: string): number {
  const s = String(letter ?? "").trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return -1;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------------- leitura ---------------- */

export type SpreadsheetFile = {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type LoadedSpreadsheet = {
  sheets: string[];
  /** matriz de TEXTO (linhas x colunas) da planilha escolhida; linha 1 do Excel = índice 0 */
  grid(sheet: string): Grid;
  kind: "excel" | "csv";
  delimiter?: string;
};

/** Escolhe o separador do CSV pela 1ª linha com mais campos. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (c: string) => (head.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) || []).length;
  const counts: Array<["," | ";" | "\t", number]> = [
    [";", count(";")],
    [",", count(",")],
    ["\t", count("\t")],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Texto do CSV: UTF-8; se vier com caracteres quebrados (Excel em português), tenta Windows-1252. */
export function decodeCsv(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    return utf8;
  }
}

export async function loadSpreadsheet(file: SpreadsheetFile, delimiter?: string): Promise<LoadedSpreadsheet> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const isCsv = /\.(csv|txt)$/i.test(file.name);

  let wb;
  let usedDelimiter: string | undefined;
  if (isCsv) {
    const text = decodeCsv(buf);
    usedDelimiter = delimiter || detectDelimiter(text);
    wb = XLSX.read(text, { type: "string", FS: usedDelimiter, raw: true });
  } else {
    wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  }

  const sheets = wb.SheetNames;
  return {
    sheets,
    kind: isCsv ? "csv" : "excel",
    delimiter: usedDelimiter,
    grid(sheet: string): Grid {
      const ws = wb.Sheets[sheet] ?? wb.Sheets[sheets[0]];
      if (!ws) return [];
      const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false, // texto como aparece na planilha (SKU "00123" não vira 123)
        defval: "",
        blankrows: true,
      });
      return arr.map((row) => row.map((c) => (c == null ? "" : String(c))));
    },
  };
}

/* ---------------- mapeamento ---------------- */

const cell = (row: string[], idx: number) => (idx >= 0 && idx < row.length ? String(row[idx] ?? "").trim() : "");

/** "84859.0" (número lido com casa decimal) -> "84859" */
function cleanSku(v: string) {
  return /^\d+\.0+$/.test(v) ? v.replace(/\.0+$/, "") : v;
}

export type MapResult = {
  rows: ImportRow[];
  errors: RowError[];
  /** linhas com dados consideradas (sem contar cabeçalho e linhas vazias) */
  considered: number;
  /** linhas vazias ou sem SKU e sem nome, ignoradas sem erro */
  ignored: number;
};

/**
 * Pega só as colunas escolhidas.
 * - hasHeader: a 1ª linha é cabeçalho e é descartada
 * - linhas totalmente vazias, ou sem SKU e sem nome, são ignoradas
 * - SKU repetido no arquivo: a 1ª ocorrência vale, as demais viram erro
 */
export function mapGrid(grid: Grid, mapping: Mapping, hasHeader: boolean): MapResult {
  const iSku = letterToIndex(mapping.sku);
  const iName = letterToIndex(mapping.name);
  const iUnit = mapping.unit ? letterToIndex(mapping.unit) : -1;

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  let considered = 0;
  let ignored = 0;

  if (iSku < 0 || iName < 0) return { rows, errors: [{ line: 0, error: "Escolha as colunas de SKU e de nome." }], considered, ignored };

  for (let i = hasHeader ? 1 : 0; i < grid.length; i++) {
    const r = grid[i];
    const line = i + 1; // número da linha no Excel
    if (!r || r.every((c) => String(c ?? "").trim() === "")) {
      ignored++;
      continue;
    }

    const sku = cleanSku(cell(r, iSku));
    const name = cell(r, iName);
    if (!sku && !name) {
      ignored++;
      continue;
    }
    considered++;

    if (!sku) {
      errors.push({ line, error: "SKU vazio." });
      continue;
    }
    if (!name) {
      errors.push({ line, error: `Nome vazio (SKU ${sku}).` });
      continue;
    }
    if (sku.length > 64) {
      errors.push({ line, error: `SKU muito longo (máx. 64 caracteres): ${sku.slice(0, 20)}…` });
      continue;
    }
    if (name.length > 255) {
      errors.push({ line, error: `Nome muito longo (máx. 255 caracteres), SKU ${sku}.` });
      continue;
    }

    const unitRaw = iUnit >= 0 ? cell(r, iUnit) : "";
    const unit = (unitRaw || "0").toUpperCase(); // célula vazia = quantidade 0
    if (unit.length > 10) {
      errors.push({ line, error: `Valor "${unitRaw}" muito longo na coluna da quantidade (máx. 10 caracteres), SKU ${sku}. Confira se a coluna está certa.` });
      continue;
    }

    const key = sku.toUpperCase();
    const firstLine = seen.get(key);
    if (firstLine != null) {
      errors.push({ line, error: `SKU ${sku} repetido (já aparece na linha ${firstLine}).` });
      continue;
    }
    seen.set(key, line);

    rows.push({ line, sku, name, unit });
  }

  return { rows, errors, considered, ignored };
}

/** Número de colunas da planilha (maior linha entre as primeiras). */
export function columnCount(grid: Grid, sampleRows = 200): number {
  let max = 0;
  for (let i = 0; i < Math.min(grid.length, sampleRows); i++) max = Math.max(max, grid[i]?.length ?? 0);
  return max;
}
