import "../../openapi/paths";
import { AppError } from "../../../middleware/errorHandler";
import { jobSchema } from "../../openapi/paths/jobs";
import { clearJobs, getJob, jobErrorOf, settleAllJobs, startJob } from "../jobRegistry";

const OWNER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("trip builder jobs", () => {
  afterEach(() => clearJobs());

  it("documents the three job kinds in the OpenAPI job schema", () => {
    expect(jobSchema.shape.kind.options).toEqual(
      expect.arrayContaining(["tripBuilder.scan", "tripBuilder.commit", "tripBuilder.album"])
    );
  });

  it("runs a trip builder job and keeps its result for its owner only", async () => {
    const job = startJob("tripBuilder.scan", OWNER, async () => ({ draftId: "d" }));
    await settleAllJobs();
    expect(getJob(job.id, OWNER)).toMatchObject({
      kind: "tripBuilder.scan",
      status: "succeeded",
      result: { draftId: "d" },
    });
    expect(getJob(job.id, "someone-else")).toBeNull();
  });

  it("reports a commit failure under its own code", async () => {
    const job = startJob("tripBuilder.commit", OWNER, async () => {
      throw new AppError("Commit failed", 500, "COMMIT_FAILED");
    });
    await settleAllJobs();
    expect(getJob(job.id, OWNER)?.error).toEqual({ code: "COMMIT_FAILED", status: 500 });
    expect(jobErrorOf(new AppError("x", 409, "ALREADY_COMMITTED"))).toEqual({
      code: "ALREADY_COMMITTED",
      status: 409,
    });
  });
});
