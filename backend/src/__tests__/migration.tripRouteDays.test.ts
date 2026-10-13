import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * The trip's own days (owner 2026-10-13): `start_day` and `end_day` on
 * `trip_routes`, typed like the journey's `start_day`/`end_day` on `trips` —
 * `DATE`, nullable, additive and never back-filled, so every stored roadtrip
 * survives the migration untouched and keeps deriving its span from its
 * stations until someone sets a date (template:
 * `migration.roadtripSummary.test.ts`).
 */

const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");
const SCHEMA = "migtest_trip_route_days";

/** The folder `prisma migrate dev --name trip_route_days` created, whatever its timestamp. */
function migrationFile(): string {
  const dirs = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith("_trip_route_days"));
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
     name TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'tour',
     summary TEXT, summary_source TEXT, summary_generated_at TIMESTAMP(3))`,
  `INSERT INTO trip_routes (id, user_id, trip_id, name, mode, kind) VALUES
     ('r1', 'u1', NULL, 'Northvale loop', 'road', 'roadtrip'),
     ('r2', 'u1', NULL, 'Kelmore weekend', 'car', 'roadtrip')`,
];

interface Row {
  id: string;
  name: string;
  kind: string;
  start_day: Date | null;
  end_day: Date | null;
}

interface Column {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

describe("the trip-route days migration", () => {
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
        `SELECT id, name, kind, start_day, end_day FROM trip_routes ORDER BY id`
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

  it("adds the two columns, nullable calendar days like the journey's", () => {
    expect(column("start_day")).toMatchObject({ data_type: "date", is_nullable: "YES" });
    expect(column("end_day")).toMatchObject({ data_type: "date", is_nullable: "YES" });
  });

  it("keeps every stored roadtrip, with the new columns empty — no backfill", () => {
    expect(rows).toEqual([
      {
        id: "r1",
        name: "Northvale loop",
        kind: "roadtrip",
        start_day: null,
        end_day: null,
      },
      {
        id: "r2",
        name: "Kelmore weekend",
        kind: "roadtrip",
        start_day: null,
        end_day: null,
      },
    ]);
  });
});
