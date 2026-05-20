import { describe, it, expect } from "vitest";
import { isOrgSelectable, type OrgRecord } from "./orgs";

function org(overrides: Partial<OrgRecord> = {}): OrgRecord {
  return {
    id: 1,
    name: "Test",
    server_url: "https://example.com",
    server_kind: "manual",
    cert_fingerprint: null,
    accent_color: null,
    icon_url: null,
    version: null,
    last_health_ok: true,
    user_email: null,
    user_id: null,
    role: null,
    position: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const baseState = { orgs: [], activeId: null, loaded: true, health: {} } as const;

describe("isOrgSelectable", () => {
  it("local orgs are always selectable regardless of health state", () => {
    const local = org({ server_kind: "local", last_health_ok: false });
    expect(isOrgSelectable(local, { ...baseState, health: { 1: "offline" } })).toBe(true);
  });

  it("remote org with live online health is selectable", () => {
    expect(isOrgSelectable(org(), { ...baseState, health: { 1: "online" } })).toBe(true);
  });

  it("remote org with live offline health is NOT selectable", () => {
    expect(isOrgSelectable(org(), { ...baseState, health: { 1: "offline" } })).toBe(false);
  });

  it("checking is treated as selectable (optimistic)", () => {
    expect(isOrgSelectable(org(), { ...baseState, health: { 1: "checking" } })).toBe(true);
  });

  it("falls back to last_health_ok when no live state exists", () => {
    expect(isOrgSelectable(org({ last_health_ok: true }), baseState)).toBe(true);
    expect(isOrgSelectable(org({ last_health_ok: false }), baseState)).toBe(false);
  });

  it("live state overrides stale last_health_ok", () => {
    const stale = org({ last_health_ok: true });
    expect(isOrgSelectable(stale, { ...baseState, health: { 1: "offline" } })).toBe(false);
    const recovered = org({ last_health_ok: false });
    expect(isOrgSelectable(recovered, { ...baseState, health: { 1: "online" } })).toBe(true);
  });
});
