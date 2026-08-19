import { describe, expect, it } from "vitest";
import { createElicitationResponse } from "../src/runtime.ts";

describe("createElicitationResponse", () => {
	it("persists an explicit approval when the server supports always", () => {
		expect(createElicitationResponse(true, { persist: ["session", "always"] })).toEqual({
			action: "accept",
			content: {},
			_meta: { persist: "always" },
		});
	});

	it("does not request unsupported persistence", () => {
		expect(createElicitationResponse(true, { persist: ["session"] })).toEqual({
			action: "accept",
			content: {},
		});
	});

	it("does not attach persistence to a decline", () => {
		expect(createElicitationResponse(false, { persist: ["always"] })).toEqual({
			action: "decline",
			content: null,
		});
	});
});
