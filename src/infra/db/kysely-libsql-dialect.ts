/**
 * Kysely dialect for @libsql/client (Turso).
 *
 * Bridges the @libsql/client Client interface to Kysely's SQLite dialect,
 * enabling Better Auth (which uses Kysely internally) to work with Turso
 * in Cloudflare Workers (where the workerd-condition web client is used and
 * file:// URLs are not supported).
 *
 * Better Auth's built-in Kysely adapter detects dialect compatibility via
 * duck-typing. The @libsql/client web client does not match any built-in
 * pattern, so we wrap it manually with a custom Kysely dialect.
 *
 * Usage:
 *   import { LibsqlDialect } from '#/infra/db/kysely-libsql-dialect'
 *   const db = { dialect: new LibsqlDialect({ client: createDbClient() }), type: 'sqlite' as const }
 *   betterAuth({ database: db, ... })
 */

import { SqliteAdapter, SqliteQueryCompiler } from "kysely";
import type {
  Dialect,
  Driver,
  QueryResult,
  DatabaseIntrospector,
  DialectAdapter,
  QueryCompiler,
  DatabaseConnection,
  CompiledQuery,
  TableMetadata,
  DatabaseMetadataOptions,
 Kysely } from "kysely";
import type { Client, InValue } from "@libsql/client";

// Minimal introspector — Better Auth does not rely on schema introspection.
class LibsqlIntrospector implements DatabaseIntrospector {
  constructor(_db: Kysely<Record<string, unknown>>) {}

  async getSchemas() {
    return [];
  }

  async getTables(
    _options?: DatabaseMetadataOptions
  ): Promise<TableMetadata[]> {
    return [];
  }

  async getColumns() {
    return [];
  }

  async getMetadata() {
    return { tables: [] as TableMetadata[] };
  }
}

class LibsqlConnection implements DatabaseConnection {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async executeQuery<TRow>(
    compiledQuery: CompiledQuery
  ): Promise<QueryResult<TRow>> {
    const result = await this.client.execute({
      sql: compiledQuery.sql,
      args: compiledQuery.parameters as InValue[],
    });

    return {
      rows: result.rows as unknown as TRow[],
      insertId:
        result.lastInsertRowid != null
          ? BigInt(result.lastInsertRowid)
          : undefined,
      numAffectedRows: BigInt(result.rowsAffected),
    };
  }

  streamQuery<TRow>(): AsyncGenerator<QueryResult<TRow>> {
    throw new Error("LibsqlDialect does not support streaming queries.");
  }
}

class LibsqlDriver implements Driver {
  private readonly client: Client;
  private connection: LibsqlConnection | undefined;

  constructor(client: Client) {
    this.client = client;
  }

  async init(): Promise<void> {
    this.connection = new LibsqlConnection(this.client);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.connection) {
      throw new Error("LibsqlDriver not initialized. Call init() first.");
    }
    return this.connection;
  }

  async beginTransaction(): Promise<void> {
    // libsql HTTP client does not support interactive transactions.
    // Better Auth uses single-query operations, so this is safe to no-op.
  }

  async commitTransaction(): Promise<void> {}

  async rollbackTransaction(): Promise<void> {}

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    this.client.close();
  }
}

export interface LibsqlDialectConfig {
  client: Client;
}

export class LibsqlDialect implements Dialect {
  private readonly config: LibsqlDialectConfig;

  constructor(config: LibsqlDialectConfig) {
    this.config = config;
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new LibsqlDriver(this.config.client);
  }

  createIntrospector(
    db: Kysely<Record<string, unknown>>
  ): DatabaseIntrospector {
    return new LibsqlIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }
}
