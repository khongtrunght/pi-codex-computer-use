import { describe, expect, it } from "vitest";
import { createElicitationResponse, shouldDevAutoAccept } from "../src/runtime.ts";

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

describe("shouldDevAutoAccept", () => {
	const prompt = (app: string) => `Allow ChatGPT to use ${app}?`;

	function withAllowlist(apps: string | undefined, run: () => void): void {
		const previous = process.env.PI_CUA_DEV_AUTO_ACCEPT_APPS;
		if (apps === undefined) delete process.env.PI_CUA_DEV_AUTO_ACCEPT_APPS;
		else process.env.PI_CUA_DEV_AUTO_ACCEPT_APPS = apps;
		try {
			run();
		} finally {
			if (previous === undefined) delete process.env.PI_CUA_DEV_AUTO_ACCEPT_APPS;
			else process.env.PI_CUA_DEV_AUTO_ACCEPT_APPS = previous;
		}
	}

	it("matches ChatGPT.app-hosted prompts", () => {
		withAllowlist("Finder", () => {
			expect(shouldDevAutoAccept(prompt("Finder"))).toBe(true);
		});
	});

	it("matches legacy Codex.app-hosted prompts", () => {
		withAllowlist("Finder", () => {
			expect(shouldDevAutoAccept("Allow Codex to use Finder?")).toBe(true);
		});
	});

	it("ignores apps outside the allowlist", () => {
		withAllowlist("Finder", () => {
			expect(shouldDevAutoAccept(prompt("Messages"))).toBe(false);
		});
	});

	it("declines when no allowlist is configured", () => {
		withAllowlist(undefined, () => {
			expect(shouldDevAutoAccept(prompt("Finder"))).toBe(false);
		});
	});
});
