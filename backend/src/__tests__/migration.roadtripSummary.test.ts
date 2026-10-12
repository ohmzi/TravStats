import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * The roadtrip's summary columns (spec 2026-10-12 §6): `summary`,
 * `summary_generated_at` and `summary_source` on `trip_routes`, typed like the
 * journey's columns on `trips` — nullable, additive and never back-filled, so
 * every stored roadtrip survives the migration with its row untouched.
 *
 * `prisma migrate dev` generated the file. The test database has long since
 * run it, so the file is replayed against a SCRATCH schema holding the
 * pre-migration shape with rows in it (template:
 * `migration.loyaltyMemberships.test.ts`).
 */

const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");
const SCHEMA = "migtest_roadtrip_summary";

/** The folder `prisma migrate dev --name roadtrip_summary` created, whatever its timestamp. */
function migrationFile(): string {
  const dirs = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith("_roadtrip_summary"));
  expect(dirs).toHaveLength(1);
  return path.join(MIGRATIONS_DIR, dirs[0], "migration.sql");
}

function statements(): string[] {
  return fs
    .readFileSync(migrationFile(), "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** `trip_routes` as the migrations before this one left it, cut to what the file reads. */
const PRE_MIGRATION = [
  `CREATE TABLE trip_routes (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trip_id TEXT,
     name TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'tour')`,
  `INSERT INTO trip_routes (id, user_id, trip_id, name, mode, kind) VALUES
     ('r1', 'u1', NULL, 'Northvale loop', 'road', 'roadtrip'),
     ('r2', 'u1', NULL, 'Kelmore weekend', 'car', 'roadtrip')`,
];

interface Row {
  id: string;
  name: string;
  kind: string;
  summary: string | null;
  summary_source: string | null;
  summary_generated_at: Date | null;
}

interface Column {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

describe("the roadtrip summary migration", () => {
  let rows: Row[];
  let columns: Column[];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    ({ rows, columns } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);

      const rows = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, name, kind, summary, summary_source, summary_generated_at
           FROM trip_routes ORDER BY id`
      );
      const columns = await tx.$queryRawUnsafe<Column[]>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = '${SCHEMA}' AND table_name = 'trip_routes'
          ORDER BY column_name`
      );
      return { rows, columns };
    }));
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  const column = (name: string) => columns.find((c) => c.column_name === name);

  it("adds the three columns, nullable and typed like the journey's", () => {
    expect(column("summary")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(column("summary_source")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(column("summary_generated_at")).toMatchObject({
      data_type: "timestamp without time zone",
      is_nullable: "YES",
    });
  });

  it("keeps every stored roadtrip, with the new columns empty — no backfill", () => {
    expect(rows).toEqual([
      {
        id: "r1",
        name: "Northvale loop",
        kind: "roadtrip",
        summary: null,
        summary_source: null,
        summary_generated_at: null,
      },
      {
        id: "r2",
        name: "Kelmore weekend",
        kind: "roadtrip",
        summary: null,
        summary_source: null,
        summary_generated_at: null,
      },
    ]);
  });
});
