import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";

/**
 * `GET /api/v1/admin/route-fetch` (owner request 2026-10-14): the admin
 * progress panel's one read. It proxies the host's `osrm-autofetch`
 * `GET /status` — deliberately admin-only and NOT a new public endpoint (the
 * controller's ruling), so it lives on the admin mount, which is
 * undocumented by design (`coverage.ts`'s UNDOCUMENTED_MOUNTS) and costs no
 * OpenAPI work.
 *
 * The one hard rule: the service being down is never the client's error. The
 * panel has a "service unreachable" state precisely so a stopped or
 * unreachable service reads as such, not as a 500 on the admin page.
 */
describe("admin route-fetch status (/api/v1/admin/route-fetch)", () => {
  let adminUser: { id: string };
  let cookie: string;
  let rowId: number;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeAll(async () => {
    adminUser = await prisma.user.create({
      data: {
        username: `admin-routefetch-test-${Date.now()}`,
        passwordHash: await hashPassword("admin-password"),
        isAdmin: true,
        isActive: true,
      },
    });
    cookie = `auth_token=${generateToken(adminUser.id)}`;
    const existing = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    rowId = existing ? existing.id : (await prisma.adminSettings.create({ data: {} })).id;
  });

  beforeEach(async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { routingAutoFetchUrl: null },
    });
    // A refusing stub by default, so a test that does not expect a call can
    // never reach a real service (or the network) by accident.
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("fetch is stubbed in tests — no test may call the network");
    });
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { routingAutoFetchUrl: null },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  });

  const get = () => request(app).get("/api/v1/admin/route-fetch").set("Cookie", cookie);

  const setUrl = (url: string | null) =>
    prisma.adminSettings.update({ where: { id: rowId }, data: { routingAutoFetchUrl: url } });

  it("requires an admin", async () => {
    expect((await request(app).get("/api/v1/admin/route-fetch")).status).toBe(401);
  });

  it("reports 'not configured' without calling anything when the setting is off", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports reachable:false — never an error — when the service does not answer", async () => {
    await setUrl("http://10.86.15.1:5013"); // the rejecting stub above answers

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, reachable: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("also reads an unreadable body as unreachable, not as a partial answer", async () => {
    await setUrl("http://10.86.15.1:5013");
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) } as Response);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, reachable: false });
  });

  it("proxies a running job's phase, label, regions and start", async () => {
    await setUrl("http://10.86.15.1:5013");
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        built: ["us/texas"],
        job: {
          state: "downloading",
          regions: ["us/tennessee"],
          label: "Tennessee",
          startedAt: 1_760_000_000,
        },
        lastResult: null,
      }),
    } as Response);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: true,
      reachable: true,
      built: ["us/texas"],
      job: {
        state: "downloading",
        regions: ["us/tennessee"],
        label: "Tennessee",
        startedAt: 1_760_000_000,
      },
      lastResult: null,
    });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe("http://10.86.15.1:5013/status");
  });

  it("carries the terminal last result once the job has finished", async () => {
    await setUrl("http://10.86.15.1:5013");
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        built: ["us/ohio"],
        job: null,
        lastResult: { status: "built", regions: ["us/ohio"], at: 1_760_000_500 },
      }),
    } as Response);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: true,
      reachable: true,
      built: ["us/ohio"],
      job: null,
      lastResult: { status: "built", regions: ["us/ohio"], at: 1_760_000_500 },
    });
  });
});
