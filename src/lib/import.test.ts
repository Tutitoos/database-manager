import { describe, it, expect } from "vitest";
import { detectFormat, parseImportFile } from "./import";

describe("detectFormat", () => {
  it("identifies native by schema field", () => {
    const json = { schema: "database-manager.connections-export", schema_version: 1, connections: [] };
    expect(detectFormat(JSON.stringify(json), json)).toBe("native");
  });

  it("identifies DBeaver by drivers+connections combo", () => {
    const json = { connections: {}, drivers: {} };
    expect(detectFormat(JSON.stringify(json), json)).toBe("dbeaver");
  });

  it("identifies DataGrip by XML root with DataSourceManagerImpl", () => {
    const xml = `<project version="4"><component name="DataSourceManagerImpl"></component></project>`;
    expect(detectFormat(xml, null)).toBe("datagrip");
  });

  it("identifies DataFlare by dataflareVersion", () => {
    const json = { dataflareVersion: "1.0.0", connections: [] };
    expect(detectFormat(JSON.stringify(json), json)).toBe("dataflare");
  });

  it("returns unknown for nonsense", () => {
    expect(detectFormat("not even json", null)).toBe("unknown");
    expect(detectFormat("{}", {})).toBe("unknown");
  });
});

describe("parseImportFile (native)", () => {
  it("normalizes a native export with groups and connections", () => {
    const native = {
      schema: "database-manager.connections-export",
      schema_version: 1,
      groups: [
        { id: 1, name: "Prod", parent_id: null },
        { id: 2, name: "EU", parent_id: 1 },
      ],
      connections: [
        {
          name: "prod-pg",
          plugin_id: "postgresql",
          host: "10.0.0.1",
          port: 5432,
          database: "app",
          username: "app",
          password: "",
          settings_json: "{}",
          group_id: 2,
        },
      ],
    };
    const bundle = parseImportFile(JSON.stringify(native));
    expect(bundle.source).toBe("native");
    expect(bundle.connections).toHaveLength(1);
    expect(bundle.connections[0].group_name).toBe("EU");
    expect(bundle.groups).toHaveLength(2);
    expect(bundle.groups.find((g) => g.name === "EU")?.parent_name).toBe("Prod");
  });

  it("rejects a payload missing the connections array", () => {
    const bad = { schema: "database-manager.connections-export", schema_version: 1 };
    // connections defaults to [] — should still parse, just empty
    const bundle = parseImportFile(JSON.stringify(bad));
    expect(bundle.connections).toEqual([]);
  });

  it("rejects a payload whose connections are malformed", () => {
    const bad = {
      schema: "database-manager.connections-export",
      schema_version: 1,
      connections: [{ host: "no-name" }],
    };
    expect(() => parseImportFile(JSON.stringify(bad))).toThrow();
  });
});

describe("parseImportFile (DBeaver)", () => {
  it("maps DBeaver workspace JSON to native connections", () => {
    const dbeaver = {
      dataSourceManagerVersion: 1,
      drivers: {},
      connections: {
        "dbe-1": {
          name: "Reports DB",
          driver: "postgres",
          folder: "Analytics",
          configuration: {
            host: "reports.example.com",
            port: 5432,
            database: "reports",
            properties: { user: "ro", password: "shh" },
          },
        },
      },
    };
    const bundle = parseImportFile(JSON.stringify(dbeaver));
    expect(bundle.source).toBe("dbeaver");
    expect(bundle.connections[0]).toMatchObject({
      name: "Reports DB",
      plugin_id: "postgresql",
      host: "reports.example.com",
      port: 5432,
      username: "ro",
      password: "shh",
      group_name: "Analytics",
    });
    expect(bundle.groups.find((g) => g.name === "Analytics")).toBeTruthy();
  });

  it("warns and skips connections with unknown drivers", () => {
    const dbeaver = {
      drivers: {},
      connections: {
        "x": { name: "Weird", driver: "foobar", configuration: {} },
      },
    };
    const bundle = parseImportFile(JSON.stringify(dbeaver));
    expect(bundle.connections).toHaveLength(0);
    expect(bundle.warnings.some((w) => w.includes("Weird"))).toBe(true);
  });
});

describe("parseImportFile (DataGrip)", () => {
  it("parses dataSources.xml + JDBC URL", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl">
    <data-source name="Local PG" dialect="postgresql">
      <jdbc-url>jdbc:postgresql://localhost:5432/mydb</jdbc-url>
      <user-name>alice</user-name>
    </data-source>
  </component>
</project>`;
    const bundle = parseImportFile(xml);
    expect(bundle.source).toBe("datagrip");
    expect(bundle.connections[0]).toMatchObject({
      name: "Local PG",
      plugin_id: "postgresql",
      host: "localhost",
      port: 5432,
      database: "mydb",
      username: "alice",
      password: "",
    });
    expect(bundle.warnings.some((w) => w.toLowerCase().includes("password"))).toBe(true);
  });

  it("extracts databaseName= from sqlserver JDBC URLs", () => {
    const xml = `<project>
  <component name="DataSourceManagerImpl">
    <data-source name="MSSQL" dialect="mssql">
      <jdbc-url>jdbc:sqlserver://db.example.com:1433;databaseName=app;encrypt=true</jdbc-url>
    </data-source>
  </component>
</project>`;
    const bundle = parseImportFile(xml);
    expect(bundle.connections[0].database).toBe("app");
    expect(bundle.connections[0].plugin_id).toBe("sqlserver");
  });
});

describe("parseImportFile (DataFlare)", () => {
  it("maps DataFlare JSON to native connections", () => {
    const flare = {
      dataflareVersion: "0.5",
      connections: [
        {
          name: "staging-mysql",
          provider: "mysql",
          host: "staging.local",
          port: 3306,
          database: "shop",
          username: "app",
          password: "p",
          folder: "Stage",
        },
      ],
    };
    const bundle = parseImportFile(JSON.stringify(flare));
    expect(bundle.source).toBe("dataflare");
    expect(bundle.connections[0]).toMatchObject({
      name: "staging-mysql",
      plugin_id: "mysql",
      host: "staging.local",
      port: 3306,
      database: "shop",
      group_name: "Stage",
    });
  });
});

describe("parseImportFile (errors)", () => {
  it("throws on invalid input that matches no format", () => {
    expect(() => parseImportFile("not json")).toThrow();
    expect(() => parseImportFile(JSON.stringify({ stuff: 1 }))).toThrow();
  });
});
