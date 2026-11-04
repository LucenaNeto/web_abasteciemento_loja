// tests/import-colunas.test.ts — importação por colunas (A, B, H)
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("next-auth", async (orig) => {
  const real = await orig<typeof import("next-auth")>();
  const { sessionMock } = await import("./helpers");
  return { ...real, getServerSession: async () => sessionMock.current };
});

import { db, schema } from "@/server/db";
import { POST as importRows } from "@/app/api/produtos/import/rows/route";
import {
  colLetter,
  columnCount,
  decodeCsv,
  detectDelimiter,
  letterToIndex,
  loadSpreadsheet,
  mapGrid,
  DEFAULT_MAPPING,
  type Grid,
} from "@/lib/spreadsheet";
import { createWorld, destroyWorld, jsonReq, loginAs, uid, type World } from "./helpers";

/* planilha "do ERP": 10 colunas; só A (SKU), B (nome) e H (unidade) interessam */
const HEADER = ["Código", "Descrição", "Marca", "Categoria", "Custo", "Preço", "Estoque", "Unid", "NCM", "Obs"];
const erpRow = (sku: string, name: string, unit: string) => [sku, name, "Marca X", "Perfumaria", "12,50", "29,90", "0", unit, "33030010", ""];

describe("letras de coluna", () => {
  it("converte nos dois sentidos", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(7)).toBe("H");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(letterToIndex("A")).toBe(0);
    expect(letterToIndex("h")).toBe(7);
    expect(letterToIndex("AA")).toBe(26);
    expect(letterToIndex("")).toBe(-1);
    expect(letterToIndex("1")).toBe(-1);
    for (let i = 0; i < 80; i++) expect(letterToIndex(colLetter(i))).toBe(i);
  });
});

describe("mapGrid: pega só A, B e H da planilha inteira", () => {
  const grid: Grid = [
    HEADER,
    erpRow("84859", "EUD MAKE BAT HID K/M AVELA V5 3,7g", "13"),
    erpRow("00123", "Shampoo Siàge 250ml", "7"),
    [], // linha vazia
    ["", "", "", "", "", "", "", "", "", ""], // linha em branco
    erpRow("", "", ""), // sem SKU e sem nome: ignorada em silêncio
    erpRow("84859", "Duplicado", "UN"), // SKU repetido
    erpRow("55555", "", "UN"), // nome vazio
    erpRow("66666", "Sem quantidade", ""), // célula vazia -> quantidade 0
    erpRow("77777", "Valor enorme", "VALOR-MUITO-GRANDE"), // > 10 caracteres
    erpRow("84860.0", "SKU lido como número", "5"),
  ];

  it("usa A, B e H (quantidade), descarta o cabeçalho e normaliza", () => {
    const r = mapGrid(grid, DEFAULT_MAPPING, true);
    expect(r.rows.map((x) => [x.line, x.sku, x.name, x.unit])).toEqual([
      [2, "84859", "EUD MAKE BAT HID K/M AVELA V5 3,7g", "13"], // quantidade guardada como veio
      [3, "00123", "Shampoo Siàge 250ml", "7"], // zeros à esquerda do SKU preservados
      [9, "66666", "Sem quantidade", "0"], // vazio vira 0
      [11, "84860", "SKU lido como número", "5"], // "84860.0" -> "84860"
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([7, 8, 10]);
    expect(r.errors[0].error).toContain("repetido");
    expect(r.errors[1].error).toContain("Nome vazio");
    expect(r.errors[2].error).toContain("muito longo");
    expect(r.ignored).toBe(3); // 2 linhas vazias + 1 sem SKU/nome
  });

  it("sem cabeçalho a 1ª linha também entra; quantidade 'não usar' grava 0", () => {
    const g: Grid = [erpRow("A1", "Primeiro", "9"), erpRow("A2", "Segundo", "4")];
    const r = mapGrid(g, { sku: "A", name: "B", unit: "" }, false);
    expect(r.rows.map((x) => [x.line, x.sku, x.unit])).toEqual([
      [1, "A1", "0"],
      [2, "A2", "0"],
    ]);
  });

  it("outras colunas funcionam (ex.: nome na D)", () => {
    const r = mapGrid(grid.slice(0, 3), { sku: "A", name: "D", unit: "H" }, true);
    expect(r.rows[0].name).toBe("Perfumaria");
  });

  it("colunas inválidas viram um erro claro", () => {
    expect(mapGrid(grid, { sku: "", name: "B", unit: "H" }, true).errors[0].error).toContain("colunas");
  });

  it("columnCount acha a linha mais larga", () => {
    expect(columnCount(grid)).toBe(10);
  });
});

describe("loadSpreadsheet: lê arquivos de verdade", () => {
  it("xlsx com várias abas e 10 colunas", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const aoa = [HEADER, erpRow("84859", "Produto A", "12"), ["00123", "Produto B", "x", "x", "x", "x", "x", "3"]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["resumo"]]), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Produtos");
    const u8 = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));

    const ss = await loadSpreadsheet({ name: "cadastro.xlsx", arrayBuffer: async () => u8.buffer as ArrayBuffer });
    expect(ss.kind).toBe("excel");
    expect(ss.sheets).toEqual(["Resumo", "Produtos"]);

    const r = mapGrid(ss.grid("Produtos"), DEFAULT_MAPPING, true);
    expect(r.rows.map((x) => [x.sku, x.name, x.unit])).toEqual([
      ["84859", "Produto A", "12"],
      ["00123", "Produto B", "3"],
    ]);
  });

  it("csv com ponto e vírgula e acentos em Windows-1252", async () => {
    const text = ["Código;Descrição;a;b;c;d;e;Unid", "100;Condicionador Hidratação;1;2;3;4;5;8", "200;Máscara Capilar;1;2;3;4;5;0"].join("\r\n");
    const buf = Buffer.from(text, "latin1"); // acentos em 1 byte, como o Excel salva em português
    const ss = await loadSpreadsheet({
      name: "produtos.csv",
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    });
    expect(ss.kind).toBe("csv");
    expect(ss.delimiter).toBe(";");
    const r = mapGrid(ss.grid(ss.sheets[0]), DEFAULT_MAPPING, true);
    expect(r.rows.map((x) => [x.sku, x.name, x.unit])).toEqual([
      ["100", "Condicionador Hidratação", "8"],
      ["200", "Máscara Capilar", "0"],
    ]);
  });

  it("detecta o separador e decodifica UTF-8 com BOM", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    const bom = new TextEncoder().encode("﻿nome;unid\nAçaí;UN");
    expect(decodeCsv(bom.buffer as ArrayBuffer)).toBe("nome;unid\nAçaí;UN");
  });
});

describe("POST /api/produtos/import/rows (integração, HOMOLOGAÇÃO)", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    if (w) {
      const prods = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.unitId, w.unit.id));
      if (prods.length) {
        await db.delete(schema.auditLogs).where(and(eq(schema.auditLogs.tableName, "products"), eq(schema.auditLogs.recordId, `unit:${w.unit.id}`)));
      }
      await destroyWorld(w);
    }
  });

  const post = (body: unknown) => importRows(jsonReq("POST", body));
  const count = async () =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(schema.products).where(eq(schema.products.unitId, w.unit.id)))[0].n;

  it("só admin importa", async () => {
    loginAs(w.warehouse.id, "warehouse");
    expect((await post({ unitId: w.unit.id, mode: "upsert", rows: [] })).status).toBe(403);
    loginAs(null);
    expect((await post({ unitId: w.unit.id, mode: "upsert", rows: [] })).status).toBe(401);
  });

  it("simular não grava; importar insere; reimportar atualiza sem duplicar (maiúsculas incluídas)", async () => {
    loginAs(w.admin.id, "admin");
    const sku = `IMP-${uid()}`;
    const rows = [
      { line: 2, sku, name: "Produto 1", unit: "UN" },
      { line: 3, sku: `${sku}-B`, name: "Produto 2", unit: "cx" },
    ];

    // simulação
    let res = await post({ unitId: w.unit.id, mode: "upsert", dryRun: true, rows });
    let body = await res.json();
    expect(res.status).toBe(200);
    expect([body.newSkus, body.existInDb, body.valid]).toEqual([2, 0, 2]);
    expect(await count()).toBe(0);

    // importação
    res = await post({ unitId: w.unit.id, mode: "upsert", rows, importId: "t1", part: { index: 1, total: 1 } });
    body = await res.json();
    expect([body.inserted, body.updated]).toEqual([2, 0]);
    expect(await count()).toBe(2);
    const [p2] = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), eq(schema.products.sku, `${sku}-B`)));
    expect(p2.unit).toBe("CX"); // unidade em maiúsculas

    // reimportar o mesmo lote (reenvio seguro), com SKU em outra caixa e nome novo
    res = await post({
      unitId: w.unit.id,
      mode: "upsert",
      rows: [{ line: 2, sku: sku.toLowerCase(), name: "Produto 1 (novo nome)", unit: "PC" }, rows[1]],
    });
    body = await res.json();
    expect([body.inserted, body.updated, body.existInDb]).toEqual([0, 2, 2]);
    expect(await count()).toBe(2); // sem duplicar
    const [p1] = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), eq(schema.products.sku, sku)));
    expect([p1.name, p1.unit, p1.stock]).toEqual(["Produto 1 (novo nome)", "PC", 0]);
  });

  it("modo inserir ignora os que já existem", async () => {
    loginAs(w.admin.id, "admin");
    const sku = `INS-${uid()}`;
    await post({ unitId: w.unit.id, mode: "insert", rows: [{ line: 1, sku, name: "Original", unit: "UN" }] });
    const res = await post({
      unitId: w.unit.id,
      mode: "insert",
      rows: [
        { line: 1, sku, name: "Mudou?", unit: "CX" },
        { line: 2, sku: `${sku}-N`, name: "Novo", unit: "UN" },
      ],
    });
    const body = await res.json();
    expect([body.inserted, body.skipped]).toEqual([1, 1]);
    const [p] = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), eq(schema.products.sku, sku)));
    expect(p.name).toBe("Original");
  });

  it("linhas inválidas voltam com o número da linha e as boas entram", async () => {
    loginAs(w.admin.id, "admin");
    const ok = `OK-${uid()}`;
    const res = await post({
      unitId: w.unit.id,
      mode: "upsert",
      rows: [
        { line: 5, sku: ok, name: "Boa", unit: "" }, // quantidade vazia -> 0
        { line: 6, sku: "", name: "Sem SKU", unit: "UN" },
        { line: 7, sku: "X".repeat(65), name: "SKU longo", unit: "UN" },
        { line: 8, sku: `${ok}-U`, name: "Unidade longa", unit: "UNIDADE-LONGA" },
        { line: 9, sku: ok.toLowerCase(), name: "Repetido no lote", unit: "UN" },
      ],
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.valid).toBe(1);
    expect(body.errors.map((e: { line: number }) => e.line)).toEqual([6, 7, 8, 9]);
    const [p] = await db.select().from(schema.products).where(and(eq(schema.products.unitId, w.unit.id), eq(schema.products.sku, ok)));
    expect(p.unit).toBe("0");
  });

  it("recusa unidade inexistente, corpo inválido e lote grande demais", async () => {
    loginAs(w.admin.id, "admin");
    expect((await post({ unitId: 999999999, mode: "upsert", rows: [] })).status).toBe(400);
    expect((await post({ unitId: w.unit.id, mode: "xyz", rows: [] })).status).toBe(400);
    const big = Array.from({ length: 10001 }, (_, i) => ({ line: i + 1, sku: `B${i}`, name: "x" }));
    expect((await post({ unitId: w.unit.id, mode: "upsert", dryRun: true, rows: big })).status).toBe(400);
  });
});
