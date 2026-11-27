import { Database as Sqlite, type SQLQueryBindings } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Compilable,
  DummyDriver,
  Kysely,
  type RawBuilder,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import type { z } from "zod";
import { migrateDatabase } from "./databaseMigrations.ts";
import type { Database } from "./databaseRows.ts";

export { sql } from "kysely";
export * from "./databaseRows.ts";

const DATABASE_PATH = resolve(
  process.env["NANIME_DATABASE"] ?? resolve(import.meta.dir, "..", ".nanime.sqlite"),
);

export const database = new Sqlite(DATABASE_PATH, { create: true });
chmodSync(DATABASE_PATH, 0o600);
database.run("PRAGMA journal_mode = WAL");
database.run("PRAGMA synchronous = NORMAL");
database.run("PRAGMA foreign_keys = ON");
migrateDatabase(database, process.env["NANIME_ADMIN_SETUP_TOKEN"] ?? "");

/**
 * Typed SQL for the tables in `databaseRows.ts`. Kysely only compiles here:
 * statements run synchronously on `database` through the helpers below,
 * because lock checks, path claims and journal checkpoints rely on a query
 * finishing in the same turn as the code around it.
 */
export const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new SqliteIntrospector(kysely),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

/** A query builder, or raw SQL written with the `sql` tag. */
export type Query = Compilable | RawBuilder<unknown>;

function prepared(query: Query) {
  const compiled = "isRawBuilder" in query ? query.compile(db) : query.compile();
  // Kysely binds the values the query was built with: strings, numbers and nulls.
  const parameters = compiled.parameters as SQLQueryBindings[];
  return { statement: database.query(compiled.sql), parameters };
}

/** Runs a query and parses every row with a Zod schema. */
export function queryRows<T extends z.ZodType>(query: Query, schema: T): z.output<T>[] {
  const { statement, parameters } = prepared(query);
  return statement.all(...parameters).map((row) => schema.parse(row));
}

/** Runs a query and parses its first row with a Zod schema, or returns null. */
export function queryOne<T extends z.ZodType>(query: Query, schema: T): z.output<T> | null {
  const { statement, parameters } = prepared(query);
  const row = statement.get(...parameters);
  return row === null ? null : schema.parse(row);
}

/** Runs a write and returns how many rows it changed. */
export function execute(query: Query): number {
  const { statement, parameters } = prepared(query);
  return statement.run(...parameters).changes;
}
