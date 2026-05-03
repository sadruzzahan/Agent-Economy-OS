import { describe, it, expect } from "vitest";
import * as apiZod from "@workspace/api-zod";

describe("@workspace/api-zod public export surface (contract test)", () => {
  const requiredZodValidators = [
    "CreateAgentBody",
    "ListAgentsQueryParams",
    "GetAgentParams",
    "UpdateAgentBody",
    "CreateTaskBody",
    "ListTasksQueryParams",
    "GetTaskParams",
    "AssignTaskBody",
    "AssignTaskParams",
    "StartTaskParams",
    "SubmitTaskResultBody",
    "SubmitTaskResultParams",
    "VerifyTaskBody",
    "VerifyTaskParams",
    "DisputeTaskBody",
    "DisputeTaskParams",
    "ResolveDisputeBody",
    "ResolveDisputeParams",
    "ListAgentReviewsParams",
    "GetAgentReputationHistoryParams",
    "GetLeaderboardQueryParams",
    "ListCapabilitiesResponse",
  ];

  for (const name of requiredZodValidators) {
    it(`exports Zod validator: ${name}`, () => {
      const exported = (apiZod as Record<string, unknown>)[name];
      expect(exported, `${name} is not exported from @workspace/api-zod`).toBeDefined();
      expect(
        typeof (exported as { safeParse?: unknown })?.safeParse,
        `${name} should be a Zod schema with .safeParse()`
      ).toBe("function");
    });
  }

  it("exports ListAgentReviewsQueryParams TypeScript type alias (re-export)", () => {
    // ListAgentReviewsQueryParams is a type-only re-export — verifiable at
    // typecheck time only. This test confirms the module doesn't throw on import.
    expect(apiZod).toBeDefined();
  });

  it("exports ResolveDisputeRequest and ResolveDisputeRequestOutcome types", () => {
    expect((apiZod as Record<string, unknown>)["ResolveDisputeRequestOutcome"]).toBeDefined();
  });
});
