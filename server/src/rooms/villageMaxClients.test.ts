import { describe, expect, it } from "vitest";
import { VILLAGE_MAX_CLIENTS } from "@caysonverse/shared/constants";
import { villageMaxClients } from "./VillageRoom";

describe("villageMaxClients", () => {
  it("is the shared cap unless a load test sets a sane one", () => {
    expect(villageMaxClients({})).toBe(VILLAGE_MAX_CLIENTS);
    expect(villageMaxClients({ CV_VILLAGE_MAX_CLIENTS: "100" })).toBe(100);
    expect(villageMaxClients({ CV_VILLAGE_MAX_CLIENTS: "0" })).toBe(VILLAGE_MAX_CLIENTS);
    expect(villageMaxClients({ CV_VILLAGE_MAX_CLIENTS: "abc" })).toBe(VILLAGE_MAX_CLIENTS);
    expect(villageMaxClients({ CV_VILLAGE_MAX_CLIENTS: "5000" })).toBe(VILLAGE_MAX_CLIENTS);
  });
});
